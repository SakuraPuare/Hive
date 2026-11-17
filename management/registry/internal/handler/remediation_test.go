package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

func mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if err := testDB.Exec(query, args...).Error; err != nil {
		t.Fatal(err)
	}
}
func scalar(t *testing.T, query string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := testDB.Raw(query, args...).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDeviceCredentialsAreMACScopedAndCannotAdminister(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	token := deviceToken(t, mac)
	for _, path := range []string{"/nodes/112233445566/xray-users", "/nodes/112233445566/commands", "/nodes/112233445566/ota-version", "/nodes/112233445566/clash-config", "/admin/customers", "/admin/ota/rollouts"} {
		resp := doBearer("GET", path, nil, token)
		assertStatus(t, resp, http.StatusUnauthorized)
		resp.Body.Close()
	}
	for _, path := range []string{"/nodes/heartbeat", "/nodes/register", "/nodes/allocate-easytier"} {
		resp := doBearer("POST", path, map[string]string{"mac": "112233445566"}, token)
		assertStatus(t, resp, http.StatusUnauthorized)
		resp.Body.Close()
	}
	resp := doBearer("POST", "/nodes/"+mac+"/xray-users", emptyNodeReport(), token)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doBearer("GET", "/admin/customers", nil, testCfg.APISecret)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doBearer("POST", "/nodes/"+mac+"/xray-users", emptyNodeReport(), testCfg.APISecret)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doJSON("POST", "/admin/nodes/"+mac+"/credential", nil, adminCookie())
	assertStatus(t, resp, 200)
	rotated := parseJSON(resp)["token"].(string)
	resp = doBearer("POST", "/nodes/"+mac+"/xray-users", emptyNodeReport(), token)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doBearer("POST", "/nodes/"+mac+"/xray-users", emptyNodeReport(), rotated)
	assertStatus(t, resp, 200)
	resp.Body.Close()
}

func TestUserWriterCannotCreateSuperadmin(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "writer", "password123", "admin")
	mustExec(t, "INSERT INTO user_permissions (user_id,permission_id) SELECT ?,id FROM permissions WHERE slug = 'user:write'", uid)
	for _, role := range []string{"superadmin", "SUPERADMIN", "superádmin"} {
		resp := doJSON("POST", "/admin/users", map[string]string{"username": "elevated", "password": "password123", "role": role}, userCookieWithRole("writer", "admin"))
		assertStatus(t, resp, 403)
		resp.Body.Close()
	}
	if n := scalar(t, "SELECT COUNT(*) FROM users WHERE username='elevated'"); n != 0 {
		t.Fatalf("created %d privileged users", n)
	}
}

func TestBootstrapPreservesRevocations(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "revoked", "password123", "admin")
	mustExec(t, "DELETE rp FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.name='admin' AND p.slug='node:write'")
	mustExec(t, "DELETE FROM user_roles WHERE user_id=?", uid)
	store.BootstrapRBAC(testDB)
	if n := scalar(t, "SELECT COUNT(*) FROM user_roles WHERE user_id=?", uid); n != 0 {
		t.Fatal("revoked role restored")
	}
	if n := scalar(t, "SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.name='admin' AND p.slug='node:write'"); n != 0 {
		t.Fatal("revoked permission restored")
	}
}

func TestResetChallengeLocksAfterFiveAttempts(t *testing.T) {
	resetDB(t)
	email := "attempts@example.com"
	insertTestCustomer(t, email)
	insertResetCode(t, email, "123456", time.Now().Add(time.Minute), false)
	// Call the handler directly to model attempts from different IPs. The
	// persisted challenge limit must work independently of the IP limiter.
	call := func(code string) int {
		body, _ := json.Marshal(map[string]string{"email": strings.ToUpper(email), "code": code, "password": "replacement123"})
		req := httptest.NewRequest("POST", "/portal/reset-password", bytes.NewReader(body))
		rr := httptest.NewRecorder()
		testH.HandleResetPassword(rr, req)
		return rr.Code
	}
	for i := 0; i < 5; i++ {
		if code := call("000000"); code != 400 {
			t.Fatalf("wrong code status %d", code)
		}
	}
	if code := call("123456"); code != 400 {
		t.Fatalf("exhausted challenge accepted: %d", code)
	}
	if n := scalar(t, "SELECT attempts FROM password_reset_codes WHERE email=?", email); n != 5 {
		t.Fatalf("attempts=%d", n)
	}
}

