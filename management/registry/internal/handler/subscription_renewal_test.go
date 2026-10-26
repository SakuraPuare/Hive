package handler

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type renewalState struct {
	ID, CustomerID, PlanID                    uint
	Token, XrayUUID, Status, SuspensionReason string
	TrafficUsed, TrafficLimit                 int64
	DeviceLimit                               int
	ExpiresAt, StartedAt                      time.Time
}

func readRenewalState(t *testing.T, customerID, planID uint) renewalState {
	t.Helper()
	var s renewalState
	if err := testDB.Raw("SELECT * FROM customer_subscriptions WHERE customer_id=? AND plan_id=? ORDER BY id LIMIT 1", customerID, planID).Scan(&s).Error; err != nil {
		t.Fatal(err)
	}
	return s
}

func purchaseRenewal(t *testing.T, cid, pid uint) uint {
	t.Helper()
	order, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = testH.updateOrderStatus(fmt.Sprint(order.ID), "paid"); err != nil {
		t.Fatal(err)
	}
	return order.ID
}

func renewalFixture(t *testing.T) (uint, uint) {
	t.Helper()
	resetDB(t)
	return insertTestCustomer(t, "renewal@test.com"), insertTestPlan(t, "Renewal")
}

func TestRenewalPreservesIdentityTrafficAndBindings(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	original := readRenewalState(t, cid, pid)
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=123,traffic_limit=987654,device_limit=7 WHERE id=?", original.ID)
	insertSubTestNode(t, "aabbccddeeff")
	mustExec(t, "UPDATE nodes SET bound_subscription_id=? WHERE mac='aabbccddeeff'", original.ID)
	oid := purchaseRenewal(t, cid, pid)
	for i := 0; i < 2; i++ {
		if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "paid"); err != nil {
			t.Fatal(err)
		}
	}
	renewed := readRenewalState(t, cid, pid)
	if renewed.ID != original.ID || renewed.Token != original.Token || renewed.XrayUUID != original.XrayUUID {
		t.Fatal("renewal replaced subscription identity")
	}
	if !renewed.ExpiresAt.Equal(original.ExpiresAt.AddDate(0, 0, 30)) {
		t.Fatalf("expiry=%s", renewed.ExpiresAt)
	}
	if renewed.TrafficUsed != 123 || renewed.TrafficLimit != 987654 || renewed.DeviceLimit != 7 || !renewed.StartedAt.Equal(original.StartedAt) {
		t.Fatalf("renewal changed entitlement or usage: %+v", renewed)
	}
	if scalar(t, "SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id=?", cid) != 1 {
		t.Fatal("duplicate subscription")
	}
	if scalar(t, "SELECT bound_subscription_id FROM nodes WHERE mac='aabbccddeeff'") != int64(original.ID) {
		t.Fatal("binding changed")
	}
	if scalar(t, "SELECT subscription_id FROM order_fulfillments WHERE order_id=?", oid) != int64(original.ID) {
		t.Fatal("wrong fulfillment")
	}
}

func TestRenewalExpiredStartsAtPaymentWithoutResettingTraffic(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)
	var s renewalState
	testDB.Raw("SELECT * FROM customer_subscriptions WHERE token=?", token).Scan(&s)
	mustExec(t, "UPDATE customer_subscriptions SET expires_at=?,status='expired',traffic_used=321 WHERE id=?", time.Now().UTC().AddDate(0, 0, -10), s.ID)
	oid := purchaseRenewal(t, s.CustomerID, s.PlanID)
	var paidAt time.Time
	testDB.Raw("SELECT paid_at FROM orders WHERE id=?", oid).Scan(&paidAt)
	renewed := readRenewalState(t, s.CustomerID, s.PlanID)
	if !renewed.ExpiresAt.Equal(paidAt.AddDate(0, 0, 30)) || renewed.Status != "active" || renewed.TrafficUsed != 321 || renewed.Token != token {
		t.Fatalf("expired renewal: %+v", renewed)
	}
}

func TestRenewalDifferentPlansRemainIndependent(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	before := readRenewalState(t, cid, pid)
	other := insertTestPlan(t, "Another")
	purchaseRenewal(t, cid, other)
	after := readRenewalState(t, cid, pid)
	if !after.ExpiresAt.Equal(before.ExpiresAt) || scalar(t, "SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id=?", cid) != 2 {
		t.Fatal("different plans merged")
	}
}

func TestRenewalConcurrentDistinctOrdersAccumulate(t *testing.T) {
	cid, pid := renewalFixture(t)
	var ids []uint
	for i := 0; i < 6; i++ {
		o, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, o.ID)
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(id uint) {
			defer wg.Done()
			if _, err := testH.updateOrderStatus(fmt.Sprint(id), "paid"); err != nil {
				t.Error(err)
			}
		}(id)
	}
	wg.Wait()
	var first time.Time
	testDB.Raw("SELECT granted_at FROM order_fulfillments ORDER BY sequence_id LIMIT 1").Scan(&first)
	s := readRenewalState(t, cid, pid)
	if !s.ExpiresAt.Equal(first.AddDate(0, 0, 180)) || scalar(t, "SELECT COUNT(*) FROM customer_subscriptions") != 1 {
		t.Fatalf("concurrent renewal lost time: %+v", s)
	}
}

