package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestListCustomers_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/customers", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestCreateCustomer(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/customers", map[string]string{
		"email":    "test@example.com",
		"password": "pass1234",
		"nickname": "tester",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestGetCustomer(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "get@example.com")

	resp := doJSON("GET", fmt.Sprintf("/admin/customers/%d", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	customer := body["customer"].(map[string]any)
	if customer["email"] != "get@example.com" {
		t.Fatalf("expected email=get@example.com, got %v", customer["email"])
	}
}

func TestUpdateCustomer(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "upd@example.com")

	resp := doJSON("PATCH", fmt.Sprintf("/admin/customers/%d", cid), map[string]any{
		"nickname": "updated",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestDeleteCustomer(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "del@example.com")

	resp := doJSON("DELETE", fmt.Sprintf("/admin/customers/%d", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证已删除
	resp = doJSON("GET", fmt.Sprintf("/admin/customers/%d", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestCustomerSubscription(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "sub@example.com")
	planID := insertTestPlan(t, "Test Plan")

	// 创建订阅
	resp := doJSON("POST", fmt.Sprintf("/admin/customers/%d/subscriptions", cid), map[string]any{
		"plan_id": planID,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 列出订阅
	resp = doJSON("GET", fmt.Sprintf("/admin/customers/%d/subscriptions", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestResetCustomerPassword(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "pw@example.com")

	resp := doJSON("POST", fmt.Sprintf("/admin/customers/%d/password", cid), map[string]string{
		"password": "newpass1",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestDeleteCustomerWithOrdersIsRejected(t *testing.T) {
	// orders.customer_id has no ON DELETE action. Deleting the row would destroy
	// financial history and used to surface as a raw MySQL 1451 error.
	resetDB(t)
	_, cid, _ := insertTestOrder(t)

	resp := doJSON("DELETE", fmt.Sprintf("/admin/customers/%d", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusConflict)
	resp.Body.Close()

	if scalar(t, "SELECT COUNT(*) FROM customers WHERE id = ?", cid) != 1 {
		t.Fatal("customer removed despite existing orders")
	}
	if scalar(t, "SELECT COUNT(*) FROM orders WHERE customer_id = ?", cid) != 1 {
		t.Fatal("order removed as a side effect")
	}
}

func TestResetCustomerPasswordRevokesSession(t *testing.T) {
	resetDB(t)
	const email = "reset-session@example.com"
	cid := insertTestCustomer(t, email)
	stolen := customerCookie(cid)

	resp := doJSON("POST", fmt.Sprintf("/admin/customers/%d/password", cid),
		map[string]string{"password": "brandnew123"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	resp = doJSON("GET", "/portal/me", nil, stolen)
	assertStatus(t, resp, http.StatusUnauthorized)
	resp.Body.Close()
}

func TestUnbanRestoresBanSuspendedSubscription(t *testing.T) {
	// Ban suspends the paid subscription; unban must hand the same service back
	// instead of leaving the customer suspended until an admin notices.
	resetDB(t)
	cid := insertTestCustomer(t, "unban@example.com")
	pid := insertTestPlan(t, "UnbanPlan")
	subID := insertTestSubscription(t, cid, pid, "active", time.Now().UTC().Add(10*24*time.Hour))

	resp := doJSON("POST", fmt.Sprintf("/admin/customers/%d/ban", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	var status, reason string
	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", subID).Scan(&status)
	testDB.Raw("SELECT suspension_reason FROM customer_subscriptions WHERE id = ?", subID).Scan(&reason)
	if status != "suspended" || reason != "ban" {
		t.Fatalf("after ban status=%q reason=%q, want suspended/ban", status, reason)
	}

	resp = doJSON("POST", fmt.Sprintf("/admin/customers/%d/unban", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", subID).Scan(&status)
	testDB.Raw("SELECT suspension_reason FROM customer_subscriptions WHERE id = ?", subID).Scan(&reason)
	if status != "active" || reason != "" {
		t.Fatalf("after unban status=%q reason=%q, want active/''", status, reason)
	}
}
