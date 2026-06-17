package handler

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/model"
)

// insertSubTestNode inserts a node with cf_url and xray_uuid set so subscription
// endpoints actually produce output.
func insertSubTestNode(t *testing.T, mac string) {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	mac6 := mac
	if len(mac) > 6 {
		mac6 = mac[len(mac)-6:]
	}
	err := testDB.Exec(`INSERT INTO nodes (mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, easytier_ip, frp_port, xray_uuid, location, note, registered_at, last_seen, enabled, status, weight, region)
		VALUES (?, ?, ?, 'https://test.example.com', '', '', '', 0, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'JP', 'test', ?, ?, 1, 'active', 100, 'Asia')`,
		mac, mac6, "test-"+mac, now, now).Error
	if err != nil {
		t.Fatalf("insertSubTestNode %s: %v", mac, err)
	}
}

// setupCustomerSubscription creates the full chain: node → line → plan → customer → subscription.
// Returns the subscription token.
func setupCustomerSubscription(t *testing.T) string {
	t.Helper()
	insertSubTestNode(t, "aabbccddeeff")

	now := time.Now().UTC().Format(model.TimeLayout)

	// line
	var lineID uint
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("INSERT INTO `lines` (name, region, token, enabled, display_order, created_at, updated_at) VALUES ('JP','JP','dummy',1,0,?,?)", now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&lineID).Error
	}); err != nil {
		t.Fatalf("insert test line: %v", err)
	}

	// line → node
	testDB.Exec("INSERT INTO line_nodes (line_id, node_mac) VALUES (?, 'aabbccddeeff')", lineID)

	// plan
	planID := insertTestPlan(t, "SubPlan")

	// plan → line
	testDB.Exec("INSERT INTO plan_lines (plan_id, line_id) VALUES (?, ?)", planID, lineID)

	// customer
	cid := insertTestCustomer(t, "sub@test.com")

	// subscription
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	expires := time.Now().Add(30 * 24 * time.Hour).UTC().Format(model.TimeLayout)
	testDB.Exec(`INSERT INTO customer_subscriptions (customer_id, plan_id, token, xray_uuid, status, traffic_used, traffic_limit, device_limit, started_at, expires_at, created_at, updated_at)
		VALUES (?,?,?,'11111111-2222-4333-8444-555555555555','active',0,107374182400,3,?,?,?,?)`, cid, planID, token, now, expires, now, now)

	return token
}

// ── Admin subscription tests ────────────────────────────────────────────────

