package handler

import (
	"fmt"
	"net/http"
	"testing"
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
		"password": "pass123",
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
		"password": "newpass",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}
