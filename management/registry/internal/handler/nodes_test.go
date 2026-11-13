package handler

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"hive/registry/internal/model"
)

func TestNodeRegister(t *testing.T) {
	resetDB(t)

	resp := doBearer("POST", "/nodes/register", map[string]any{
		"mac":       "aabbccddeeff",
		"mac6":      "ddeeff",
		"hostname":  "test-node-1",
		"cf_url":    "https://test.example.com",
		"xray_uuid": "uuid-1234",
	}, deviceToken(t, "aabbccddeeff"))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "registered" {
		t.Fatalf("expected status=registered, got %v", body["status"])
	}
	if body["hostname"] != "test-node-1" {
		t.Fatalf("expected hostname=test-node-1, got %v", body["hostname"])
	}
}

func TestNodeRegister_Idempotent(t *testing.T) {
	resetDB(t)

	payload := map[string]any{
		"mac":       "aabbccddeeff",
		"mac6":      "ddeeff",
		"hostname":  "test-node-1",
		"cf_url":    "https://test.example.com",
		"xray_uuid": "uuid-1234",
	}

	// 第一次注册
	resp := doBearer("POST", "/nodes/register", payload, deviceToken(t, "aabbccddeeff"))
	assertStatus(t, resp, http.StatusOK)

	// 第二次注册（幂等）— status 应为 updated
	resp = doBearer("POST", "/nodes/register", payload, deviceToken(t, "aabbccddeeff"))
	assertStatus(t, resp, http.StatusOK)
	body2 := parseJSON(resp)

	if body2["status"] != "updated" {
		t.Fatalf("expected status=updated on second register, got %v", body2["status"])
	}
}