func TestAdminSubscriptionVless(t *testing.T) {
	resetDB(t)
	insertSubTestNode(t, "aabbccddeeff")

	resp := doJSON("GET", "/subscription", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if body == "" {
		t.Fatal("expected non-empty base64 VLESS content")
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q, want text/plain", ct)
	}
}

func TestAdminSubscriptionVless_Bearer(t *testing.T) {
	resetDB(t)
	insertSubTestNode(t, "aabbccddeeff")

	resp := doJSON("GET", "/subscription", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if body == "" {
		t.Fatal("expected non-empty base64 VLESS content")
	}
}

func TestAdminSubscriptionVless_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/subscription", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestAdminSubscriptionClash(t *testing.T) {
	resetDB(t)
	insertSubTestNode(t, "aabbccddeeff")

	resp := doJSON("GET", "/subscription/clash", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if !strings.Contains(body, "proxies:") {
		t.Errorf("expected Clash YAML with proxies, got: %s", body[:min(len(body), 200)])
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q, want text/plain", ct)
	}
}

func TestAdminSubscriptionClash_Bearer(t *testing.T) {
	resetDB(t)
	insertSubTestNode(t, "aabbccddeeff")

	resp := doJSON("GET", "/subscription/clash", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if !strings.Contains(body, "proxies:") {
		t.Errorf("expected Clash YAML with proxies, got: %s", body[:min(len(body), 200)])
	}
}

func TestAdminSubscriptionClash_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doJSON("GET", "/subscription/clash", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Customer subscription tests ─────────────────────────────────────────────

func TestCustomerSubscriptionClash(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if !strings.Contains(body, "proxies:") {
		t.Errorf("expected Clash YAML with proxies, got: %s", body[:min(len(body), 200)])
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q, want text/plain", ct)
	}
}

func TestCustomerSubscriptionVless(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	resp := doJSON("GET", "/c/"+token+"/vless", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	body := readBody(resp)
	if body == "" {
		t.Fatal("expected non-empty base64 VLESS content")
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q, want text/plain", ct)
	}

	// The VLESS link must use the SUBSCRIPTION's xray_uuid, not the node's.
	decoded, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("decode base64 body: %v", err)
	}
	link := string(decoded)
	if !strings.Contains(link, "11111111-2222-4333-8444-555555555555") {
		t.Errorf("VLESS link should contain subscription UUID, got: %s", link)
	}
	if strings.Contains(link, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
		t.Errorf("VLESS link must NOT contain node UUID, got: %s", link)
	}
}

func TestNodeXrayUsers(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t) // builds node aabbccddeeff → line → plan → sub

	resp := doBearer("GET", "/nodes/aabbccddeeff/xray-users", nil, testCfg.APISecret)
	assertStatus(t, resp, http.StatusOK)

	var out struct {
		MAC   string `json:"mac"`
		Users []struct {
			UUID  string `json:"uuid"`
			Email string `json:"email"`
		} `json:"users"`
	}
	decodeBody(t, resp, &out)

	if out.MAC != "aabbccddeeff" {
		t.Fatalf("mac = %q, want aabbccddeeff", out.MAC)
	}
	if len(out.Users) != 1 {
		t.Fatalf("expected 1 user, got %d (%+v)", len(out.Users), out.Users)
	}
	if out.Users[0].UUID != "11111111-2222-4333-8444-555555555555" {
		t.Errorf("user uuid = %q, want subscription uuid", out.Users[0].UUID)
	}
	// email must be sub-<id> so traffic loop can attribute back to the subscription.
	if !strings.HasPrefix(out.Users[0].Email, "sub-") {
		t.Errorf("user email = %q, want sub-<id> form", out.Users[0].Email)
	}

	_ = token
}

func TestNodeXrayUsers_Unauthorized(t *testing.T) {
	resetDB(t)
	resp := doBearer("GET", "/nodes/aabbccddeeff/xray-users", nil, "wrong-secret")
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestNodeXrayUsers_ExcludesInvalidSubs(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	// Expire the subscription: it must drop out of the node's user list.
	testDB.Exec("UPDATE customer_subscriptions SET expires_at = '2020-01-01 00:00:00' WHERE token = ?", token)

	resp := doBearer("GET", "/nodes/aabbccddeeff/xray-users", nil, testCfg.APISecret)
	assertStatus(t, resp, http.StatusOK)

	var out struct {
		Users []struct {
			UUID string `json:"uuid"`
		} `json:"users"`
	}
	decodeBody(t, resp, &out)
	if len(out.Users) != 0 {
		t.Fatalf("expired subscription must be excluded, got %d users", len(out.Users))
	}
}

func TestCustomerSubscription_InvalidToken(t *testing.T) {
	resetDB(t)

	// wrong length
	resp := doJSON("GET", "/c/badtoken", nil, nil)
	assertStatus(t, resp, http.StatusNotFound)

	// correct length but nonexistent
	fakeToken := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	resp = doJSON("GET", "/c/"+fakeToken, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
}

func TestCustomerSubscription_ExpiredSubscription(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	// set expires_at to the past
	testDB.Exec("UPDATE customer_subscriptions SET expires_at = '2020-01-01 00:00:00' WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)
	body := readBody(resp)
	if !strings.Contains(body, "订阅已过期") {
		t.Fatalf("expected expired message, got: %s", body)
	}
}

func TestCustomerSubscription_InactiveSubscription(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	testDB.Exec("UPDATE customer_subscriptions SET status = 'suspended' WHERE token = ?", token)

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusOK)
	body := readBody(resp)
	if !strings.Contains(body, "订阅已停用") {
		t.Fatalf("expected suspended message, got: %s", body)
	}
}

func TestCustomerSubscription_InactiveCustomer(t *testing.T) {
	resetDB(t)
	token := setupCustomerSubscription(t)

	testDB.Exec("UPDATE customers SET status = 'suspended' WHERE email = 'sub@test.com'")

	resp := doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
}
