package handler

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// ── Health ───────────────────────────────────────────────────────────────────

func TestHealth(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/health", nil, nil)
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status ok, got %v", body["status"])
	}
}

// ── Prometheus Targets ───────────────────────────────────────────────────────

func TestPrometheusTargets_Empty(t *testing.T) {
	resetDB(t)
	// No nodes → empty array
	resp := doJSON("GET", "/prometheus-targets", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	arr := parseJSONArray(resp)
	if len(arr) != 0 {
		t.Fatalf("expected 0 targets, got %d", len(arr))
	}
}

func TestPrometheusTargets_ExcludesPendingAndEmpty(t *testing.T) {
	resetDB(t)
	// insertTestNode sets tailscale_ip = '' → should be excluded
	insertTestNode(t, "aabbccddee01")
	// Also insert one with tailscale_ip = 'pending'
	insertTestNode(t, "aabbccddee02")
	testDB.Exec("UPDATE nodes SET tailscale_ip = 'pending' WHERE mac = ?", "aabbccddee02")

	resp := doJSON("GET", "/prometheus-targets", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	arr := parseJSONArray(resp)
	if len(arr) != 0 {
		t.Fatalf("expected 0 targets (both excluded), got %d", len(arr))
	}
}

func TestPrometheusTargets_WithData(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddee11")
	testDB.Exec("UPDATE nodes SET tailscale_ip = '100.64.0.1' WHERE mac = ?", "aabbccddee11")

	resp := doJSON("GET", "/prometheus-targets", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	arr := parseJSONArray(resp)
	if len(arr) != 1 {
		t.Fatalf("expected 1 target, got %d", len(arr))
	}

	targets, ok := arr[0]["targets"].([]any)
	if !ok || len(targets) != 1 {
		t.Fatalf("expected 1 target entry, got %v", arr[0]["targets"])
	}
	if !strings.HasSuffix(targets[0].(string), ":9100") {
		t.Fatalf("target should end with :9100, got %s", targets[0])
	}

	labels, ok := arr[0]["labels"].(map[string]any)
	if !ok {
		t.Fatalf("expected labels map, got %v", arr[0]["labels"])
	}
	if labels["hostname"] == "" {
		t.Fatal("expected non-empty hostname label")
	}
}

func TestPrometheusTargets_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/prometheus-targets", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Node Status ──────────────────────────────────────────────────────────────

func TestNodeStatus_Empty(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/admin/node-status", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	arr := parseJSONArray(resp)
	if len(arr) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(arr))
	}
}

func TestNodeStatus_UnknownWithoutProbe(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddee21")

	resp := doJSON("GET", "/admin/node-status", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	arr := parseJSONArray(resp)
	if len(arr) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(arr))
	}
	if arr[0]["status"] != "unknown" {
		t.Fatalf("expected status unknown, got %v", arr[0]["status"])
	}
	if arr[0]["mac"] != "aabbccddee21" {
		t.Fatalf("expected mac aabbccddee21, got %v", arr[0]["mac"])
	}
}

func TestNodeStatus_WithProbeData(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddee22")
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	testDB.Exec(`INSERT INTO node_status_checks (mac, status, latency_ms, cpu_pct, mem_pct, disk_pct, uptime_sec, checked_at)
		VALUES (?, 'online', 12.5, 30.0, 50.0, 60.0, 86400, ?)`,
		"aabbccddee22", now)

	resp := doJSON("GET", "/admin/node-status", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	arr := parseJSONArray(resp)
	if len(arr) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(arr))
	}
	if arr[0]["status"] != "online" {
		t.Fatalf("expected status online, got %v", arr[0]["status"])
	}
	if arr[0]["hostname"] != "test-aabbccddee22" {
		t.Fatalf("expected hostname test-aabbccddee22, got %v", arr[0]["hostname"])
	}
}

func TestNodeStatus_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/admin/node-status", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Risk Events ──────────────────────────────────────────────────────────────

func TestRiskEvents_Empty(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/admin/risk-events", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["total"] != float64(0) {
		t.Fatalf("expected total 0, got %v", body["total"])
	}
	items := body["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

func TestRiskEvents_WithData(t *testing.T) {
	resetDB(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	cid := insertTestCustomer(t, "risk@test.com")
	testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'login_fail', 'bad password', '1.2.3.4', ?)",
		cid, now)

	resp := doJSON("GET", "/admin/risk-events", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["total"] != float64(1) {
		t.Fatalf("expected total 1, got %v", body["total"])
	}
	items := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	item := items[0].(map[string]any)
	if item["event_type"] != "login_fail" {
		t.Fatalf("expected event_type login_fail, got %v", item["event_type"])
	}
	if item["ip"] != "1.2.3.4" {
		t.Fatalf("expected ip 1.2.3.4, got %v", item["ip"])
	}
}

func TestRiskEvents_FilterByCustomerID(t *testing.T) {
	resetDB(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	cid1 := insertTestCustomer(t, "risk1@test.com")
	cid2 := insertTestCustomer(t, "risk2@test.com")
	testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'login_fail', 'x', '1.1.1.1', ?)", cid1, now)
	testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'signup', 'y', '2.2.2.2', ?)", cid2, now)

	resp := doJSON("GET", fmt.Sprintf("/admin/risk-events?customer_id=%d", cid1), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["total"] != float64(1) {
		t.Fatalf("expected total 1, got %v", body["total"])
	}
}

func TestRiskEvents_FilterByEventType(t *testing.T) {
	resetDB(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	cid := insertTestCustomer(t, "risk3@test.com")
	testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'login_fail', 'a', '1.1.1.1', ?)", cid, now)
	testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'signup', 'b', '2.2.2.2', ?)", cid, now)
	testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'login_fail', 'c', '3.3.3.3', ?)", cid, now)

	resp := doJSON("GET", "/admin/risk-events?event_type=login_fail", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["total"] != float64(2) {
		t.Fatalf("expected total 2, got %v", body["total"])
	}
}

func TestRiskEvents_Pagination(t *testing.T) {
	resetDB(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	cid := insertTestCustomer(t, "risk4@test.com")
	for i := 0; i < 5; i++ {
		testDB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?, 'login_fail', ?, '1.1.1.1', ?)",
			cid, fmt.Sprintf("event-%d", i), now)
	}

	resp := doJSON("GET", "/admin/risk-events?page=2&limit=2", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["total"] != float64(5) {
		t.Fatalf("expected total 5, got %v", body["total"])
	}
	items := body["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 items on page 2, got %d", len(items))
	}
}

func TestRiskEvents_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/admin/risk-events", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Labels ───────────────────────────────────────────────────────────────────

func TestLabels_HTML(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddee31")

	resp := doJSON("GET", "/labels", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		t.Fatalf("expected text/html content type, got %s", ct)
	}

	body := readBody(resp)
	if !strings.Contains(body, "<!DOCTYPE html>") {
		t.Fatal("expected HTML doctype in response")
	}
	if !strings.Contains(body, "ddee31") {
		t.Fatal("expected mac6 in label output")
	}
}

func TestLabels_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/labels", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}