func TestNodeRegister_NoToken(t *testing.T) {
	resetDB(t)

	resp := doBearer("POST", "/nodes/register", map[string]any{
		"mac":       "aabbccddeeff",
		"hostname":  "test-node-1",
		"xray_uuid": "uuid-1234",
	}, "wrong-token")
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestNodeRegister_MissingFields(t *testing.T) {
	resetDB(t)

	resp := doBearer("POST", "/nodes/register", map[string]any{
		"mac": "aabbccddeeff",
	}, deviceToken(t, "aabbccddeeff"))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestListNodes(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")
	insertTestNode(t, "112233445566")

	resp := doJSON("GET", "/nodes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	nodes := parseJSONArray(resp)
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
}

func TestListNodes_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/nodes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	nodes := parseJSONArray(resp)
	if len(nodes) != 0 {
		t.Fatalf("expected 0 nodes, got %d", len(nodes))
	}
}

func TestGetNode(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")

	resp := doJSON("GET", "/nodes/aabbccddeeff", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["mac"] != "aabbccddeeff" {
		t.Fatalf("expected mac=aabbccddeeff, got %v", body["mac"])
	}
}

func TestGetNode_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/nodes/000000000000", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestUpdateNode(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")

	location := "Tokyo DC"
	resp := doJSON("PATCH", "/nodes/aabbccddeeff", map[string]any{
		"location": location,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证更新
	resp = doJSON("GET", "/nodes/aabbccddeeff", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	if body["location"] != "Tokyo DC" {
		t.Fatalf("expected location=Tokyo DC, got %v", body["location"])
	}
}

func TestUpdateNode_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("PATCH", "/nodes/000000000000", map[string]any{
		"location": "nowhere",
	}, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestDeleteNode(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")

	resp := doJSON("DELETE", "/nodes/aabbccddeeff", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证已删除
	resp = doJSON("GET", "/nodes/aabbccddeeff", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestDeleteNode_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("DELETE", "/nodes/000000000000", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestHeartbeat(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")

	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{
		"mac":        "aabbccddeeff",
		"cpu_pct":    25.5,
		"mem_pct":    60.0,
		"disk_pct":   40.0,
		"uptime_sec": 86400,
	}, deviceToken(t, "aabbccddeeff"))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}
}

func TestHeartbeat_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{
		"mac": "aabbccddeeff",
	}, "wrong-token")
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestNodes_PermissionDenied(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer1", "pass123", "viewer")

	cookie := userCookieWithRole("viewer1", "viewer")

	// viewer 有 node:read 权限，应该能访问
	resp := doJSON("GET", "/nodes", nil, cookie)
	assertStatus(t, resp, http.StatusOK)

	// viewer 没有 node:write 权限
	insertTestNode(t, "aabbccddeeff")
	resp = doJSON("PATCH", "/nodes/aabbccddeeff", map[string]any{
		"location": "test",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// viewer 没有 node:delete 权限
	resp = doJSON("DELETE", "/nodes/aabbccddeeff", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestPullCommands_ExpiresStaleSentCommand(t *testing.T) {
	// The pull response is the only delivery record the agent has: hive-command-agent
	// logs a failed ACK and keeps executing whatever the next pull returns, including
	// reboot. A sent row that never expires therefore re-runs forever.
	resetDB(t)
	const mac = "aabbccddee91"
	insertTestNode(t, mac)
	stale := time.Now().UTC().Add(-2 * time.Hour).Format(model.TimeLayout)
	mustExec(t, "INSERT INTO node_commands (node_mac, action, params, status, created_by, created_at, sent_at) "+
		"VALUES (?, 'reboot', '', 'sent', 'admin', ?, ?)", mac, stale, stale)

	resp := doBearer("GET", "/nodes/"+mac+"/commands", nil, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	if items := parseJSONArray(resp); len(items) != 0 {
		t.Fatalf("stale sent command was redelivered %d time(s); the agent would reboot again", len(items))
	}
	if got := scalar(t, "SELECT COUNT(*) FROM node_commands WHERE node_mac = ? AND status = 'expired'", mac); got != 1 {
		t.Fatalf("stale sent command status: expired rows = %d, want 1", got)
	}
}

func TestPullCommands_RedeliversRecentlySentCommand(t *testing.T) {
	// A response lost in transit must still be retried; only rows older than the
	// lease are abandoned, otherwise retyping every outage becomes a lost command.
	resetDB(t)
	const mac = "aabbccddee92"
	insertTestNode(t, mac)
	recent := time.Now().UTC().Add(-time.Minute).Format(model.TimeLayout)
	mustExec(t, "INSERT INTO node_commands (node_mac, action, params, status, created_by, created_at, sent_at) "+
		"VALUES (?, 'resync', '', 'sent', 'admin', ?, ?)", mac, recent, recent)

	resp := doBearer("GET", "/nodes/"+mac+"/commands", nil, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	if items := parseJSONArray(resp); len(items) != 1 {
		t.Fatalf("recent sent command not redelivered: got %d items, want 1", len(items))
	}
}

func TestRegisterStoresTailscaleAddress(t *testing.T) {
	// provision-node.sh sends the tailnet address on every register call. Dropping
	// it left tailscale_ip='pending', and /prometheus-targets excludes that value,
	// so a zero-touch node was never scraped.
	resetDB(t)
	resp := doBearer("POST", "/nodes/register", map[string]any{
		"mac": "aabbccddee71", "mac6": "ddee71", "hostname": "tailnet-node",
		"cf_url": "https://tailnet.example.com", "xray_uuid": "uuid-tailnet",
		"tailscale_ip": "100.64.0.21",
	}, deviceToken(t, "aabbccddee71"))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	var stored string
	testDB.Raw("SELECT tailscale_ip FROM nodes WHERE mac = ?", "aabbccddee71").Scan(&stored)
	if stored != "100.64.0.21" {
		t.Fatalf("stored tailscale_ip=%q, want 100.64.0.21", stored)
	}

	resp = doJSON("GET", "/prometheus-targets", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	targets := parseJSONArray(resp)
	if len(targets) == 0 {
		t.Fatal("registered node produced no prometheus target")
	}
	labels := targets[0]["labels"].(map[string]any)
	if labels["hostname"] != "tailnet-node" {
		t.Fatalf("target hostname=%v, want tailnet-node", labels["hostname"])
	}
}

func TestCommandAckKeepsValidUTF8(t *testing.T) {
	// Truncating the ACK at an arbitrary byte split a multi-byte rune; MySQL
	// strict mode then rejected the UPDATE and the command stayed 'sent'.
	resetDB(t)
	const mac = "aabbccddee72"
	insertTestNode(t, mac)
	now := time.Now().UTC().Format(model.TimeLayout)
	mustExec(t, "INSERT INTO node_commands (node_mac, action, params, status, created_by, created_at, sent_at) VALUES (?, 'resync', '', 'sent', 'admin', ?, ?)", mac, now, now)
	id := scalar(t, "SELECT id FROM node_commands WHERE node_mac = ? ORDER BY id DESC LIMIT 1", mac)

	result := strings.Repeat("a", 1023) + "中"
	resp := doBearer("POST", "/nodes/"+mac+"/commands/"+strconv.FormatInt(id, 10)+"/ack",
		map[string]any{"status": "failed", "result": result}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	var stored string
	testDB.Raw("SELECT result FROM node_commands WHERE id = ?", id).Scan(&stored)
	if !utf8.ValidString(stored) {
		t.Fatalf("stored result is not valid UTF-8 (%d bytes)", len(stored))
	}
	if len(stored) > 1024 {
		t.Fatalf("stored result is %d bytes, want <= 1024", len(stored))
	}
	if got := scalar(t, "SELECT COUNT(*) FROM node_commands WHERE id = ? AND status = 'failed'", id); got != 1 {
		t.Fatal("ACK was rejected, command left in sent state")
	}
}

func TestEnqueueCommandReturnsInsertedID(t *testing.T) {
	// LAST_INSERT_ID() is per connection; reading it after a pool round trip
	// returned 0 and the admin UI could not track the command.
	resetDB(t)
	const mac = "aabbccddee73"
	insertTestNode(t, mac)
	sqlDB, err := testDB.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	sqlDB.SetMaxIdleConns(0)
	defer sqlDB.SetMaxIdleConns(2)

	resp := doJSON("POST", "/admin/nodes/"+mac+"/commands", map[string]any{"action": "resync"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	id, _ := body["id"].(float64)
	realID := scalar(t, "SELECT id FROM node_commands WHERE node_mac = ?", mac)
	if int64(id) != realID || realID == 0 {
		t.Fatalf("enqueue returned id=%v, row id=%d", body["id"], realID)
	}
}

func TestProbeWithoutPrometheusKeepsHeartbeat(t *testing.T) {
	// The probe used to write status='unknown' plus NULL metrics whenever a
	// series was missing, erasing a heartbeat that had just reported the node
	// online.
	resetDB(t)
	const mac = "aabbccddee74"
	insertTestNode(t, mac)
	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{
		"mac": mac, "cpu_pct": 42.5, "mem_pct": 10.0, "disk_pct": 20.0, "uptime_sec": 3600,
	}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	oldURL := testCfg.PrometheusURL
	testCfg.PrometheusURL = "http://127.0.0.1:1"
	defer func() { testCfg.PrometheusURL = oldURL }()
	testH.runProbe()

	var row struct {
		Status string
		CpuPct *float64
	}
	testDB.Raw("SELECT status, cpu_pct FROM node_status_checks WHERE mac = ?", mac).Scan(&row)
	if row.Status != "online" {
		t.Fatalf("probe overwrote heartbeat status: got %q", row.Status)
	}
	if row.CpuPct == nil {
		t.Fatal("probe erased heartbeat cpu_pct")
	}
}
