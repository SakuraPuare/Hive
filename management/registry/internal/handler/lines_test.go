package handler

import (
	"fmt"
	"net/http"
	"testing"
)

func TestListLines_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/lines", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	lines := parseJSONArray(resp)
	if len(lines) != 0 {
		t.Fatalf("expected 0 lines, got %d", len(lines))
	}
}

func TestCreateLine(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/lines", map[string]any{
		"name":   "Japan Line",
		"region": "JP",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证创建
	resp = doJSON("GET", "/admin/lines", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	lines := parseJSONArray(resp)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if lines[0]["name"] != "Japan Line" {
		t.Fatalf("expected name=Japan Line, got %v", lines[0]["name"])
	}
}

func TestUpdateLine(t *testing.T) {
	resetDB(t)

	// 创建线路
	resp := doJSON("POST", "/admin/lines", map[string]any{
		"name":   "JP Line",
		"region": "JP",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	lineID := body["id"]

	// 更新
	resp = doJSON("PATCH", fmt.Sprintf("/admin/lines/%v", lineID), map[string]any{
		"name": "Japan Premium",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestDeleteLine(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/lines", map[string]any{
		"name":   "ToDelete",
		"region": "US",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	lineID := body["id"]

	resp = doJSON("DELETE", fmt.Sprintf("/admin/lines/%v", lineID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证已删除
	resp = doJSON("GET", "/admin/lines", nil, adminCookie())
	lines := parseJSONArray(resp)
	if len(lines) != 0 {
		t.Fatalf("expected 0 lines after delete, got %d", len(lines))
	}
}

func TestLineNodes(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")
	insertTestNode(t, "112233445566")

	// 创建线路
	resp := doJSON("POST", "/admin/lines", map[string]any{
		"name":   "Test Line",
		"region": "JP",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	lineID := body["id"]

	// 设置节点
	resp = doJSON("PUT", fmt.Sprintf("/admin/lines/%v/nodes", lineID), map[string]any{
		"nodes": []string{"aabbccddeeff", "112233445566"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 获取节点
	resp = doJSON("GET", fmt.Sprintf("/admin/lines/%v/nodes", lineID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestResetLineToken(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/lines", map[string]any{
		"name":   "Token Line",
		"region": "HK",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	lineID := body["id"]

	resp = doJSON("POST", fmt.Sprintf("/admin/lines/%v/reset-token", lineID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}
