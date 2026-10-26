package handler

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func emptyNodeReport() NodeAccountingRequest {
	return NodeAccountingRequest{Epoch: "test-runtime", Counters: []NodeTrafficCounter{}}
}

func accountingFixture(t *testing.T) (string, uint, string) {
	t.Helper()
	resetDB(t)
	token := setupCustomerSubscription(t)
	var id uint
	testDB.Raw("SELECT id FROM customer_subscriptions WHERE token = ?", token).Scan(&id)
	return token, id, deviceToken(t, "aabbccddeeff")
}

func TestNodeAccountingCommitsBeforeGrantAndRetries(t *testing.T) {
	_, id, credential := accountingFixture(t)
	mustExec(t, "UPDATE customer_subscriptions SET traffic_limit = 100 WHERE id = ?", id)
	report := NodeAccountingRequest{Epoch: "first", Counters: []NodeTrafficCounter{{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", id), Value: 60}}}
	for i := 0; i < 2; i++ {
		resp := doBearer("POST", "/nodes/aabbccddeeff/xray-users", report, credential)
		assertStatus(t, resp, 200)
		var out NodeXrayUsersResponse
		decodeBody(t, resp, &out)
		if len(out.Users) != 1 || out.LeaseSeconds != 45 {
			t.Fatalf("grant: %+v", out)
		}
	}
	report.Counters[0].Value = 100
	resp := doBearer("POST", "/nodes/aabbccddeeff/xray-users", report, credential)
	assertStatus(t, resp, 200)
	var out NodeXrayUsersResponse
	decodeBody(t, resp, &out)
	if len(out.Users) != 0 {
		t.Fatal("over-quota report must revoke authorization in the same response")
	}
	var used int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", id).Scan(&used)
	if used != 100 {
		t.Fatalf("used=%d, duplicate billing", used)
	}
	// Neither an out-of-order snapshot nor a manual quota reset may rebill history.
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used = 0 WHERE id = ?", id)
	report.Counters[0].Value = 90
	resp = doBearer("POST", "/nodes/aabbccddeeff/xray-users", report, credential)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", id).Scan(&used)
	if used != 0 {
		t.Fatalf("out-of-order report billed %d", used)
	}
}

func TestNodeAccountingEpochsAndConcurrentRetry(t *testing.T) {
	_, id, credential := accountingFixture(t)
	report := NodeAccountingRequest{Epoch: "epoch-one", Counters: []NodeTrafficCounter{{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>downlink", id), Value: 70}}}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := doBearer("POST", "/nodes/aabbccddeeff/xray-users", report, credential)
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				t.Errorf("concurrent report: %d", resp.StatusCode)
			}
		}()
	}
	wg.Wait()
	report.Epoch = "epoch-two"
	report.Counters[0].Value = 20
	resp := doBearer("POST", "/nodes/aabbccddeeff/xray-users", report, credential)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	var used int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id = ?", id).Scan(&used)
	if used != 90 {
		t.Fatalf("used=%d, want 90", used)
	}
}

func TestNodeAccountingExpiryLeaseAndDisabledNode(t *testing.T) {
	_, id, credential := accountingFixture(t)
	mustExec(t, "UPDATE customer_subscriptions SET expires_at = ? WHERE id = ?", time.Now().UTC().Add(12*time.Second), id)
	resp := doBearer("POST", "/nodes/aabbccddeeff/xray-users", emptyNodeReport(), credential)
	var out NodeXrayUsersResponse
	decodeBody(t, resp, &out)
	if out.LeaseSeconds < 1 || out.LeaseSeconds > 12 {
		t.Fatalf("lease outlives subscription: %d", out.LeaseSeconds)
	}
	mustExec(t, "UPDATE nodes SET enabled = 0")
	resp = doBearer("POST", "/nodes/aabbccddeeff/xray-users", emptyNodeReport(), credential)
	decodeBody(t, resp, &out)
	if len(out.Users) != 0 {
		t.Fatal("disabled node received users")
	}
	resp = doBearer("GET", "/nodes/aabbccddeeff/xray-users", nil, credential)
	assertStatus(t, resp, http.StatusUpgradeRequired)
	resp.Body.Close()
}

func TestNodeAccountingRejectsInvalidAndForeignCounters(t *testing.T) {
	_, id, credential := accountingFixture(t)
	name := fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", id)
	for _, report := range []NodeAccountingRequest{
		{Epoch: "", Counters: []NodeTrafficCounter{}},
		{Epoch: "ok", Counters: []NodeTrafficCounter{{Name: name, Value: -1}}},
		{Epoch: "ok", Counters: []NodeTrafficCounter{{Name: name, Value: 1}, {Name: name, Value: 2}}},
	} {
		resp := doBearer("POST", "/nodes/aabbccddeeff/xray-users", report, credential)
		assertStatus(t, resp, 400)
		resp.Body.Close()
	}
	insertSubTestNode(t, "112233445566")
	foreign := deviceToken(t, "112233445566")
	resp := doBearer("POST", "/nodes/112233445566/xray-users", NodeAccountingRequest{Epoch: "ok", Counters: []NodeTrafficCounter{{Name: name, Value: 100}}}, foreign)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	var used int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id=?", id).Scan(&used)
	if used != 0 {
		t.Fatal("foreign device charged subscription")
	}
}

func TestScopedSubscriptionsRequireCustomerAndEnforceQuota(t *testing.T) {
	token, id, _ := accountingFixture(t)
	lineToken := strings.Repeat("b", 64)
	mustExec(t, "UPDATE `lines` SET token=?", lineToken)
	paths := []string{"/l/" + lineToken, "/l/" + lineToken + "/vless", "/subscription", "/subscription/clash"}
	for _, path := range paths {
		resp := doJSON("GET", path, nil, adminCookie())
		assertStatus(t, resp, 401)
		resp.Body.Close()
		resp = doJSON("GET", path+"?subscription="+token, nil, adminCookie())
		assertStatus(t, resp, 200)
		body := readBody(resp)
		if strings.Contains(body, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
			t.Fatal("node UUID leaked")
		}
	}
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=traffic_limit WHERE id=?", id)
	resp := doJSON("GET", "/l/"+lineToken+"?subscription="+token, nil, nil)
	if body := readBody(resp); !strings.Contains(body, "MATCH,REJECT") || strings.Contains(body, "11111111-2222") {
		t.Fatalf("quota bypass: %s", body)
	}
}

func TestScopedSubscriptionCannotExpandPlanAndTokenRotationRevokesUUID(t *testing.T) {
	token, id, _ := accountingFixture(t)
	resp := doJSON("POST", "/admin/subscription-groups", map[string]string{"name": "restricted"}, adminCookie())
	group := parseJSON(resp)
	groupID := int(group["id"].(float64))
	groupToken := group["token"].(string)
	resp = doJSON("GET", "/s/"+groupToken, nil, nil)
	assertStatus(t, resp, 401)
	resp.Body.Close()
	insertSubTestNode(t, "112233445566")
	mustExec(t, "INSERT INTO subscription_group_nodes (group_id,node_mac) VALUES (?,?)", groupID, "112233445566")
	resp = doJSON("GET", "/s/"+groupToken+"?subscription="+token, nil, nil)
	assertStatus(t, resp, 200)
	if body := readBody(resp); strings.Contains(body, "test.example.com") {
		t.Fatal("group granted node outside plan")
	}
	resp = doJSON("POST", fmt.Sprintf("/admin/subscriptions/%d/reset-token", id), nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	var uuid string
	testDB.Raw("SELECT xray_uuid FROM customer_subscriptions WHERE id=?", id).Scan(&uuid)
	if uuid == "11111111-2222-4333-8444-555555555555" {
		t.Fatal("cached credentials survive token reset")
	}
	resp = doJSON("GET", "/c/"+token, nil, nil)
	assertStatus(t, resp, 404)
	resp.Body.Close()
}

func TestNodeAccountingSumsAuthorizedNodesAndDirections(t *testing.T) {
	_, id, firstCredential := accountingFixture(t)
	insertSubTestNode(t, "112233445566")
	mustExec(t, "INSERT INTO line_nodes (line_id, node_mac) SELECT id, '112233445566' FROM `lines`")
	secondCredential := deviceToken(t, "112233445566")
	report := NodeAccountingRequest{Epoch: "same-epoch", Counters: []NodeTrafficCounter{
		{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", id), Value: 20},
		{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>downlink", id), Value: 30},
	}}
	for _, device := range []struct{ mac, credential string }{{"aabbccddeeff", firstCredential}, {"112233445566", secondCredential}} {
		for retry := 0; retry < 2; retry++ {
			resp := doBearer("POST", "/nodes/"+device.mac+"/xray-users", report, device.credential)
			assertStatus(t, resp, 200)
			resp.Body.Close()
		}
	}
	var used int64
	testDB.Raw("SELECT traffic_used FROM customer_subscriptions WHERE id=?", id).Scan(&used)
	if used != 100 {
		t.Fatalf("multi-node used=%d, want 100", used)
	}
}
