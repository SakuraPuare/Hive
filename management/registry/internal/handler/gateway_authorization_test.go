package handler

import (
	"net/http"
	"strings"
	"testing"

	"hive/registry/internal/model"
)

func boundGatewayFixture(t *testing.T) (string, uint, uint, string) {
	t.Helper()
	resetDB(t)
	token := setupCustomerSubscription(t)
	sid := uint(scalar(t, "SELECT id FROM customer_subscriptions WHERE token = ?", token))
	owner := uint(scalar(t, "SELECT customer_id FROM customer_subscriptions WHERE id = ?", sid))
	mac := "112233445566"
	insertSubTestNode(t, mac)
	// The fixture gateway sits abroad (global) and must dial a domestic entry for
	// its proxied traffic, so the only plan node is marked as a 回国 node.
	mustExec(t, "UPDATE nodes SET exit_direction = 'domestic' WHERE mac = 'aabbccddeeff'")
	mustExec(t, "UPDATE nodes SET owner_customer_id = ?, bound_subscription_id = ?, gateway_enabled = 1, gateway_direction = 'global', owner_exit_enabled = 0, claim_code_hash = ? WHERE mac = ?", owner, sid, hashClaimCode("ABCD-EFGH"), mac)
	return mac, owner, sid, deviceToken(t, mac)
}

func assertGatewayAccess(t *testing.T, mac, credential, access string) {
	t.Helper()
	resp := doBearer("GET", "/nodes/"+mac+"/clash-config", nil, credential)
	assertStatus(t, resp, http.StatusOK)
	if got := resp.Header.Get("X-Hive-Access"); got != access {
		t.Errorf("gateway access = %q, want %q", got, access)
	}
	body := readBody(resp)
	const subscriptionUUID = "11111111-2222-4333-8444-555555555555"
	if access == "blocked" {
		if strings.Contains(body, subscriptionUUID) || !strings.Contains(body, "MATCH,REJECT") {
			t.Fatalf("blocked gateway retained a subscription or direct fallback: %s", body)
		}
	} else if !strings.Contains(body, subscriptionUUID) || !strings.Contains(body, "MATCH,代理") {
		t.Fatalf("authorized gateway lost its subscription route: %s", body)
	}
}

func TestGatewayOwnershipChangesRevokeSubscription(t *testing.T) {
	for _, action := range []string{"portal-unbind", "admin-unassign", "admin-transfer", "claim"} {
		t.Run(action, func(t *testing.T) {
			mac, owner, _, credential := boundGatewayFixture(t)
			other := insertTestCustomer(t, "next-owner@example.com")
			assertGatewayAccess(t, mac, credential, "active")
			var resp *http.Response
			switch action {
			case "portal-unbind":
				resp = doJSON("POST", "/portal/devices/"+mac+"/unbind", nil, customerCookie(owner))
			case "admin-unassign":
				resp = doJSON("POST", "/admin/nodes/"+mac+"/unassign", nil, adminCookie())
			case "admin-transfer":
				resp = doJSON("POST", "/admin/nodes/"+mac+"/assign", AssignDeviceRequest{CustomerID: other}, adminCookie())
			case "claim":
				// An old unclaimed row can still carry an administrator's binding.
				mustExec(t, "UPDATE nodes SET owner_customer_id = NULL WHERE mac = ?", mac)
				resp = doJSON("POST", "/portal/devices/claim", PortalClaimRequest{Code: "ABCD-EFGH"}, customerCookie(other))
			}
			assertStatus(t, resp, http.StatusOK)
			resp.Body.Close()
			if got := scalar(t, "SELECT COALESCE(bound_subscription_id, 0) FROM nodes WHERE mac = ?", mac); got != 0 {
				t.Fatalf("ownership change retained subscription %d", got)
			}
			if got := scalar(t, "SELECT owner_exit_enabled FROM nodes WHERE mac = ?", mac); got != 1 {
				t.Fatalf("new owner inherited disabled exit preference: %d", got)
			}
			assertGatewayAccess(t, mac, credential, "blocked")
			if action == "portal-unbind" || action == "admin-unassign" {
				resp = doJSON("POST", "/portal/devices/claim", PortalClaimRequest{Code: "ABCD-EFGH"}, customerCookie(other))
				assertStatus(t, resp, http.StatusOK)
				resp.Body.Close()
				assertGatewayAccess(t, mac, credential, "blocked")
			}
		})
	}
}

