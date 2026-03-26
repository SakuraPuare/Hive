package handler

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"hive/registry/internal/model"
)

// ── checkSubscriptionValid unit tests ────────────────────────────────────────

func TestCheckSubscriptionValid_Active(t *testing.T) {
	expires := time.Now().Add(30 * 24 * time.Hour).UTC().Format(model.TimeLayout)
	ok, reason := checkSubscriptionValid("active", 0, 107374182400, expires)
	if !ok {
		t.Fatalf("expected valid, got reason=%s", reason)
	}
}

func TestCheckSubscriptionValid_Suspended(t *testing.T) {
	expires := time.Now().Add(30 * 24 * time.Hour).UTC().Format(model.TimeLayout)
	ok, reason := checkSubscriptionValid("suspended", 0, 107374182400, expires)
	if ok {
		t.Fatal("expected invalid for suspended subscription")
	}
	if reason != "订阅已停用" {
		t.Fatalf("expected reason=订阅已停用, got %s", reason)
	}
}

func TestCheckSubscriptionValid_Expired(t *testing.T) {
	expires := "2020-01-01 00:00:00"
	ok, reason := checkSubscriptionValid("active", 0, 107374182400, expires)
	if ok {
		t.Fatal("expected invalid for expired subscription")
	}
	if reason != "订阅已过期" {
		t.Fatalf("expected reason=订阅已过期, got %s", reason)
	}
}

func TestCheckSubscriptionValid_TrafficExceeded(t *testing.T) {
	expires := time.Now().Add(30 * 24 * time.Hour).UTC().Format(model.TimeLayout)
	ok, reason := checkSubscriptionValid("active", 107374182400, 107374182400, expires)
	if ok {
		t.Fatal("expected invalid when traffic_used >= traffic_limit")
	}
	if reason != "流量已用尽" {
		t.Fatalf("expected reason=流量已用尽, got %s", reason)
	}
}

func TestCheckSubscriptionValid_TrafficOverLimit(t *testing.T) {
	expires := time.Now().Add(30 * 24 * time.Hour).UTC().Format(model.TimeLayout)
	ok, reason := checkSubscriptionValid("active", 200000000000, 107374182400, expires)
	if ok {
		t.Fatal("expected invalid when traffic_used > traffic_limit")
	}
	if reason != "流量已用尽" {
		t.Fatalf("expected reason=流量已用尽, got %s", reason)
	}
}

func TestCheckSubscriptionValid_UnlimitedTraffic(t *testing.T) {
	expires := time.Now().Add(30 * 24 * time.Hour).UTC().Format(model.TimeLayout)
	// traffic_limit=0 means unlimited
	ok, reason := checkSubscriptionValid("active", 999999999999, 0, expires)
	if !ok {
		t.Fatalf("expected valid for unlimited traffic, got reason=%s", reason)
	}
}

func TestCheckSubscriptionValid_InvalidExpiresAt(t *testing.T) {
	// unparseable expires_at should not block
	ok, _ := checkSubscriptionValid("active", 0, 100, "not-a-date")
	if !ok {
		t.Fatal("expected valid when expires_at is unparseable")
	}
}

// ── Admin traffic summary endpoint ───────────────────────────────────────────

func TestTrafficSummary_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/traffic/summary", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["total_used"].(float64) != 0 {
		t.Fatalf("expected total_used=0, got %v", body["total_used"])
	}
	if body["active_count"].(float64) != 0 {
		t.Fatalf("expected active_count=0, got %v", body["active_count"])
	}
	if body["over_limit_count"].(float64) != 0 {
		t.Fatalf("expected over_limit_count=0, got %v", body["over_limit_count"])
	}
}

func TestTrafficSummary_WithSubscriptions(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "traffic-sum@test.com", "Plan-Sum")

	// Set some traffic
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 50000000000 WHERE id = ?", subID)

	resp := doJSON("GET", "/admin/traffic/summary", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["total_used"].(float64) != 50000000000 {
		t.Fatalf("expected total_used=50000000000, got %v", body["total_used"])
	}
	if body["active_count"].(float64) != 1 {
		t.Fatalf("expected active_count=1, got %v", body["active_count"])
	}
	if body["over_limit_count"].(float64) != 0 {
		t.Fatalf("expected over_limit_count=0, got %v", body["over_limit_count"])
	}
}

