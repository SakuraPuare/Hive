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
		"password": "pass1234",
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
		"password": "pass1234",
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
		"password": "newpass1",
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

// grantUserWritePerm grants the user:write permission directly to a user so we
// can exercise privilege-escalation guards without making them a superadmin.
func grantUserWritePerm(t *testing.T, uid uint) {
	t.Helper()
	var permID uint
	testDB.Raw("SELECT id FROM permissions WHERE slug = 'user:write'").Scan(&permID)
	if permID == 0 {
		t.Fatal("user:write permission not seeded")
	}
	if err := testDB.Exec("INSERT IGNORE INTO user_permissions (user_id, permission_id) VALUES (?, ?)", uid, permID).Error; err != nil {
		t.Fatalf("grant user:write to %d: %v", uid, err)
	}
}

// A non-superadmin holding user:write must not be able to grant the superadmin
// role to anyone (including themselves).
func TestSetUserRoles_NonSuperadminCannotGrantSuperadmin(t *testing.T) {
	resetDB(t)
	attackerUID := createTestUser(t, "attacker", "pass1234", "admin")
	grantUserWritePerm(t, attackerUID)
	cookie := userCookieWithRole("attacker", "admin")

	// 尝试给自己提权为 superadmin
	resp := doJSON("PUT", fmt.Sprintf("/admin/users/%d/roles", attackerUID), map[string]any{
		"roles": []string{"superadmin"},
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// 提权未生效
	if testH.userIsSuperadmin(attackerUID) {
		t.Fatal("attacker should not have gained superadmin")
	}
}

// A non-superadmin with user:write must not be able to alter a superadmin's
// roles, nor change a superadmin's password, nor delete a superadmin.
func TestSuperadminProtectedFromLesserAdmins(t *testing.T) {
	resetDB(t)

	var adminID uint
	testDB.Raw("SELECT id FROM users WHERE username = 'admin'").Scan(&adminID)

	attackerUID := createTestUser(t, "attacker2", "pass1234", "admin")
	grantUserWritePerm(t, attackerUID)
	cookie := userCookieWithRole("attacker2", "admin")

	// 不能降级超管角色
	resp := doJSON("PUT", fmt.Sprintf("/admin/users/%d/roles", adminID), map[string]any{
		"roles": []string{"viewer"},
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// 不能改超管密码
	resp = doJSON("POST", fmt.Sprintf("/admin/users/%d/password", adminID), map[string]string{
		"password": "pwned-password",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// 不能删除超管
	resp = doJSON("DELETE", fmt.Sprintf("/admin/users/%d", adminID), nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

// A superadmin retains the ability to manage superadmin accounts.
func TestSuperadminCanManageSuperadmin(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "promote-me", "pass1234", "viewer")

	resp := doJSON("PUT", fmt.Sprintf("/admin/users/%d/roles", uid), map[string]any{
		"roles": []string{"superadmin"},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	if !testH.userIsSuperadmin(uid) {
		t.Fatal("superadmin should be able to grant superadmin")
	}
}
