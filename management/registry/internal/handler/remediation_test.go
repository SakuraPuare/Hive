package handler

import (
	"bytes"
	"encoding/json"
	"hive/registry/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if err := testDB.Exec(query, args...).Error; err != nil {
		t.Fatal(err)
	}
}
func scalar(t *testing.T, query string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := testDB.Raw(query, args...).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDeviceCredentialsAreMACScopedAndCannotAdminister(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	token := deviceToken(t, mac)
	for _, path := range []string{"/nodes/112233445566/xray-users", "/nodes/112233445566/commands", "/nodes/112233445566/clash-config", "/admin/customers"} {
		resp := doBearer("GET", path, nil, token)
		assertStatus(t, resp, http.StatusUnauthorized)
		resp.Body.Close()
	}
	for _, path := range []string{"/nodes/heartbeat", "/nodes/register", "/nodes/allocate-easytier"} {
		resp := doBearer("POST", path, map[string]string{"mac": "112233445566"}, token)
		assertStatus(t, resp, http.StatusUnauthorized)
		resp.Body.Close()
	}
	resp := doBearer("GET", "/nodes/"+mac+"/xray-users", nil, token)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doBearer("GET", "/admin/customers", nil, testCfg.APISecret)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doBearer("GET", "/nodes/"+mac+"/xray-users", nil, testCfg.APISecret)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doJSON("POST", "/admin/nodes/"+mac+"/credential", nil, adminCookie())
	assertStatus(t, resp, 200)
	rotated := parseJSON(resp)["token"].(string)
	resp = doBearer("GET", "/nodes/"+mac+"/xray-users", nil, token)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doBearer("GET", "/nodes/"+mac+"/xray-users", nil, rotated)
	assertStatus(t, resp, 200)
	resp.Body.Close()
}

func TestUserWriterCannotCreateSuperadmin(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "writer", "password123", "admin")
	mustExec(t, "INSERT INTO user_permissions (user_id,permission_id) SELECT ?,id FROM permissions WHERE slug = 'user:write'", uid)
	for _, role := range []string{"superadmin", "SUPERADMIN", "superádmin"} {
		resp := doJSON("POST", "/admin/users", map[string]string{"username": "elevated", "password": "password123", "role": role}, userCookieWithRole("writer", "admin"))
		assertStatus(t, resp, 403)
		resp.Body.Close()
	}
	if n := scalar(t, "SELECT COUNT(*) FROM users WHERE username='elevated'"); n != 0 {
		t.Fatalf("created %d privileged users", n)
	}
}

func TestBootstrapPreservesRevocations(t *testing.T) {
	resetDB(t)
	uid := createTestUser(t, "revoked", "password123", "admin")
	mustExec(t, "DELETE rp FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.name='admin' AND p.slug='node:write'")
	mustExec(t, "DELETE FROM user_roles WHERE user_id=?", uid)
	store.BootstrapRBAC(testDB)
	if n := scalar(t, "SELECT COUNT(*) FROM user_roles WHERE user_id=?", uid); n != 0 {
		t.Fatal("revoked role restored")
	}
	if n := scalar(t, "SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.name='admin' AND p.slug='node:write'"); n != 0 {
		t.Fatal("revoked permission restored")
	}
}

func TestResetChallengeLocksAfterFiveAttempts(t *testing.T) {
	resetDB(t)
	email := "attempts@example.com"
	insertTestCustomer(t, email)
	insertResetCode(t, email, "123456", time.Now().Add(time.Minute), false)
	// Call the handler directly to model attempts from different IPs. The
	// persisted challenge limit must work independently of the IP limiter.
	call := func(code string) int {
		body, _ := json.Marshal(map[string]string{"email": strings.ToUpper(email), "code": code, "password": "replacement123"})
		req := httptest.NewRequest("POST", "/portal/reset-password", bytes.NewReader(body))
		rr := httptest.NewRecorder()
		testH.HandleResetPassword(rr, req)
		return rr.Code
	}
	for i := 0; i < 5; i++ {
		if code := call("000000"); code != 400 {
			t.Fatalf("wrong code status %d", code)
		}
	}
	if code := call("123456"); code != 400 {
		t.Fatalf("exhausted challenge accepted: %d", code)
	}
	if n := scalar(t, "SELECT attempts FROM password_reset_codes WHERE email=?", email); n != 5 {
		t.Fatalf("attempts=%d", n)
	}
}