func TestTrafficSummary_OverLimit(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "traffic-over@test.com", "Plan-Over")

	// Set traffic_used >= traffic_limit
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 107374182400, traffic_limit = 107374182400 WHERE id = ?", subID)

	resp := doJSON("GET", "/admin/traffic/summary", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["over_limit_count"].(float64) != 1 {
		t.Fatalf("expected over_limit_count=1, got %v", body["over_limit_count"])
	}
}

func TestTrafficSummary_Unauthorized(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/traffic/summary", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Admin reset traffic endpoint ─────────────────────────────────────────────

func TestResetSubscriptionTraffic(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "reset-traffic@test.com", "Plan-Reset")

	// Set some traffic
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 50000000000 WHERE id = ?", subID)

	resp := doJSON("POST", fmt.Sprintf("/admin/subscriptions/%d/reset-traffic", subID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// Verify traffic_used is 0
	var trafficUsed int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", subID).Scan(&trafficUsed)
	if trafficUsed != 0 {
		t.Fatalf("expected traffic_used=0 after reset, got %d", trafficUsed)
	}

	// Verify traffic_reset_at is set
	var resetAt string
	testDB.Raw("SELECT COALESCE(DATE_FORMAT(traffic_reset_at, '%Y'), '') FROM customer_subscriptions WHERE id = ?", subID).Scan(&resetAt)
	if resetAt == "" {
		t.Fatal("expected traffic_reset_at to be set after reset")
	}
}

func TestResetSubscriptionTraffic_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/subscriptions/99999/reset-traffic", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestResetSubscriptionTraffic_Unauthorized(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/subscriptions/1/reset-traffic", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Traffic limit enforcement on /c/{token} ──────────────────────────────────

func TestCustomerSubscription_TrafficExceeded_Clash(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	// Set traffic_used >= traffic_limit
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 107374182400, traffic_limit = 107374182400 WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if !strings.Contains(body, "流量已用尽") {
		t.Fatalf("expected body to contain 流量已用尽, got: %s", body)
	}
	if !strings.Contains(body, "proxies: []") {
		t.Fatalf("expected empty proxies list, got: %s", body)
	}
}

func TestCustomerSubscription_TrafficExceeded_Vless(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 107374182400, traffic_limit = 107374182400 WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token+"/vless", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	decoded, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("expected base64 body, got decode error: %v", err)
	}
	if !strings.Contains(string(decoded), "流量已用尽") {
		t.Fatalf("expected decoded body to contain 流量已用尽, got: %s", string(decoded))
	}
}

func TestCustomerSubscription_Expired_Clash(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	testDB.Exec("UPDATE customer_subscriptions SET expires_at = '2020-01-01 00:00:00' WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if !strings.Contains(body, "订阅已过期") {
		t.Fatalf("expected body to contain 订阅已过期, got: %s", body)
	}
}

func TestCustomerSubscription_Expired_Vless(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	testDB.Exec("UPDATE customer_subscriptions SET expires_at = '2020-01-01 00:00:00' WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token+"/vless", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	decoded, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("expected base64 body, got decode error: %v", err)
	}
	if !strings.Contains(string(decoded), "订阅已过期") {
		t.Fatalf("expected decoded body to contain 订阅已过期, got: %s", string(decoded))
	}
}

func TestCustomerSubscription_Suspended_Clash(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	testDB.Exec("UPDATE customer_subscriptions SET status = 'suspended' WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if !strings.Contains(body, "订阅已停用") {
		t.Fatalf("expected body to contain 订阅已停用, got: %s", body)
	}
}

func TestCustomerSubscription_UnlimitedTraffic_Clash(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	// traffic_limit=0 means unlimited, even with high usage
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 999999999999, traffic_limit = 0 WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	// Should return normal config, not an error message
	if strings.Contains(body, "流量已用尽") {
		t.Fatal("unlimited traffic subscription should not be blocked")
	}
	if !strings.Contains(body, "proxies:") {
		t.Fatal("expected normal Clash YAML with proxies")
	}
}

// ── Traffic reset logic ──────────────────────────────────────────────────────

func TestResetTrafficIfNeeded_MonthBoundary(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "reset-month@test.com", "Plan-Month")

	// Set traffic_used and traffic_reset_at to last month
	lastMonth := time.Now().AddDate(0, -1, -1).UTC().Format(model.TimeLayout)
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 50000000000, traffic_reset_at = ? WHERE id = ?", lastMonth, subID)

	testH.resetTrafficIfNeeded()

	var trafficUsed int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", subID).Scan(&trafficUsed)
	if trafficUsed != 0 {
		t.Fatalf("expected traffic_used=0 after monthly reset, got %d", trafficUsed)
	}

	// Verify traffic_reset_at was updated
	var resetAt string
	testDB.Raw("SELECT DATE_FORMAT(traffic_reset_at, '%Y-%m') FROM customer_subscriptions WHERE id = ?", subID).Scan(&resetAt)
	expected := time.Now().UTC().Format("2006-01")
	if resetAt != expected {
		t.Fatalf("expected traffic_reset_at month=%s, got %s", expected, resetAt)
	}
}

