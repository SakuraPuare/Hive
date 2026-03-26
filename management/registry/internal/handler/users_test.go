package handler

import (
	"fmt"
	"net/http"
	"testing"
)

func TestListUsers(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/users", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	users := parseJSONArray(resp)
	if len(users) != 1 {
		t.Fatalf("expected 1 user (admin), got %d", len(users))
	}
	if users[0]["username"] != "admin" {
		t.Fatalf("expected username=admin, got %v", users[0]["username"])
	}
}

func TestCreateUser(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/users", map[string]string{
		"username": "newuser",
		"password": "pass123",
		"role":     "viewer",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证用户已创建
	resp = doJSON("GET", "/admin/users", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	users := parseJSONArray(resp)
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}
}

func TestCreateUser_DuplicateUsername(t *testing.T) {
	resetDB(t)

	payload := map[string]string{
		"username": "dup",
		"password": "pass123",
		"role":     "viewer",
	}
	resp := doJSON("POST", "/admin/users", payload, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 重复创建
	resp = doJSON("POST", "/admin/users", payload, adminCookie())
	assertStatus(t, resp, http.StatusConflict)
}

func TestCreateUser_MissingFields(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/users", map[string]string{
		"username": "",
		"password": "",
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestDeleteUser(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "todelete", "pass123", "viewer")

	resp := doJSON("DELETE", fmt.Sprintf("/admin/users/%d", uid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证已删除
	resp = doJSON("GET", "/admin/users", nil, adminCookie())
	users := parseJSONArray(resp)
	for _, u := range users {
		if u["username"] == "todelete" {
			t.Fatal("user should have been deleted")
		}
	}
}

func TestDeleteUser_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("DELETE", "/admin/users/99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestChangePassword(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "pwuser", "oldpass", "viewer")

	resp := doJSON("POST", fmt.Sprintf("/admin/users/%d/password", uid), map[string]string{
		"password": "newpass123",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 用新密码登录
	resp = doJSON("POST", "/admin/login", map[string]string{
		"username": "pwuser",
		"password": "newpass123",
	}, nil)
	assertStatus(t, resp, http.StatusOK)
}

func TestChangePassword_Self(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "selfpw", "oldpass", "viewer")
	cookie := userCookieWithRole("selfpw", "viewer")

	resp := doJSON("POST", fmt.Sprintf("/admin/users/%d/password", uid), map[string]string{
		"password": "newpass",
	}, cookie)
	assertStatus(t, resp, http.StatusOK)
}

func TestListAuditLogs(t *testing.T) {
	resetDB(t)

	// 触发一些审计事件
	doJSON("POST", "/admin/login", map[string]string{
		"username": "admin",
		"password": "admin123",
	}, nil)

	resp := doJSON("GET", "/admin/audit-logs", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	logs := parseJSONArray(resp)
	if len(logs) == 0 {
		t.Fatal("expected at least one audit log entry")
	}
}

func TestUsers_PermissionDenied(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer2", "pass", "viewer")
	cookie := userCookieWithRole("viewer2", "viewer")

	// viewer 没有 user:write 权限
	resp := doJSON("POST", "/admin/users", map[string]string{
		"username": "hacker",
		"password": "pass",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// viewer 没有 user:delete 权限
	resp = doJSON("DELETE", "/admin/users/1", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}
