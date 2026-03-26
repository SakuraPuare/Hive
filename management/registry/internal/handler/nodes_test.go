package handler

import (
	"net/http"
	"testing"
)

func TestNodeRegister(t *testing.T) {
	resetDB(t)

	resp := doBearer("POST", "/nodes/register", map[string]any{
		"mac":       "aabbccddeeff",
		"mac6":      "ddeeff",
		"hostname":  "test-node-1",
		"cf_url":    "https://test.example.com",
		"xray_uuid": "uuid-1234",
	}, testCfg.APISecret)
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
	resp := doBearer("POST", "/nodes/register", payload, testCfg.APISecret)
	assertStatus(t, resp, http.StatusOK)

	// 第二次注册（幂等）— status 应为 updated
	resp = doBearer("POST", "/nodes/register", payload, testCfg.APISecret)
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
	}, testCfg.APISecret)
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
	}, testCfg.APISecret)
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