func TestResetTrafficIfNeeded_SameMonth(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "noreset@test.com", "Plan-NoReset")

	// Set traffic_reset_at to today (same month)
	now := time.Now().UTC().Format(model.TimeLayout)
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 50000000000, traffic_reset_at = ? WHERE id = ?", now, subID)

	testH.resetTrafficIfNeeded()

	var trafficUsed int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", subID).Scan(&trafficUsed)
	if trafficUsed != 50000000000 {
		t.Fatalf("expected traffic_used unchanged at 50000000000, got %d", trafficUsed)
	}
}

func TestResetTrafficIfNeeded_NoResetAt_UsesStartedAt(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "noreset-at@test.com", "Plan-NoResetAt")

	// Set started_at to last month, traffic_reset_at to NULL
	lastMonth := time.Now().AddDate(0, -1, -1).UTC().Format(model.TimeLayout)
	testDB.Exec("UPDATE customer_subscriptions SET traffic_used = 30000000000, started_at = ?, traffic_reset_at = NULL WHERE id = ?", lastMonth, subID)

	testH.resetTrafficIfNeeded()

	var trafficUsed int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", subID).Scan(&trafficUsed)
	if trafficUsed != 0 {
		t.Fatalf("expected traffic_used=0 after reset (using started_at), got %d", trafficUsed)
	}
}

func TestResetTrafficIfNeeded_InactiveSub_Skipped(t *testing.T) {
	resetDB(t)
	_, subID := createTestSubscription(t, "inactive-reset@test.com", "Plan-Inactive")

	lastMonth := time.Now().AddDate(0, -1, -1).UTC().Format(model.TimeLayout)
	testDB.Exec("UPDATE customer_subscriptions SET status = 'suspended', traffic_used = 50000000000, traffic_reset_at = ? WHERE id = ?", lastMonth, subID)

	testH.resetTrafficIfNeeded()

	// Inactive subscriptions should not be reset
	var trafficUsed int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", subID).Scan(&trafficUsed)
	if trafficUsed != 50000000000 {
		t.Fatalf("expected traffic_used unchanged for inactive sub, got %d", trafficUsed)
	}
}

// ── updateTrafficFromPrometheus ──────────────────────────────────────────────

func TestUpdateTrafficFromPrometheus_EmptyPrometheusURL(t *testing.T) {
	resetDB(t)

	// Temporarily clear PrometheusURL
	origURL := testH.Config.PrometheusURL
	testH.Config.PrometheusURL = ""
	defer func() { testH.Config.PrometheusURL = origURL }()

	// Should return immediately without error
	testH.updateTrafficFromPrometheus()
}

func TestUpdateTrafficFromPrometheus_NoNodes(t *testing.T) {
	resetDB(t)

	// Prometheus is configured but no nodes exist — should not panic
	testH.updateTrafficFromPrometheus()
}

// ── collectTraffic integration ───────────────────────────────────────────────

func TestCollectTraffic_NoSubscriptions(t *testing.T) {
	resetDB(t)

	// Should not panic with empty DB
	testH.collectTraffic()
}
