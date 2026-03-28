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
