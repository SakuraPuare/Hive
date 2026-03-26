package handler

import (
	"net/http"
	"testing"
)

func TestLogin_Success(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/login", map[string]string{
		"username": "admin",
		"password": "admin123",
	}, nil)

	assertStatus(t, resp, http.StatusOK)

	// 验证 Set-Cookie
	cookies := resp.Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == testCfg.AdminCookieName {
			found = true
			if c.Value == "" {
				t.Fatal("session cookie value is empty")
			}
			if !c.HttpOnly {
				t.Fatal("session cookie should be HttpOnly")
			}
		}
	}
	if !found {
		t.Fatal("session cookie not set")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/login", map[string]string{
		"username": "admin",
		"password": "wrongpass",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
	body := parseJSON(resp)
	if _, ok := body["error"]; !ok {
		t.Fatal("expected error field in response")
	}
}

func TestLogin_NonexistentUser(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/login", map[string]string{
		"username": "nobody",
		"password": "whatever",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestLogin_EmptyFields(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/login", map[string]string{
		"username": "",
		"password": "",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestLogout(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/logout", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证 cookie 被清除（MaxAge = -1）
	for _, c := range resp.Cookies() {
		if c.Name == testCfg.AdminCookieName {
			if c.MaxAge >= 0 {
				t.Fatalf("expected MaxAge < 0 for cleared cookie, got %d", c.MaxAge)
			}
			return
		}
	}
	t.Fatal("expected session cookie in logout response")
}

func TestMe_Authenticated(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/me", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["username"] != "admin" {
		t.Fatalf("expected username=admin, got %v", body["username"])
	}
	perms, ok := body["permissions"].([]any)
	if !ok || len(perms) == 0 {
		t.Fatal("expected non-empty permissions array")
	}
	roles, ok := body["roles"].([]any)
	if !ok || len(roles) == 0 {
		t.Fatal("expected non-empty roles array")
	}
}

func TestMe_Unauthenticated(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/me", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestMe_ExpiredSession(t *testing.T) {
	resetDB(t)

	// 创建一个已过期的 cookie
	expiredCookie := &http.Cookie{
		Name:  testCfg.AdminCookieName,
		Value: testAuth.MakeSessionValue(1000000000, "admin", "superadmin"), // 2001年，已过期
	}
	resp := doJSON("GET", "/admin/me", nil, expiredCookie)
	assertStatus(t, resp, http.StatusUnauthorized)
}