func TestRenewalZeroPriceOrdersAlsoExtend(t *testing.T) {
	cid, pid := renewalFixture(t)
	mustExec(t, "UPDATE plans SET price=0 WHERE id=?", pid)
	first, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid})
	if err != nil {
		t.Fatal(err)
	}
	before := readRenewalState(t, cid, pid)
	second, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid})
	if err != nil {
		t.Fatal(err)
	}
	after := readRenewalState(t, cid, pid)
	if first.Status != "paid" || second.Status != "paid" || after.ID != before.ID || !after.ExpiresAt.Equal(before.ExpiresAt.AddDate(0, 0, 30)) {
		t.Fatal("zero-price order did not renew")
	}
}

func TestRenewalRefundPreservesOtherOrdersAndUsage(t *testing.T) {
	cid, pid := renewalFixture(t)
	first := purchaseRenewal(t, cid, pid)
	original := readRenewalState(t, cid, pid)
	second := purchaseRenewal(t, cid, pid)
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=456 WHERE id=?", original.ID)
	// A later plan edit must not change the duration revoked by a refund.
	mustExec(t, "UPDATE plans SET duration_days=90 WHERE id=?", pid)
	if _, err := testH.updateOrderStatus(fmt.Sprint(first), "refunded"); err != nil {
		t.Fatal(err)
	}
	after := readRenewalState(t, cid, pid)
	var secondPaid time.Time
	testDB.Raw("SELECT paid_at FROM orders WHERE id=?", second).Scan(&secondPaid)
	if after.Status != "active" || !after.ExpiresAt.Equal(secondPaid.AddDate(0, 0, 30)) || after.TrafficUsed != 456 {
		t.Fatalf("refunding old order destroyed later renewal: %+v", after)
	}
	if _, err := testH.updateOrderStatus(fmt.Sprint(second), "refunded"); err != nil {
		t.Fatal(err)
	}
	if readRenewalState(t, cid, pid).Status != "expired" {
		t.Fatal("fully refunded subscription remains active")
	}
}

func TestRenewalRefundAfterExpiredGapPreservesNewTerm(t *testing.T) {
	cid, pid := renewalFixture(t)
	first := purchaseRenewal(t, cid, pid)
	second := purchaseRenewal(t, cid, pid)
	now := time.Now().UTC().Truncate(time.Second)
	past := now.AddDate(0, 0, -60)
	mustExec(t, "UPDATE order_fulfillments SET granted_at=?,previous_expires_at=? WHERE order_id=?", past, past, first)
	mustExec(t, "UPDATE order_fulfillments SET granted_at=?,previous_expires_at=? WHERE order_id=?", now, past.AddDate(0, 0, 30), second)
	mustExec(t, "UPDATE customer_subscriptions SET expires_at=? WHERE customer_id=?", now.AddDate(0, 0, 30), cid)
	if _, err := testH.updateOrderStatus(fmt.Sprint(first), "refunded"); err != nil {
		t.Fatal(err)
	}
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(now.AddDate(0, 0, 30)) || got.Status != "active" {
		t.Fatalf("expired gap refund removed new term: %+v", got)
	}
}

func TestRenewalLatestRefundAndLaterRepurchase(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	before := readRenewalState(t, cid, pid)
	second := purchaseRenewal(t, cid, pid)
	if _, err := testH.updateOrderStatus(fmt.Sprint(second), "refunded"); err != nil {
		t.Fatal(err)
	}
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(before.ExpiresAt) {
		t.Fatal("latest refund did not restore prior expiry")
	}
	third := purchaseRenewal(t, cid, pid)
	if _, err := testH.updateOrderStatus(fmt.Sprint(third), "refunded"); err != nil {
		t.Fatal(err)
	}
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(before.ExpiresAt) {
		t.Fatal("repurchase after refund corrupted grant history")
	}
}

func TestRenewalManualExpiryChangeRefundRequiresReconciliation(t *testing.T) {
	cid, pid := renewalFixture(t)
	oid := purchaseRenewal(t, cid, pid)
	changed := time.Now().UTC().Truncate(time.Second).AddDate(0, 0, 45)
	mustExec(t, "UPDATE customer_subscriptions SET expires_at=? WHERE customer_id=?", changed, cid)
	_, err := testH.updateOrderStatus(fmt.Sprint(oid), "refunded")
	var invalid *orderRequestError
	if !errors.As(err, &invalid) || invalid.status != 409 {
		t.Fatalf("expected reconciliation conflict: %v", err)
	}
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(changed) || scalar(t, "SELECT COUNT(*) FROM orders WHERE id=? AND status='paid'", oid) != 1 {
		t.Fatal("refund overwrote manual expiry or payment")
	}
}