func TestConcurrentOrdersCannotDoubleSpendBalance(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "balance@example.com")
	pid := insertTestPlan(t, "balance")
	mustExec(t, "UPDATE customers SET balance=1000 WHERE id=?", cid)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid, UseBalance: true})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n := scalar(t, "SELECT balance FROM customers WHERE id=?", cid); n != 0 {
		t.Fatalf("balance=%d", n)
	}
	if n := scalar(t, "SELECT SUM(balance_deducted) FROM orders WHERE customer_id=?", cid); n != 1000 {
		t.Fatalf("deducted=%d", n)
	}
	if n := scalar(t, "SELECT COUNT(*) FROM orders WHERE customer_id=? AND status='paid' AND amount=0", cid); n != 1 {
		t.Fatalf("free paid orders=%d", n)
	}
	if n := scalar(t, "SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id=?", cid); n != 1 {
		t.Fatalf("subscriptions=%d", n)
	}
}

func TestOrderFailureRollsBackBalanceAndPayment(t *testing.T) {
	resetDB(t)
	oid, cid, pid := insertTestOrder(t)
	mustExec(t, "UPDATE customers SET balance=1000 WHERE id=?", cid)
	mustExec(t, "CREATE TRIGGER fail_fulfillment BEFORE INSERT ON customer_subscriptions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected fulfillment failure'")
	t.Cleanup(func() { testDB.Exec("DROP TRIGGER IF EXISTS fail_fulfillment") })
	if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "paid"); err == nil {
		t.Fatal("expected payment failure")
	}
	if _, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid, UseBalance: true}); err == nil {
		t.Fatal("expected zero-order failure")
	}
	if n := scalar(t, "SELECT balance FROM customers WHERE id=?", cid); n != 1000 {
		t.Fatalf("balance lost: %d", n)
	}
	if n := scalar(t, "SELECT COUNT(*) FROM orders WHERE status='pending'"); n != 1 {
		t.Fatalf("orders=%d", n)
	}
	if n := scalar(t, "SELECT COUNT(*) FROM order_fulfillments"); n != 0 {
		t.Fatal("partial fulfillment persisted")
	}
	mustExec(t, "DROP TRIGGER fail_fulfillment")
	if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "paid"); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentPaymentAndRefundAreIdempotent(t *testing.T) {
	resetDB(t)
	oid, cid, _ := insertTestOrder(t)
	referrer := insertTestCustomer(t, "referrer@example.com")
	mustExec(t, "UPDATE customers SET referred_by=? WHERE id=?", referrer, cid)
	mustExec(t, "UPDATE orders SET balance_deducted=300 WHERE id=?", oid)
	errs := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := testH.updateOrderStatus(fmt.Sprint(oid), "paid"); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n := scalar(t, "SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id=?", cid); n != 1 {
		t.Fatalf("duplicate subscriptions: %d", n)
	}
	if n := scalar(t, "SELECT COUNT(*) FROM referrals WHERE order_id=?", oid); n != 1 {
		t.Fatalf("duplicate commission: %d", n)
	}
	for i := 0; i < 2; i++ {
		if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "refunded"); err != nil {
			t.Fatal(err)
		}
	}
	if n := scalar(t, "SELECT balance FROM customers WHERE id=?", cid); n != 300 {
		t.Fatalf("refund=%d", n)
	}
	if n := scalar(t, "SELECT balance FROM customers WHERE id=?", referrer); n != 0 {
		t.Fatalf("commission not reversed: %d", n)
	}
	if n := scalar(t, "SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id=? AND status='active'", cid); n != 0 {
		t.Fatal("refunded service remains active")
	}
	if _, err := testH.updateOrderStatus(fmt.Sprint(oid), "paid"); err == nil {
		t.Fatal("refunded order paid again")
	}
}

