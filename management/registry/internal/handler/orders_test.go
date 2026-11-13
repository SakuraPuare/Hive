package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/model"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func insertTestOrder(t *testing.T) (orderID, customerID, planID uint) {
	t.Helper()
	customerID = insertTestCustomer(t, "order@test.com")
	planID = insertTestPlan(t, "OrderPlan")
	now := time.Now().UTC().Format(model.TimeLayout)
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO orders (order_no, customer_id, plan_id, amount, original_amount, status, created_at, updated_at)
		VALUES (?, ?, ?, 1000, 1000, 'pending', ?, ?)`,
			"HV20250101000000ab", customerID, planID, now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&orderID).Error
	}); err != nil {
		t.Fatalf("insert test order: %v", err)
	}
	return
}

// ── Orders ───────────────────────────────────────────────────────────────────

func TestListOrders(t *testing.T) {
	resetDB(t)
	oid, _, _ := insertTestOrder(t)

	resp := doJSON("GET", "/admin/orders", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total, _ := body["total"].(float64)
	if int(total) != 1 {
		t.Fatalf("expected total=1, got %v", body["total"])
	}
	items, _ := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	first := items[0].(map[string]any)
	if uint(first["id"].(float64)) != oid {
		t.Fatalf("expected order id=%d, got %v", oid, first["id"])
	}
}

func TestListOrders_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/orders", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total, _ := body["total"].(float64)
	if int(total) != 0 {
		t.Fatalf("expected total=0, got %v", body["total"])
	}
}

func TestListOrders_FilterByStatus(t *testing.T) {
	resetDB(t)
	insertTestOrder(t) // status = pending

	resp := doJSON("GET", "/admin/orders?status=paid", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total, _ := body["total"].(float64)
	if int(total) != 0 {
		t.Fatalf("expected total=0 for status=paid filter, got %v", body["total"])
	}

	resp = doJSON("GET", "/admin/orders?status=pending", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	total, _ = body["total"].(float64)
	if int(total) != 1 {
		t.Fatalf("expected total=1 for status=pending filter, got %v", body["total"])
	}
}

func TestListOrders_FilterByCustomerID(t *testing.T) {
	resetDB(t)
	_, cid, _ := insertTestOrder(t)

	resp := doJSON("GET", fmt.Sprintf("/admin/orders?customer_id=%d", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total, _ := body["total"].(float64)
	if int(total) != 1 {
		t.Fatalf("expected total=1, got %v", body["total"])
	}

	// non-existent customer
	resp = doJSON("GET", "/admin/orders?customer_id=99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	total, _ = body["total"].(float64)
	if int(total) != 0 {
		t.Fatalf("expected total=0, got %v", body["total"])
	}
}

func TestGetOrder(t *testing.T) {
	resetDB(t)
	oid, cid, pid := insertTestOrder(t)

	resp := doJSON("GET", fmt.Sprintf("/admin/orders/%d", oid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if uint(body["id"].(float64)) != oid {
		t.Fatalf("expected id=%d, got %v", oid, body["id"])
	}
	if body["order_no"] != "HV20250101000000ab" {
		t.Fatalf("expected order_no=HV20250101000000ab, got %v", body["order_no"])
	}
	if uint(body["customer_id"].(float64)) != cid {
		t.Fatalf("expected customer_id=%d, got %v", cid, body["customer_id"])
	}
	if uint(body["plan_id"].(float64)) != pid {
		t.Fatalf("expected plan_id=%d, got %v", pid, body["plan_id"])
	}
	if body["status"] != "pending" {
		t.Fatalf("expected status=pending, got %v", body["status"])
	}
}

func TestGetOrder_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/orders/99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestUpdateOrderStatus(t *testing.T) {
	resetDB(t)
	oid, _, _ := insertTestOrder(t)

	resp := doJSON("PATCH", fmt.Sprintf("/admin/orders/%d/status", oid), map[string]any{
		"status": "paid",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// verify the order is now paid
	resp = doJSON("GET", fmt.Sprintf("/admin/orders/%d", oid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body = parseJSON(resp)
	if body["status"] != "paid" {
		t.Fatalf("expected status=paid after update, got %v", body["status"])
	}
}

func TestUpdateOrderStatus_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("PATCH", "/admin/orders/99999/status", map[string]any{
		"status": "paid",
	}, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestRefundAfterReferrerDeletion(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "referee@example.com")
	pid := insertTestPlan(t, "ReferredPlan")
	referrer := insertTestCustomer(t, "referrer@example.com")
	mustExec(t, "UPDATE customers SET balance=300, referred_by=? WHERE id=?", referrer, cid)
	order, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid, UseBalance: true})
	if err != nil {
		t.Fatal(err)
	}
	if order.Amount != 700 || order.BalanceDeducted != 300 {
		t.Fatalf("unexpected payment amounts: %+v", order)
	}
	path := fmt.Sprintf("/admin/orders/%d/status", order.ID)
	resp := doJSON("PATCH", path, map[string]string{"status": "paid"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	before := readRenewalState(t, cid, pid)
	if before.ID == 0 || before.Status != "active" {
		t.Fatalf("payment did not activate subscription: %+v", before)
	}
	rid := scalar(t, "SELECT referral_id FROM order_fulfillments WHERE order_id=?", order.ID)
	if rid == 0 || scalar(t, "SELECT balance FROM customers WHERE id=?", referrer) != 70 {
		t.Fatal("payment did not credit referral")
	}
	if scalar(t, "SELECT COUNT(*) FROM orders WHERE customer_id=?", referrer) != 0 {
		t.Fatal("referrer must have no orders")
	}
	resp = doJSON("DELETE", fmt.Sprintf("/admin/customers/%d", referrer), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if scalar(t, "SELECT COUNT(*) FROM customers WHERE id=?", referrer) != 0 || scalar(t, "SELECT COUNT(*) FROM referrals WHERE id=?", rid) != 0 {
		t.Fatal("deleting referrer did not cascade referral deletion")
	}
	if scalar(t, "SELECT referral_id FROM order_fulfillments WHERE order_id=?", order.ID) != rid {
		t.Fatal("historical fulfillment must retain its referral ID")
	}
	// Only refunds may tolerate a missing historical referral.
	resp = doJSON("PATCH", fmt.Sprintf("/admin/referrals/%d", rid), map[string]string{"status": "cancelled"}, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	for range 2 {
		resp = doJSON("PATCH", path, map[string]string{"status": "refunded"}, adminCookie())
		assertStatus(t, resp, http.StatusOK)
		resp.Body.Close()
		var refunded model.Order
		if err := testDB.Raw("SELECT * FROM orders WHERE id=?", order.ID).Scan(&refunded).Error; err != nil {
			t.Fatal(err)
		}
		if refunded.Status != "refunded" || !refunded.BalanceReturned || refunded.Amount != 700 || refunded.BalanceDeducted != 300 || refunded.OriginalAmount != 1000 {
			t.Fatalf("refund did not preserve payment accounting: %+v", refunded)
		}
		if balance := scalar(t, "SELECT balance FROM customers WHERE id=?", cid); balance != 300 {
			t.Fatalf("refunded balance=%d, want 300", balance)
		}
		after := readRenewalState(t, cid, pid)
		if after.ID != before.ID || after.Status != "expired" || !after.ExpiresAt.Before(before.ExpiresAt) || after.ExpiresAt.After(time.Now().UTC()) {
			t.Fatalf("refund did not revoke subscription time: %+v", after)
		}
	}
}

func TestReferralStatusChangesPreserveCommission(t *testing.T) {
	resetDB(t)
	oid, cid, _ := insertTestOrder(t)
	referrer := insertTestCustomer(t, "commission@example.com")
	mustExec(t, "UPDATE customers SET referred_by=? WHERE id=?", referrer, cid)
	if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "paid"); err != nil {
		t.Fatal(err)
	}
	rid := scalar(t, "SELECT referral_id FROM order_fulfillments WHERE order_id=?", oid)
	if rid == 0 || scalar(t, "SELECT balance FROM customers WHERE id=?", referrer) != 100 {
		t.Fatal("payment did not credit commission")
	}
	// Spending commission must not erase the debt when it is cancelled.
	mustExec(t, "UPDATE customers SET balance=20 WHERE id=?", referrer)
	for _, step := range []struct {
		status  string
		balance int64
	}{{"cancelled", -80}, {"cancelled", -80}, {"paid", 20}, {"paid", 20}, {"pending", 20}} {
		resp := doJSON("PATCH", fmt.Sprintf("/admin/referrals/%d", rid), map[string]string{"status": step.status}, adminCookie())
		assertStatus(t, resp, http.StatusOK)
		resp.Body.Close()
		if balance := scalar(t, "SELECT balance FROM customers WHERE id=?", referrer); balance != step.balance {
			t.Fatalf("referral %s balance=%d, want %d", step.status, balance, step.balance)
		}
	}
	for range 2 {
		if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "refunded"); err != nil {
			t.Fatal(err)
		}
		if scalar(t, "SELECT balance FROM customers WHERE id=?", referrer) != -80 || scalar(t, "SELECT COUNT(*) FROM referrals WHERE id=? AND status='cancelled'", rid) != 1 {
			t.Fatal("refund did not cancel commission exactly once")
		}
	}
	resp := doJSON("PATCH", fmt.Sprintf("/admin/referrals/%d", rid), map[string]string{"status": "paid"}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	if scalar(t, "SELECT balance FROM customers WHERE id=?", referrer) != -80 {
		t.Fatal("refunded order restored commission")
	}
}

// ── Promo Codes ──────────────────────────────────────────────────────────────

func TestCreatePromoCode(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/promo-codes", map[string]any{
		"code":         "SAVE10",
		"discount_pct": 10,
		"max_uses":     100,
		"valid_from":   "2025-01-01 00:00:00",
		"valid_to":     "2025-12-31 23:59:59",
		"enabled":      true,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["id"] == nil || body["id"].(float64) == 0 {
		t.Fatalf("expected non-zero id, got %v", body["id"])
	}
}

func TestListPromoCodes(t *testing.T) {
	resetDB(t)

	// create one first
	doJSON("POST", "/admin/promo-codes", map[string]any{
		"code":         "LIST10",
		"discount_pct": 10,
		"max_uses":     50,
		"valid_from":   "2025-01-01 00:00:00",
		"valid_to":     "2025-12-31 23:59:59",
		"enabled":      true,
	}, adminCookie())

	resp := doJSON("GET", "/admin/promo-codes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 1 {
		t.Fatalf("expected 1 promo code, got %d", len(items))
	}
	if items[0]["code"] != "LIST10" {
		t.Fatalf("expected code=LIST10, got %v", items[0]["code"])
	}
}

func TestListPromoCodes_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/promo-codes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 promo codes, got %d", len(items))
	}
}

func TestUpdatePromoCode(t *testing.T) {
	resetDB(t)

	// create
	resp := doJSON("POST", "/admin/promo-codes", map[string]any{
		"code":         "UPD10",
		"discount_pct": 10,
		"valid_from":   "2025-01-01 00:00:00",
		"valid_to":     "2025-12-31 23:59:59",
		"enabled":      true,
	}, adminCookie())
	body := parseJSON(resp)
	promoID := int(body["id"].(float64))

	// update
	resp = doJSON("PATCH", fmt.Sprintf("/admin/promo-codes/%d", promoID), map[string]any{
		"discount_pct": 20,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// verify via list
	resp = doJSON("GET", "/admin/promo-codes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	items := parseJSONArray(resp)
	if len(items) == 0 {
		t.Fatal("expected at least 1 promo code")
	}
	if int(items[0]["discount_pct"].(float64)) != 20 {
		t.Fatalf("expected discount_pct=20, got %v", items[0]["discount_pct"])
	}
}

func TestDeletePromoCode(t *testing.T) {
	resetDB(t)

	// create
	resp := doJSON("POST", "/admin/promo-codes", map[string]any{
		"code":         "DEL10",
		"discount_pct": 10,
		"valid_from":   "2025-01-01 00:00:00",
		"valid_to":     "2025-12-31 23:59:59",
		"enabled":      true,
	}, adminCookie())
	body := parseJSON(resp)
	promoID := int(body["id"].(float64))

	// delete
	resp = doJSON("DELETE", fmt.Sprintf("/admin/promo-codes/%d", promoID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// verify gone
	resp = doJSON("GET", "/admin/promo-codes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	items := parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 promo codes after delete, got %d", len(items))
	}
}

// ── Permission denied ────────────────────────────────────────────────────────

func TestOrders_PermissionDenied(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer1", "pass123", "viewer")
	cookie := userCookieWithRole("viewer1", "viewer")

	oid, _, _ := insertTestOrder(t)

	// viewer has no order:read
	resp := doJSON("GET", "/admin/orders", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	resp = doJSON("GET", fmt.Sprintf("/admin/orders/%d", oid), nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// viewer has no order:write
	resp = doJSON("PATCH", fmt.Sprintf("/admin/orders/%d/status", oid), map[string]any{
		"status": "paid",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// promo-codes
	resp = doJSON("GET", "/admin/promo-codes", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	resp = doJSON("POST", "/admin/promo-codes", map[string]any{
		"code":         "NOPE",
		"discount_pct": 5,
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	resp = doJSON("PATCH", "/admin/promo-codes/1", map[string]any{
		"discount_pct": 99,
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	resp = doJSON("DELETE", "/admin/promo-codes/1", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestCancelUnpaidOrderReleasesPromoCode(t *testing.T) {
	// A pending order reserves a redemption immediately. Without a release, one
	// abandoned order burns a max_uses=1 code forever.
	resetDB(t)
	cid := insertTestCustomer(t, "promo-release@example.com")
	pid := insertTestPlan(t, "PromoPlan")
	promoID := insertTestPromoCode(t, "ONESHOT", 10)
	mustExec(t, "UPDATE promo_codes SET max_uses = 1 WHERE id = ?", promoID)

	order, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid, PromoCode: "ONESHOT"})
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if used := scalar(t, "SELECT used_count FROM promo_codes WHERE id = ?", promoID); used != 1 {
		t.Fatalf("after order used_count=%d, want 1", used)
	}
	if _, err := testH.updateOrderStatus(fmt.Sprintf("%d", order.ID), "cancelled"); err != nil {
		t.Fatalf("cancel order: %v", err)
	}
	if used := scalar(t, "SELECT used_count FROM promo_codes WHERE id = ?", promoID); used != 0 {
		t.Fatalf("after cancel used_count=%d, want 0", used)
	}
	// The code is usable again by the next customer.
	other := insertTestCustomer(t, "promo-release-2@example.com")
	if _, err := testH.createCustomerOrder(other, PortalCreateOrderRequest{PlanID: pid, PromoCode: "ONESHOT"}); err != nil {
		t.Fatalf("released promo rejected: %v", err)
	}
}

func TestUpdatePromoCodeAppliesCodeAndReportsMissing(t *testing.T) {
	resetDB(t)
	resp := doJSON("POST", "/admin/promo-codes", map[string]any{
		"code": "OLDCODE", "discount_pct": 5,
		"valid_from": "2020-01-01 00:00:00", "valid_to": "2099-12-31 23:59:59",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	id := uint(parseJSON(resp)["id"].(float64))

	resp = doJSON("PATCH", fmt.Sprintf("/admin/promo-codes/%d", id), map[string]any{"code": "NEWCODE"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var code string
	testDB.Raw("SELECT code FROM promo_codes WHERE id = ?", id).Scan(&code)
	if code != "NEWCODE" {
		t.Fatalf("stored code=%q, want NEWCODE", code)
	}

	resp = doJSON("PATCH", "/admin/promo-codes/999999", map[string]any{"discount_pct": 7}, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	resp = doJSON("DELETE", "/admin/promo-codes/999999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}
