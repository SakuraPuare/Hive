package handler

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func ownerAccessToken(t *testing.T, mac string, cid uint) string {
	t.Helper()
	resp := doJSON("GET", "/portal/devices/"+mac+"/subscription-access", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	var out PortalDeviceSubscriptionAccessResponse
	decodeBody(t, resp, &out)
	if len(out.Token) != 64 {
		t.Fatalf("invalid private token: %q", out.Token)
	}
	return out.Token
}

func ownerUUID(t *testing.T, mac string) string {
	t.Helper()
	var uuid string
	if err := testDB.Raw("SELECT COALESCE(owner_xray_uuid, '') FROM nodes WHERE mac = ?", mac).Scan(&uuid).Error; err != nil {
		t.Fatal(err)
	}
	return uuid
}

func ownerGrant(t *testing.T, mac string, capable bool) NodeXrayUsersResponse {
	t.Helper()
	report := emptyNodeReport()
	report.OwnerAccess = capable
	resp := doBearer("POST", "/nodes/"+mac+"/xray-users", report, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	var out NodeXrayUsersResponse
	decodeBody(t, resp, &out)
	return out
}

func assertOwnerOnly(t *testing.T, out NodeXrayUsersResponse, cid uint, uuid string) {
	t.Helper()
	if len(out.Users) != 1 || out.Users[0].Email != fmt.Sprintf("owner-%d", cid) || out.Users[0].UUID != uuid || len(out.DeviceLimits) != 0 || out.LeaseSeconds != subscriptionLeaseSeconds {
		t.Fatalf("owner-only grant: %+v", out)
	}
}

func TestOwnerSubscriptionWithoutPaidPlanAndPrivateJSON(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "owner-free@example.com")
	other := insertTestCustomer(t, "owner-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	// Existing claimed devices lazily receive private credentials.
	token := ownerAccessToken(t, mac, cid)
	uuid := ownerUUID(t, mac)
	if len(uuid) != 36 || uuid == "uuid-"+mac {
		t.Fatalf("owner UUID not independently generated: %q", uuid)
	}
	if next := ownerAccessToken(t, mac, cid); next != token {
		t.Fatal("repeated access rotated credentials")
	}
	assertOwnerOnly(t, ownerGrant(t, mac, true), cid, uuid)
	if out := ownerGrant(t, mac, false); len(out.Users) != 0 {
		t.Fatalf("old agent received unsupported owner identity: %+v", out)
	}
	if scalar(t, "SELECT COUNT(*) FROM customer_subscriptions") != 0 {
		t.Fatal("free device access created a paid subscription")
	}
	resp := doJSON("GET", "/portal/devices/"+mac+"/subscription-access", nil, customerCookie(other))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	resp = doJSON("GET", "/portal/devices/"+mac+"/subscription-access", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
	resp.Body.Close()
	for _, path := range []string{"/portal/devices", "/portal/devices/" + mac, "/admin/nodes"} {
		cookie := customerCookie(cid)
		if path == "/admin/nodes" {
			cookie = adminCookie()
		}
		body := readBody(doJSON("GET", path, nil, cookie))
		if strings.Contains(body, token) || strings.Contains(body, uuid) || strings.Contains(body, "owner_access_token") || strings.Contains(body, "owner_xray_uuid") {
			t.Fatalf("private credentials exposed by %s", path)
		}
	}
	for _, direction := range []string{DirectionOverseas, DirectionDomestic} {
		mustExec(t, "UPDATE nodes SET exit_direction = ? WHERE mac = ?", direction, mac)
		body := readBody(doJSON("GET", "/d/"+token, nil, nil))
		if !strings.Contains(body, uuid) || !strings.Contains(body, mac+".example.com") {
			t.Fatalf("free device missing from %s config: %s", direction, body)
		}
		if direction == DirectionDomestic && !strings.Contains(body, "cn_domain,回国") {
			t.Fatalf("domestic device used wrong routing: %s", body)
		}
		encoded := readBody(doJSON("GET", "/d/"+token+"/vless", nil, nil))
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || !strings.Contains(string(decoded), "vless://"+uuid+"@") {
			t.Fatalf("free VLESS: %s, %v", decoded, err)
		}
	}
	resp = doJSON("GET", "/d/"+strings.Repeat("f", 64), nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}

func TestOwnerSubscriptionConcurrentInitialization(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "owner-concurrent@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	var wg sync.WaitGroup
	tokens := make(chan string, 5)
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := doJSON("GET", "/portal/devices/"+mac+"/subscription-access", nil, customerCookie(cid))
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Errorf("concurrent access status: %d", resp.StatusCode)
				return
			}
			var out PortalDeviceSubscriptionAccessResponse
			decodeBody(t, resp, &out)
			tokens <- out.Token
		}()
	}
	wg.Wait()
	close(tokens)
	want := ownerAccessToken(t, mac, cid)
	for token := range tokens {
		if token != want {
			t.Fatalf("concurrent initialization returned different credentials")
		}
	}
}

func TestOwnerSubscriptionIgnoresPaidExpiryQuotaAndPreservesBilling(t *testing.T) {
	resetDB(t)
	paidToken := setupCustomerSubscription(t)
	mac := "aabbccddeeff"
	var sub struct {
		ID         uint
		CustomerID uint
		XrayUUID   string
	}
	testDB.Raw("SELECT id, customer_id, xray_uuid FROM customer_subscriptions WHERE token = ?", paidToken).Scan(&sub)
	mustExec(t, "UPDATE nodes SET server_enabled = 0, owner_customer_id = ? WHERE mac = ?", sub.CustomerID, mac)
	token := ownerAccessToken(t, mac, sub.CustomerID)
	uuid := ownerUUID(t, mac)
	out := ownerGrant(t, mac, true)
	if len(out.Users) != 2 || out.Users[0].UUID != sub.XrayUUID || out.Users[0].Email != fmt.Sprintf("sub-%d", sub.ID) || len(out.DeviceLimits) != 1 || out.DeviceLimits[0].SubscriptionID != sub.ID {
		t.Fatalf("paid plus free grant: %+v", out)
	}
	// Only the paid sub-* counters are sent. Owner use cannot create accounting
	// rows or online-device limits and must not affect the paid allowance.
	report := NodeAccountingRequest{Epoch: "paid-and-free", OwnerAccess: true, Counters: []NodeTrafficCounter{{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", sub.ID), Value: 40}}}
	resp := doBearer("POST", "/nodes/"+mac+"/xray-users", report, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if got := scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id = ?", sub.ID); got != 40 {
		t.Fatalf("paid billing changed: %d", got)
	}
	for _, update := range []string{
		"UPDATE customer_subscriptions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY)",
		"UPDATE customer_subscriptions SET expires_at = DATE_ADD(NOW(), INTERVAL 1 DAY), traffic_limit = 40, traffic_used = 40",
		"UPDATE customer_subscriptions SET status = 'suspended'",
	} {
		mustExec(t, update)
		assertOwnerOnly(t, ownerGrant(t, mac, true), sub.CustomerID, uuid)
		body := readBody(doJSON("GET", "/d/"+token, nil, nil))
		if !strings.Contains(body, uuid) {
			t.Fatal("paid invalidity revoked free owner access")
		}
	}
	if got := scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id = ?", sub.ID); got != 40 {
		t.Fatalf("owner reports deducted paid quota: %d", got)
	}
	if got := scalar(t, "SELECT COUNT(*) FROM node_traffic_counters WHERE counter_name LIKE '%owner-%'"); got != 0 {
		t.Fatal("owner traffic entered billing")
	}
	if got := scalar(t, "SELECT COUNT(*) FROM subscription_online_devices"); got != 0 {
		t.Fatal("owner use consumed paid device slots")
	}
}

func TestOwnerSubscriptionEligibilityAndRevocation(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "owner-switches@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	token := ownerAccessToken(t, mac, cid)
	uuid := ownerUUID(t, mac)
	for _, update := range []string{
		"enabled = 0", "status = 'disabled'", "exit_enabled = 0", "owner_exit_enabled = 0",
	} {
		mustExec(t, "UPDATE nodes SET enabled = 1, status = 'active', exit_enabled = 1, owner_exit_enabled = 1 WHERE mac = ?", mac)
		mustExec(t, "UPDATE nodes SET "+update+" WHERE mac = ?", mac)
		if out := ownerGrant(t, mac, true); len(out.Users) != 0 {
			t.Fatalf("disabled device received owner: %s, %+v", update, out)
		}
		body := readBody(doJSON("GET", "/d/"+token, nil, nil))
		if !strings.Contains(body, "MATCH,DIRECT") || strings.Contains(body, uuid) {
			t.Fatalf("disabled export leaked proxy: %s", body)
		}
		encoded := readBody(doJSON("GET", "/d/"+token+"/vless", nil, nil))
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || strings.Contains(string(decoded), uuid) || strings.Contains(string(decoded), "vless://") {
			t.Fatalf("disabled VLESS leaked proxy: %s, %v", decoded, err)
		}
	}
	mustExec(t, "UPDATE nodes SET enabled = 1, status = 'active', exit_enabled = 1, owner_exit_enabled = 1 WHERE mac = ?", mac)
	mustExec(t, "UPDATE customers SET status = 'suspended' WHERE id = ?", cid)
	if out := ownerGrant(t, mac, true); len(out.Users) != 0 {
		t.Fatal("disabled customer received owner access")
	}
	resp := doJSON("GET", "/d/"+token, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	mustExec(t, "UPDATE customers SET status = 'active' WHERE id = ?", cid)
	mustExec(t, "UPDATE nodes SET server_enabled = 1 WHERE mac = ?", mac)
	resp = doJSON("GET", "/d/"+token, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	resp = doJSON("GET", "/portal/devices/"+mac+"/subscription-access", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	mustExec(t, "UPDATE nodes SET server_enabled = 0 WHERE mac = ?", mac)
	mustExec(t, "DELETE FROM customers WHERE id = ?", cid)
	resp = doJSON("GET", "/d/"+token, nil, nil)
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	if out := ownerGrant(t, mac, true); len(out.Users) != 0 {
		t.Fatal("deleted customer retained owner access")
	}
}

func TestOwnerSubscriptionOwnershipTransitionsRotateCredentials(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "owner-transfer@example.com")
	other := insertTestCustomer(t, "owner-transfer-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, owner)
	mustExec(t, "UPDATE nodes SET claim_code_hash = ? WHERE mac = ?", hashClaimCode("ABCD-EFGH"), mac)
	token := ownerAccessToken(t, mac, owner)
	uuid := ownerUUID(t, mac)
	resp := doJSON("POST", "/admin/nodes/"+mac+"/assign", AssignDeviceRequest{CustomerID: owner}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if ownerAccessToken(t, mac, owner) != token || ownerUUID(t, mac) != uuid {
		t.Fatal("same-owner assignment rotated credentials")
	}
	for _, transition := range []string{"transfer", "unassign", "unbind"} {
		oldToken, oldUUID := token, ownerUUID(t, mac)
		switch transition {
		case "transfer":
			resp = doJSON("POST", "/admin/nodes/"+mac+"/assign", AssignDeviceRequest{CustomerID: other}, adminCookie())
		case "unassign":
			resp = doJSON("POST", "/admin/nodes/"+mac+"/unassign", nil, adminCookie())
		case "unbind":
			resp = doJSON("POST", "/portal/devices/"+mac+"/unbind", nil, customerCookie(other))
		}
		assertStatus(t, resp, http.StatusOK)
		resp.Body.Close()
		if ownerUUID(t, mac) != "" {
			t.Fatal("ownership transition kept old UUID")
		}
		resp = doJSON("GET", "/d/"+oldToken, nil, nil)
		assertStatus(t, resp, http.StatusNotFound)
		resp.Body.Close()
		if transition != "transfer" {
			// Even corrupt/stale credentials on an unowned device are cleared by claim.
			mustExec(t, "UPDATE nodes SET owner_access_token = ?, owner_xray_uuid = ? WHERE mac = ?", oldToken, oldUUID, mac)
			resp = doJSON("POST", "/portal/devices/claim", PortalClaimRequest{Code: "ABCD-EFGH"}, customerCookie(other))
			assertStatus(t, resp, http.StatusOK)
			resp.Body.Close()
			if ownerUUID(t, mac) != "" {
				t.Fatal("claim retained stale UUID")
			}
		}
		token = ownerAccessToken(t, mac, other)
		if token == oldToken || ownerUUID(t, mac) == oldUUID {
			t.Fatal("new ownership reused revoked credentials")
		}
		assertOwnerOnly(t, ownerGrant(t, mac, true), other, ownerUUID(t, mac))
	}
}

func TestOwnerCapabilityNeverGrantsTrustedServerOwnerIdentity(t *testing.T) {
	resetDB(t)
	setupCustomerSubscription(t)
	mac := "aabbccddeeff"
	credential := serverToken(t, mac)
	// Hidden stale credentials alone cannot authorize owner access in trusted mode.
	mustExec(t, "UPDATE nodes SET owner_access_token = ?, owner_xray_uuid = ? WHERE mac = ?", strings.Repeat("b", 64), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", mac)
	report := emptyNodeReport()
	report.OwnerAccess = true
	resp := doBearer("POST", "/servers/"+mac+"/accounting", report, credential)
	assertStatus(t, resp, http.StatusOK)
	var out NodeXrayUsersResponse
	decodeBody(t, resp, &out)
	if len(out.Users) != 1 || !strings.HasPrefix(out.Users[0].Email, "sub-") {
		t.Fatalf("trusted server grant: %+v", out)
	}
	// Paid authorization keeps its expiry lease even alongside free owner access.
	mustExec(t, "UPDATE nodes SET server_enabled = 0, owner_customer_id = (SELECT customer_id FROM customer_subscriptions LIMIT 1) WHERE mac = ?", mac)
	mustExec(t, "UPDATE customer_subscriptions SET expires_at = ?", time.Now().UTC().Add(12*time.Second))
	out = ownerGrant(t, mac, true)
	if len(out.Users) != 2 || out.LeaseSeconds < 1 || out.LeaseSeconds > 12 {
		t.Fatalf("paid expiry lease lost with owner: %+v", out)
	}
}