func TestStaleOrderReturnsBalanceOnce(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "stale@example.com")
	pid := insertTestPlan(t, "stale")
	mustExec(t, "UPDATE customers SET balance=300 WHERE id=?", cid)
	o, err := testH.createCustomerOrder(cid, PortalCreateOrderRequest{PlanID: pid, UseBalance: true})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, "UPDATE orders SET created_at=? WHERE id=?", time.Now().UTC().Add(-time.Hour), o.ID)
	testH.cancelStaleOrders("")
	testH.cancelStaleOrders("")
	if n := scalar(t, "SELECT balance FROM customers WHERE id=?", cid); n != 300 {
		t.Fatalf("balance=%d", n)
	}
}

func TestExpiredCustomerCanRenew(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "renew@example.com")
	pid := insertTestPlan(t, "renew")
	insertTestSubscription(t, cid, pid, "expired", time.Now().Add(-time.Hour))
	mustExec(t, "UPDATE customers SET status='suspended' WHERE id=?", cid)
	resp := doJSON("POST", "/portal/login", map[string]string{"email": "renew@example.com", "password": "test123"}, nil)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("POST", "/portal/orders", map[string]any{"plan_id": pid}, customerCookie(cid))
	assertStatus(t, resp, 200)
	resp.Body.Close()
}

func TestInvalidGatewaySubscriptionDoesNotFallBack(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	insertTestNode(t, "112233445566")
	cid := insertTestCustomer(t, "gateway@example.com")
	pid := insertTestPlan(t, "gateway")
	sid := insertTestSubscription(t, cid, pid, "expired", time.Now().Add(-time.Hour))
	mustExec(t, "UPDATE nodes SET bound_subscription_id=? WHERE mac=?", sid, mac)
	resp := doBearer("GET", "/nodes/"+mac+"/clash-config", nil, deviceToken(t, mac))
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "MATCH,REJECT") || strings.Contains(string(body), "type: vless") {
		t.Fatalf("invalid gateway retained upstream credentials: %s", body)
	}
}

func TestTrafficSumsNodesAndDeduplicatesTransport(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"status":"success","data":{"result":[
            {"metric":{"target":"sub-1","instance":"node-a","transport":"easytier"},"value":[0,"100"]},
            {"metric":{"target":"sub-1","instance":"node-a","transport":"tailscale"},"value":[0,"100"]},
            {"metric":{"target":"sub-1","instance":"node-b","transport":"easytier"},"value":[0,"200"]}]}}`)
	}))
	defer server.Close()
	cfg := *testCfg
	cfg.PrometheusURL = server.URL
	h := &Handler{Config: &cfg}
	if n := h.promQueryInstantByLabel("traffic", "target", false, true)["sub-1"]; n != 300 {
		t.Fatalf("traffic=%v, want 300", n)
	}
}

func TestOldOTAAcknowledgementCannotCompleteNewAssignment(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	now := time.Now().UTC().Format(model.TimeLayout)
	mustExec(t, "INSERT INTO ota_rollouts (version,url,sha256,created_by,created_at) VALUES ('1','https://example.com/ota',?,'admin',?)", strings.Repeat("a", 64), now)
	var rid uint
	testDB.Raw("SELECT id FROM ota_rollouts LIMIT 1").Scan(&rid)
	if testH.assignNodesToRollout(rid, []string{mac}, now) != 1 {
		t.Fatal("assign failed")
	}
	var oldToken string
	testDB.Raw("SELECT assignment_token FROM ota_assignments WHERE node_mac=?", mac).Scan(&oldToken)
	if testH.assignNodesToRollout(rid, []string{mac}, now) != 1 {
		t.Fatal("reassign failed")
	}
	resp := doBearer("POST", "/nodes/"+mac+"/ota-ack", map[string]string{"version": "1", "status": "done", "assignment_token": oldToken}, deviceToken(t, mac))
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if n := scalar(t, "SELECT COUNT(*) FROM ota_assignments WHERE status='pending'"); n != 1 {
		t.Fatal("old acknowledgement completed new assignment")
	}
}
