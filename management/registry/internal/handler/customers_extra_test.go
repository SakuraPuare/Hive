package handler

import (
	"fmt"
	"net/http"
	"testing"
)

// createTestSubscription 创建客户+套餐+订阅，返回 (customerID, subscriptionID)。
func createTestSubscription(t *testing.T, email, planName string) (uint, uint) {
	t.Helper()
	cid := insertTestCustomer(t, email)
	planID := insertTestPlan(t, planName)

	resp := doJSON("POST", fmt.Sprintf("/admin/customers/%d/subscriptions", cid), map[string]any{
		"plan_id": planID,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	var subID uint
	testDB.Raw("SELECT id FROM customer_subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1", cid).Scan(&subID)
	if subID == 0 {
		t.Fatal("subscription not created")
	}
	return cid, subID
}

// ── UpdateSubscription ──────────────────────────────────────────────────────

func TestUpdateSubscription_Status(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "updsub-status@test.com", "Plan-Status")

	resp := doJSON("PATCH", fmt.Sprintf("/admin/subscriptions/%d", subID), map[string]any{
		"status": "suspended",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// 验证数据库
	var got string
	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", subID).Scan(&got)
	if got != "suspended" {
		t.Fatalf("expected db status=suspended, got %s", got)
	}
}

func TestUpdateSubscription_TrafficLimit(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "updsub-traffic@test.com", "Plan-Traffic")

	var newLimit int64 = 214748364800
	resp := doJSON("PATCH", fmt.Sprintf("/admin/subscriptions/%d", subID), map[string]any{
		"traffic_limit": newLimit,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	var got int64
	testDB.Raw("SELECT traffic_limit FROM customer_subscriptions WHERE id = ?", subID).Scan(&got)
	if got != newLimit {
		t.Fatalf("expected traffic_limit=%d, got %d", newLimit, got)
	}
}

func TestUpdateSubscription_ExpiresAt(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "updsub-exp@test.com", "Plan-Exp")

	resp := doJSON("PATCH", fmt.Sprintf("/admin/subscriptions/%d", subID), map[string]any{
		"expires_at": "2026-01-01 00:00:00",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	var got string
	testDB.Raw("SELECT DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') FROM customer_subscriptions WHERE id = ?", subID).Scan(&got)
	if got != "2026-01-01 00:00:00" {
		t.Fatalf("expected expires_at=2026-01-01 00:00:00, got %s", got)
	}
}

// ── DeleteSubscription ──────────────────────────────────────────────────────

func TestDeleteSubscription(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "delsub@test.com", "Plan-Del")

	resp := doJSON("DELETE", fmt.Sprintf("/admin/subscriptions/%d", subID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// 验证已删除
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM customer_subscriptions WHERE id = ?", subID).Scan(&count)
	if count != 0 {
		t.Fatalf("expected subscription deleted, but count=%d", count)
	}
}

// ── ResetSubscriptionToken ──────────────────────────────────────────────────

func TestResetSubscriptionToken(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "resettok@test.com", "Plan-Token")

	// 记录旧 token
	var oldToken string
	testDB.Raw("SELECT token FROM customer_subscriptions WHERE id = ?", subID).Scan(&oldToken)

	resp := doJSON("POST", fmt.Sprintf("/admin/subscriptions/%d/reset-token", subID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	newToken, ok := body["token"].(string)
	if !ok || newToken == "" {
		t.Fatal("expected non-empty token in response")
	}
	if newToken == oldToken {
		t.Fatal("expected token to change after reset")
	}

	// 验证数据库
	var dbToken string
	testDB.Raw("SELECT token FROM customer_subscriptions WHERE id = ?", subID).Scan(&dbToken)
	if dbToken != newToken {
		t.Fatalf("db token=%s != response token=%s", dbToken, newToken)
	}
}

// ── GetCustomerTraffic ──────────────────────────────────────────────────────

func TestGetCustomerTraffic_WithSubscription(t *testing.T) {
	resetDB(t)
	cid, _ := createTestSubscription(t, "traffic@test.com", "Plan-Traffic")

	resp := doJSON("GET", fmt.Sprintf("/admin/customers/%d/traffic", cid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	subs, ok := body["subscriptions"].([]any)
	if !ok {
		t.Fatal("expected subscriptions array")
	}
	if len(subs) == 0 {
		t.Fatal("expected at least one subscription in traffic response")
	}

	// total_upload / total_download 应存在
	if _, ok := body["total_upload"]; !ok {
		t.Fatal("missing total_upload")
	}
	if _, ok := body["total_download"]; !ok {
		t.Fatal("missing total_download")
	}
}

func TestGetCustomerTraffic_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/customers/99999/traffic", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}
