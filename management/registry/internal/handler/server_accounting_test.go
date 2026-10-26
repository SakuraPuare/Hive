package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type pausedTrafficReport struct {
	io.Reader
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (p *pausedTrafficReport) Read(b []byte) (int, error) {
	p.once.Do(func() { close(p.started); <-p.release })
	return p.Reader.Read(b)
}

func TestServerRevocationDuringReportCannotCharge(t *testing.T) {
	_, id, token := accountingFixture(t)
	payload, _ := json.Marshal(NodeAccountingRequest{Epoch: "inflight", Counters: []NodeTrafficCounter{{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", id), Value: 100}}})
	body := &pausedTrafficReport{Reader: bytes.NewReader(payload), started: make(chan struct{}), release: make(chan struct{})}
	req := httptest.NewRequest("POST", "/servers/aabbccddeeff/accounting", body)
	req.SetPathValue("mac", "aabbccddeeff")
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); testH.HandleNodeAccounting(response, req) }()
	// The handler authenticates first, then begins decoding the body. Hold it
	// there while revocation commits to exercise the transaction's recheck.
	select {
	case <-body.started:
	case <-time.After(5 * time.Second):
		close(body.release)
		t.Fatal("report never reached body decoding")
	}
	resp := doJSON("DELETE", "/admin/nodes/aabbccddeeff/server-credential", nil, adminCookie())
	close(body.release)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("report did not complete")
	}
	if response.Code != 401 {
		t.Fatalf("revoked report returned %d: %s", response.Code, response.Body.String())
	}
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 0 || scalar(t, "SELECT COUNT(*) FROM node_traffic_counters") != 0 {
		t.Fatal("revoked in-flight report was billed")
	}
}

func TestServerAccountingRejectsCustomerDeviceAndAdminCredentials(t *testing.T) {
	_, id, server := accountingFixture(t)
	mac := "aabbccddeeff"
	device := deviceToken(t, mac)
	report := NodeAccountingRequest{Epoch: "forged", Counters: []NodeTrafficCounter{{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", id), Value: 900}}}
	for _, token := range []string{device, testCfg.APISecret, testCfg.AdminAPISecret, ""} {
		resp := doBearer("POST", "/servers/"+mac+"/accounting", report, token)
		assertStatus(t, resp, 401)
		if strings.Contains(readBody(resp), "11111111-2222") {
			t.Fatal("unauthorized caller obtained subscriber UUID")
		}
	}
	for _, cookie := range []*http.Cookie{adminCookie(), customerCookie(uint(scalar(t, "SELECT customer_id FROM customer_subscriptions WHERE id=?", id)))} {
		resp := doJSON("POST", "/servers/"+mac+"/accounting", report, cookie)
		assertStatus(t, resp, 401)
		resp.Body.Close()
	}
	for _, method := range []string{"GET", "POST"} {
		resp := doBearer(method, "/nodes/"+mac+"/xray-users", report, device)
		assertStatus(t, resp, 426)
		resp.Body.Close()
	}
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 0 {
		t.Fatal("device report was billed")
	}
	if scalar(t, "SELECT COUNT(*) FROM node_traffic_counters") != 0 {
		t.Fatal("device report persisted")
	}
	resp := doBearer("GET", "/nodes/"+mac+"/clash-config", nil, server)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doBearer("POST", "/servers/"+mac+"/accounting", report, server)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 900 {
		t.Fatal("trusted exit was not billed")
	}
}

func TestServerCredentialLifecycleAndScope(t *testing.T) {
	resetDB(t)
	mac, other := "aabbccddeeff", "112233445566"
	insertTestNode(t, mac)
	insertTestNode(t, other)
	device := deviceToken(t, mac)
	createTestUser(t, "viewer", "password123", "viewer")
	path := "/admin/nodes/" + mac + "/server-credential"
	for _, method := range []string{"POST", "DELETE"} {
		resp := doBearer(method, path, nil, device)
		assertStatus(t, resp, 401)
		resp.Body.Close()
		resp = doJSON(method, path, nil, userCookieWithRole("viewer", "viewer"))
		if resp.StatusCode != 403 {
			t.Fatalf("viewer changed server role: %d", resp.StatusCode)
		}
		resp.Body.Close()
	}
	resp := doJSON("POST", path, nil, adminCookie())
	assertStatus(t, resp, 200)
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("credential response can be cached")
	}
	var out ServerCredentialResponse
	decodeBody(t, resp, &out)
	first := out.Token
	if first == "" {
		t.Fatal("empty credential")
	}
	var stored string
	testDB.Raw("SELECT token_hash FROM server_credentials WHERE mac=?", mac).Scan(&stored)
	if stored == first || len(stored) != 64 {
		t.Fatal("credential stored in plaintext")
	}
	resp = doBearer("POST", "/servers/"+other+"/accounting", emptyNodeReport(), first)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	second := serverToken(t, mac)
	resp = doBearer("POST", "/servers/"+mac+"/accounting", emptyNodeReport(), first)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	resp = doBearer("POST", "/servers/"+mac+"/accounting", emptyNodeReport(), second)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("DELETE", path, nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doBearer("POST", "/servers/"+mac+"/accounting", emptyNodeReport(), second)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	if scalar(t, "SELECT server_enabled FROM nodes WHERE mac=?", mac) != 0 || scalar(t, "SELECT COUNT(*) FROM server_credentials WHERE mac=?", mac) != 0 {
		t.Fatal("revocation incomplete")
	}
	serverToken(t, mac)
	resp = doJSON("DELETE", "/nodes/"+mac, nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if scalar(t, "SELECT COUNT(*) FROM server_credentials WHERE mac=?", mac) != 0 {
		t.Fatal("deleted server retained credential")
	}
}

func TestServerRoleCannotBeSelfGrantedOrCustomerClaimed(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	cid := insertTestCustomer(t, "device-owner@test.com")
	device := deviceToken(t, mac)
	resp := doBearer("POST", "/nodes/register", map[string]any{"mac": mac, "hostname": "client", "cf_url": "https://client.invalid", "xray_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "server_enabled": true}, device)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if scalar(t, "SELECT server_enabled FROM nodes WHERE mac=?", mac) != 0 {
		t.Fatal("device self-promoted")
	}
	mustExec(t, "UPDATE nodes SET claim_code_hash=? WHERE mac=?", hashClaimCode("ABCD-1234"), mac)
	serverToken(t, mac)
	resp = doJSON("POST", "/portal/devices/claim", PortalClaimRequest{Code: "ABCD-1234"}, customerCookie(cid))
	assertStatus(t, resp, 409)
	resp.Body.Close()
	resp = doJSON("POST", "/admin/nodes/"+mac+"/assign", AssignDeviceRequest{CustomerID: cid}, adminCookie())
	assertStatus(t, resp, 409)
	resp.Body.Close()
	resp = doJSON("DELETE", "/admin/nodes/"+mac+"/server-credential", nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("POST", "/portal/devices/claim", PortalClaimRequest{Code: "ABCD-1234"}, customerCookie(cid))
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("POST", "/admin/nodes/"+mac+"/server-credential", nil, adminCookie())
	assertStatus(t, resp, 409)
	resp.Body.Close()
	resp = doJSON("POST", "/portal/devices/"+mac+"/unbind", nil, customerCookie(cid))
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if scalar(t, "SELECT server_enabled FROM nodes WHERE mac=?", mac) != 0 {
		t.Fatal("unbinding auto-promoted a customer device")
	}
}

func TestServerPromotionSerializesWithOwnership(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "race-owner@test.com")
	// Exercise both customer claims and administrator assignments racing promotion.
	for i := 0; i < 12; i++ {
		mac := fmt.Sprintf("00000000%04x", i+1)
		insertTestNode(t, mac)
		code := fmt.Sprintf("CODE-%04d", i)
		mustExec(t, "UPDATE nodes SET claim_code_hash=? WHERE mac=?", hashClaimCode(code), mac)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			resp := doJSON("POST", "/admin/nodes/"+mac+"/server-credential", nil, adminCookie())
			defer resp.Body.Close()
			if resp.StatusCode != 200 && resp.StatusCode != 409 {
				t.Errorf("promotion: %d", resp.StatusCode)
			}
		}()
		go func() {
			defer wg.Done()
			var resp *http.Response
			if i%2 == 0 {
				resp = doJSON("POST", "/portal/devices/claim", PortalClaimRequest{Code: code}, customerCookie(cid))
			} else {
				resp = doJSON("POST", "/admin/nodes/"+mac+"/assign", AssignDeviceRequest{CustomerID: cid}, adminCookie())
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 && resp.StatusCode != 409 {
				t.Errorf("ownership: %d", resp.StatusCode)
			}
		}()
		wg.Wait()
		if scalar(t, "SELECT COUNT(*) FROM nodes WHERE mac=? AND server_enabled=1 AND owner_customer_id IS NOT NULL", mac) != 0 {
			t.Fatal("customer acquired an enabled exit")
		}
	}
}

func TestOnlyTrustedExitsAppearInSubscriptionsAndGateway(t *testing.T) {
	token, id, _ := accountingFixture(t)
	const client = "112233445566"
	insertSubTestNode(t, client)
	mustExec(t, "UPDATE nodes SET cf_url='https://untrusted.invalid',bound_subscription_id=? WHERE mac=?", id, client)
	mustExec(t, "INSERT INTO line_nodes (line_id,node_mac) SELECT id,? FROM `lines`", client)
	for _, path := range []string{"/c/" + token, "/subscription/clash?subscription=" + token} {
		resp := doJSON("GET", path, nil, adminCookie())
		assertStatus(t, resp, 200)
		body := readBody(resp)
		if strings.Contains(body, "untrusted.invalid") || !strings.Contains(body, "test.example.com") {
			t.Fatalf("exported wrong roles: %s", body)
		}
	}
	device := deviceToken(t, client)
	resp := doBearer("GET", "/nodes/"+client+"/clash-config", nil, device)
	assertStatus(t, resp, 200)
	if body := readBody(resp); !strings.Contains(body, "test.example.com") || strings.Contains(body, "untrusted.invalid") {
		t.Fatalf("gateway upstreams: %s", body)
	}
	resp = doJSON("DELETE", "/admin/nodes/aabbccddeeff/server-credential", nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, 200)
	if body := readBody(resp); strings.Contains(body, "test.example.com") || strings.Contains(body, "untrusted.invalid") {
		t.Fatalf("revoked exit exported: %s", body)
	}
	resp = doBearer("GET", "/nodes/"+client+"/clash-config", nil, device)
	assertStatus(t, resp, 200)
	if resp.Header.Get("X-Hive-Access") != "blocked" {
		t.Fatal("gateway retained revoked exit")
	}
	resp.Body.Close()
}
