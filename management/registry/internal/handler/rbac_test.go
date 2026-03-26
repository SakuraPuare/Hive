package handler

import (
	"fmt"
	"net/http"
	"testing"
)

func TestListRoles(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/roles", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	roles := parseJSONArray(resp)
	if len(roles) < 3 {
		t.Fatalf("expected at least 3 roles (superadmin, admin, viewer), got %d", len(roles))
	}

	// 验证每个角色都有 permissions 字段
	for _, r := range roles {
		if _, ok := r["permissions"]; !ok {
			t.Fatalf("role %v missing permissions field", r["name"])
		}
	}
}

func TestListPermissions(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/permissions", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	perms := parseJSONArray(resp)
	if len(perms) == 0 {
		t.Fatal("expected non-empty permissions list")
	}
	// 验证有 slug 字段
	if _, ok := perms[0]["slug"]; !ok {
		t.Fatal("permission missing slug field")
	}
}

func TestGetUserRoles(t *testing.T) {
	resetDB(t)

	// admin 用户的 ID
	var adminID uint
	testDB.Raw("SELECT id FROM users WHERE username = 'admin'").Scan(&adminID)

	resp := doJSON("GET", fmt.Sprintf("/admin/users/%d/roles", adminID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if body == "null" || body == "[]" {
		t.Fatal("expected admin to have roles")
	}
}

func TestSetUserRoles(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "roletest", "pass", "viewer")

	// 设置为 admin 角色
	resp := doJSON("PUT", fmt.Sprintf("/admin/users/%d/roles", uid), map[string]any{
		"roles": []string{"admin"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证角色已更新
	resp = doJSON("GET", fmt.Sprintf("/admin/users/%d/roles", uid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := readBody(resp)
	if body == "[]" || body == "null" {
		t.Fatal("expected user to have admin role")
	}
}

func TestSetUserRoles_UnknownRole(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "roletest2", "pass", "viewer")

	resp := doJSON("PUT", fmt.Sprintf("/admin/users/%d/roles", uid), map[string]any{
		"roles": []string{"nonexistent"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestSetRolePermissions(t *testing.T) {
	resetDB(t)

	// 获取 viewer 角色 ID
	var viewerRoleID uint
	testDB.Raw("SELECT id FROM roles WHERE name = 'viewer'").Scan(&viewerRoleID)

	// 设置 viewer 角色的权限
	resp := doJSON("PUT", fmt.Sprintf("/admin/roles/%d/permissions", viewerRoleID), map[string]any{
		"permissions": []string{"node:read", "subscription:read"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestSetRolePermissions_UnknownPerm(t *testing.T) {
	resetDB(t)

	var viewerRoleID uint
	testDB.Raw("SELECT id FROM roles WHERE name = 'viewer'").Scan(&viewerRoleID)

	resp := doJSON("PUT", fmt.Sprintf("/admin/roles/%d/permissions", viewerRoleID), map[string]any{
		"permissions": []string{"nonexistent:perm"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestRBAC_PermissionDenied(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer3", "pass", "viewer")
	cookie := userCookieWithRole("viewer3", "viewer")

	// viewer 没有 role:write 权限
	resp := doJSON("PUT", "/admin/roles/1/permissions", map[string]any{
		"permissions": []string{"node:read"},
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}