func TestRenewalFailureRollsBackAndCanRetry(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	before := readRenewalState(t, cid, pid)
	order, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, "CREATE TRIGGER fail_renewal BEFORE UPDATE ON customer_subscriptions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected renewal failure'")
	t.Cleanup(func() { testDB.Exec("DROP TRIGGER IF EXISTS fail_renewal") })
	if _, err := testH.updateOrderStatus(fmt.Sprint(order.ID), "paid"); err == nil {
		t.Fatal("expected failure")
	}
	if scalar(t, "SELECT COUNT(*) FROM order_fulfillments WHERE order_id=?", order.ID) != 0 {
		t.Fatal("partial grant persisted")
	}
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(before.ExpiresAt) {
		t.Fatal("failed renewal changed expiry")
	}
	mustExec(t, "DROP TRIGGER fail_renewal")
	if _, err := testH.updateOrderStatus(fmt.Sprint(order.ID), "paid"); err != nil {
		t.Fatal(err)
	}
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(before.ExpiresAt.AddDate(0, 0, 30)) {
		t.Fatal("retry did not extend exactly once")
	}
}

func TestRenewalQuotaSuspensionResetsMonthlyButManualPauseDoesNot(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	s := readRenewalState(t, cid, pid)
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=traffic_limit WHERE id=?", s.ID)
	testH.suspendOverTraffic(time.Now().UTC().Format("2006-01-02 15:04:05"))
	purchaseRenewal(t, cid, pid)
	renewed := readRenewalState(t, cid, pid)
	if renewed.Status != "suspended" || renewed.SuspensionReason != "traffic" || renewed.TrafficUsed != s.TrafficLimit {
		t.Fatal("renewal bypassed quota")
	}
	nextMonth := time.Now().UTC().AddDate(0, 1, 0)
	testH.resetTrafficAt(nextMonth)
	renewed = readRenewalState(t, cid, pid)
	if renewed.Status != "active" || renewed.TrafficUsed != 0 {
		t.Fatalf("quota reset did not restore renewed subscription: %+v", renewed)
	}
	// A second loop pass in the same month must not erase newly reported usage.
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=77 WHERE id=?", s.ID)
	testH.resetMonthlyTraffic(nextMonth, "")
	if readRenewalState(t, cid, pid).TrafficUsed != 77 {
		t.Fatal("monthly reset applied twice")
	}
	mustExec(t, "UPDATE customer_subscriptions SET status='suspended',suspension_reason='manual' WHERE id=?", s.ID)
	purchaseRenewal(t, cid, pid)
	testH.resetTrafficAt(nextMonth.AddDate(0, 1, 0))
	if got := readRenewalState(t, cid, pid); got.Status != "suspended" || got.TrafficUsed != 77 {
		t.Fatal("manual pause was cleared")
	}
}

func TestRenewalLegacyDuplicatesChooseExistingActiveSubscription(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	original := readRenewalState(t, cid, pid)
	mustExec(t, `INSERT INTO customer_subscriptions (customer_id,plan_id,token,xray_uuid,traffic_used,traffic_limit,device_limit,started_at,expires_at,status,created_at,updated_at)
        SELECT customer_id,plan_id,?,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',0,traffic_limit,device_limit,started_at,DATE_ADD(expires_at,INTERVAL 100 DAY),'suspended',created_at,updated_at FROM customer_subscriptions WHERE id=?`, strings.Repeat("f", 64), original.ID)
	purchaseRenewal(t, cid, pid)
	if got := readRenewalState(t, cid, pid); !got.ExpiresAt.Equal(original.ExpiresAt.AddDate(0, 0, 30)) {
		t.Fatal("renewal did not select active subscription")
	}
	if scalar(t, "SELECT COUNT(*) FROM customer_subscriptions") != 2 {
		t.Fatal("historical subscriptions were merged or replaced")
	}
}

func TestAdminCustomerStatusAndSubscriptionPauseAreIndependent(t *testing.T) {
	cid, pid := renewalFixture(t)
	purchaseRenewal(t, cid, pid)
	sub := readRenewalState(t, cid, pid)
	for _, status := range []string{"suspended", "active"} {
		resp := doJSON("PATCH", fmt.Sprintf("/admin/customers/%d", cid), map[string]string{"status": status}, adminCookie())
		assertStatus(t, resp, 200)
		resp.Body.Close()
	}
	mustExec(t, "UPDATE customer_subscriptions SET status='suspended', suspension_reason='traffic', traffic_used=traffic_limit WHERE id=?", sub.ID)
	resp := doJSON("PATCH", fmt.Sprintf("/admin/subscriptions/%d", sub.ID), map[string]string{"status": "suspended"}, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	purchaseRenewal(t, cid, pid)
	testH.resetTrafficAt(time.Now().UTC().AddDate(0, 1, 0))
	if got := readRenewalState(t, cid, pid); got.Status != "suspended" || got.SuspensionReason != "manual" || got.TrafficUsed != sub.TrafficLimit {
		t.Fatalf("admin pause was undone by renewal/monthly reset: %+v", got)
	}
	resp = doJSON("PATCH", fmt.Sprintf("/admin/subscriptions/%d", sub.ID), map[string]string{"status": "active"}, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if got := readRenewalState(t, cid, pid); got.Status != "active" || got.SuspensionReason != "" {
		t.Fatalf("activation retained stale pause reason: %+v", got)
	}
}
