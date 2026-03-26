package handler

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestCreateSubscriptionGroup(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{
		"name": "Group A",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	id, ok := body["id"].(float64)
	if !ok || id == 0 {
		t.Fatalf("expected non-zero id, got %v", body["id"])
	}
	token, ok := body["token"].(string)
	if !ok || len(token) != 64 {
		t.Fatalf("expected 64-char hex token, got %q", body["token"])
	}
	if body["name"] != "Group A" {
		t.Fatalf("expected name=Group A, got %v", body["name"])
	}
}

func TestCreateSubscriptionGroup_MissingName(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestListSubscriptionGroups(t *testing.T) {
	resetDB(t)

	// 创建两个分组
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "G1"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp = doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "G2"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	resp = doJSON("GET", "/admin/subscription-groups", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	groups := parseJSONArray(resp)
	if len(groups) != 2 {
		t.Fatalf("expected 2 groups, got %d", len(groups))
	}
}

func TestListSubscriptionGroups_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/subscription-groups", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	groups := parseJSONArray(resp)
	if len(groups) != 0 {
		t.Fatalf("expected 0 groups, got %d", len(groups))
	}
}

func TestSetAndGetGroupNodes(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")
	insertTestNode(t, "112233445566")

	// 创建分组
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "NodeGroup"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	groupID := fmt.Sprintf("%.0f", body["id"].(float64))

	// 设置节点
	resp = doJSON("PUT", "/admin/subscription-groups/"+groupID+"/nodes", map[string]any{
		"nodes": []string{"aabbccddeeff", "112233445566"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 获取节点
	resp = doJSON("GET", "/admin/subscription-groups/"+groupID+"/nodes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	nodes := parseStringArray(resp)
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
}

func TestSetGroupNodes_ReplaceExisting(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")
	insertTestNode(t, "112233445566")

	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "ReplaceTest"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	groupID := fmt.Sprintf("%.0f", body["id"].(float64))

	// 先设置一个节点
	resp = doJSON("PUT", "/admin/subscription-groups/"+groupID+"/nodes", map[string]any{
		"nodes": []string{"aabbccddeeff"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 替换为另一个节点
	resp = doJSON("PUT", "/admin/subscription-groups/"+groupID+"/nodes", map[string]any{
		"nodes": []string{"112233445566"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	resp = doJSON("GET", "/admin/subscription-groups/"+groupID+"/nodes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	nodes := parseStringArray(resp)
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node after replace, got %d", len(nodes))
	}
}

func TestResetGroupToken(t *testing.T) {
	resetDB(t)

	// 创建分组
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "TokenTest"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	groupID := fmt.Sprintf("%.0f", body["id"].(float64))
	oldToken := body["token"].(string)

	// 重置 token
	resp = doJSON("POST", "/admin/subscription-groups/"+groupID+"/reset-token", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	newToken, ok := body["token"].(string)
	if !ok || len(newToken) != 64 {
		t.Fatalf("expected 64-char hex token, got %q", body["token"])
	}
	if newToken == oldToken {
		t.Fatalf("expected new token to differ from old token")
	}
}

func TestResetGroupToken_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/subscription-groups/99999/reset-token", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestPublicGroupClash(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")

	// 创建分组并获取 token
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "PublicTest"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	groupID := fmt.Sprintf("%.0f", body["id"].(float64))
	token := body["token"].(string)

	// 设置节点
	resp = doJSON("PUT", "/admin/subscription-groups/"+groupID+"/nodes", map[string]any{
		"nodes": []string{"aabbccddeeff"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 公开访问（无 cookie）
	resp = doJSON("GET", "/s/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/plain") {
		t.Fatalf("expected Content-Type text/plain, got %s", ct)
	}

	text := readBody(resp)
	if !strings.Contains(text, "proxies:") {
		t.Fatalf("expected Clash YAML with proxies, got: %s", text[:min(len(text), 200)])
	}
}

func TestPublicGroupClash_InvalidToken(t *testing.T) {
	resetDB(t)

	// 短 token
	resp := doJSON("GET", "/s/abc", nil, nil)
	assertStatus(t, resp, http.StatusNotFound)

	// 64 字符但不存在
	fakeToken := strings.Repeat("a", 64)
	resp = doJSON("GET", "/s/"+fakeToken, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
}

func TestDeleteSubscriptionGroup(t *testing.T) {
	resetDB(t)

	// 创建分组
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "ToDelete"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	groupID := fmt.Sprintf("%.0f", body["id"].(float64))

	// 删除
	resp = doJSON("DELETE", "/admin/subscription-groups/"+groupID, nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证列表为空
	resp = doJSON("GET", "/admin/subscription-groups", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	groups := parseJSONArray(resp)
	if len(groups) != 0 {
		t.Fatalf("expected 0 groups after delete, got %d", len(groups))
	}
}

func TestDeleteSubscriptionGroup_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("DELETE", "/admin/subscription-groups/99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestSubscriptionGroups_PermissionDenied(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer1", "pass123", "viewer")
	cookie := userCookieWithRole("viewer1", "viewer")

	// viewer 没有 subscription:read（默认角色有，但确认 write 被拒）
	// viewer 没有 subscription:write 权限
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "Nope"}, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestSubscriptionGroupsFullFlow(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")

	// 1. 创建分组
	resp := doJSON("POST", "/admin/subscription-groups", map[string]any{"name": "FlowTest"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	groupID := fmt.Sprintf("%.0f", body["id"].(float64))
	token := body["token"].(string)

	// 2. 列表验证
	resp = doJSON("GET", "/admin/subscription-groups", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	groups := parseJSONArray(resp)
	if len(groups) != 1 {
		t.Fatalf("expected 1 group, got %d", len(groups))
	}

	// 3. 设置节点
	resp = doJSON("PUT", "/admin/subscription-groups/"+groupID+"/nodes", map[string]any{
		"nodes": []string{"aabbccddeeff"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 4. 获取节点
	resp = doJSON("GET", "/admin/subscription-groups/"+groupID+"/nodes", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	nodes := parseStringArray(resp)
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}

	// 5. 重置 token
	resp = doJSON("POST", "/admin/subscription-groups/"+groupID+"/reset-token", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body = parseJSON(resp)
	newToken := body["token"].(string)
	if newToken == token {
		t.Fatalf("expected new token to differ")
	}

	// 6. 公开订阅用新 token
	resp = doJSON("GET", "/s/"+newToken, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	// 7. 旧 token 应该 404
	resp = doJSON("GET", "/s/"+token, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)

	// 8. 删除分组
	resp = doJSON("DELETE", "/admin/subscription-groups/"+groupID, nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 9. 列表为空
	resp = doJSON("GET", "/admin/subscription-groups", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	groups = parseJSONArray(resp)
	if len(groups) != 0 {
		t.Fatalf("expected 0 groups after delete, got %d", len(groups))
	}
}