func TestGatewaySameOwnerAssignmentPreservesSubscription(t *testing.T) {
	mac, owner, sid, credential := boundGatewayFixture(t)
	for range 2 {
		resp := doJSON("POST", "/admin/nodes/"+mac+"/assign", AssignDeviceRequest{CustomerID: owner}, adminCookie())
		assertStatus(t, resp, http.StatusOK)
		resp.Body.Close()
	}
	if got := scalar(t, "SELECT bound_subscription_id FROM nodes WHERE mac = ?", mac); got != int64(sid) {
		t.Fatalf("same-owner assignment cleared subscription: %d", got)
	}
	if got := scalar(t, "SELECT owner_exit_enabled FROM nodes WHERE mac = ?", mac); got != 0 {
		t.Fatalf("same-owner assignment reset exit preference: %d", got)
	}
	assertGatewayAccess(t, mac, credential, "active")
}

func TestGatewayRejectsForeignOwnerSubscription(t *testing.T) {
	mac, _, _, credential := boundGatewayFixture(t)
	other := insertTestCustomer(t, "foreign-owner@example.com")
	mustExec(t, "UPDATE nodes SET owner_customer_id = ? WHERE mac = ?", other, mac)
	assertGatewayAccess(t, mac, credential, "blocked")
	// Operator-controlled, unowned gateways may still use an admin-bound subscription.
	mustExec(t, "UPDATE nodes SET owner_customer_id = NULL WHERE mac = ?", mac)
	assertGatewayAccess(t, mac, credential, "active")
}

func TestGatewaySelfOnlyUpstreamFailsClosed(t *testing.T) {
	mac, _, _, credential := boundGatewayFixture(t)
	mustExec(t, "UPDATE nodes SET owner_exit_enabled = 1 WHERE mac = ?", mac)
	mustExec(t, "INSERT INTO line_nodes (line_id, node_mac) SELECT id, ? FROM `lines`", mac)
	mustExec(t, "DELETE FROM line_nodes WHERE node_mac <> ?", mac)
	for _, direction := range []string{"domestic", "overseas", "global", "direct"} {
		t.Run(direction, func(t *testing.T) {
			mustExec(t, "UPDATE nodes SET gateway_direction = ? WHERE mac = ?", direction, mac)
			assertGatewayAccess(t, mac, credential, "blocked")
		})
	}
	mustExec(t, "INSERT INTO line_nodes (line_id, node_mac) SELECT id, 'aabbccddeeff' FROM `lines`")
	mustExec(t, "UPDATE nodes SET gateway_direction = 'global' WHERE mac = ?", mac)
	assertGatewayAccess(t, mac, credential, "active")
}

func TestGatewayUpstreamFollowsNodeDirection(t *testing.T) {
	mac, _, _, credential := boundGatewayFixture(t)
	// Fixture: overseas gateway (global) + one domestic plan node → active.
	resp := doBearer("GET", "/nodes/"+mac+"/clash-config", nil, credential)
	assertStatus(t, resp, http.StatusOK)
	if got := resp.Header.Get("X-Hive-Access"); got != "active" {
		t.Fatalf("gateway access = %q, want active", got)
	}
	if body := readBody(resp); !strings.Contains(body, "test.example.com") {
		t.Fatalf("overseas gateway must dial the domestic node, got: %s", body)
	}

	// The only plan node turns overseas → a global overseas gateway has no
	// domestic entry left and must fail closed instead of looping abroad.
	mustExec(t, "UPDATE nodes SET exit_direction = 'overseas' WHERE mac = 'aabbccddeeff'")
	assertGatewayAccess(t, mac, credential, "blocked")

	// A domestic gateway proxies non-CN traffic, so the overseas node is now
	// exactly the right upstream.
	mustExec(t, "UPDATE nodes SET gateway_direction = 'domestic' WHERE mac = ?", mac)
	assertGatewayAccess(t, mac, credential, "active")
	resp = doBearer("GET", "/nodes/"+mac+"/clash-config", nil, credential)
	assertStatus(t, resp, http.StatusOK)
	if body := readBody(resp); !strings.Contains(body, "test.example.com") {
		t.Fatalf("domestic gateway must dial the overseas node, got: %s", body)
	}

	// Flipping the node back to domestic starves the domestic gateway.
	mustExec(t, "UPDATE nodes SET exit_direction = 'domestic' WHERE mac = 'aabbccddeeff'")
	assertGatewayAccess(t, mac, credential, "blocked")
}

func TestGatewayRendererRejectsEmptyEffectiveUpstream(t *testing.T) {
	for _, nodes := range [][]model.Node{
		nil,
		{{MAC: "112233445566", CFURL: "https://self.invalid"}},
		{{MAC: "aabbccddeeff", CFURL: ""}},
	} {
		body := buildGatewayClashYAML(gatewayClashArgs{
			SelfMAC:      "112233445566",
			Direction:    "global",
			OverrideUUID: "11111111-2222-4333-8444-555555555555",
			AllNodes:     nodes,
		})
		if !strings.Contains(body, "MATCH,REJECT") || strings.Contains(body, "MATCH,直连") {
			t.Fatalf("empty effective upstream failed open: %s", body)
		}
	}
}
