package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func portalGatewayNode(t *testing.T, mac string, customerID uint) {
	t.Helper()
	insertTestNode(t, mac)
	mustExec(t, "UPDATE nodes SET owner_customer_id = ?, gateway_enabled = 1 WHERE mac = ?", customerID, mac)
}

func TestPortalDeviceEndpointsExposeOnlyCustomerFields(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "portal-view@example.com")
	other := insertTestCustomer(t, "portal-view-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	mustExec(t, `UPDATE nodes SET tunnel_id = ?, easytier_ip = ?, tailscale_ip = ?, mesh_ip = ?, mesh_tunnel_id = ?,
		frp_port = ?, location = ?, note = ?, region = ?, weight = ?, subscription_sync = 1, country = ?, country_override = ?
		WHERE mac = ?`,
		"tunnel-secret-id", "172.20.1.2", "100.64.1.2", "172.20.1.3", "mesh-secret-id",
		22222, "Hong Kong", "operator note", "hk", 7, "HK", "US", mac)

	forbidden := []string{
		"tailscale_ip", "easytier_ip", "mesh_ip", "mesh_tunnel_id", "frp_port",
		"tunnel_id", "xray_uuid", "server_enabled", "subscription_sync",
		"location", "note", "region", "weight", "owner_customer_id", "cf_url",
		"address_snapshot", "addresses_sampled_at", "claim_code",
		"100.64.1.2", "172.20.1.2", "172.20.1.3", "tunnel-secret-id", "mesh-secret-id",
		"operator note",
	}
	assertNoLeak := func(label, body string) {
		t.Helper()
		for _, key := range forbidden {
			if strings.Contains(body, key) {
				t.Fatalf("%s leaked %q: %s", label, key, body)
			}
		}
	}

	list := readBody(doJSON("GET", "/portal/devices", nil, customerCookie(cid)))
	assertNoLeak("portal list", list)
	var devices []PortalDevice
	if err := json.Unmarshal([]byte(list), &devices); err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].MAC != mac || devices[0].MAC6 != "ddeeff" || devices[0].Hostname == "" ||
		devices[0].ProbeStatus == "" || !devices[0].GatewayEnabled || devices[0].Country != "HK" || devices[0].CountryOverride != "US" {
		t.Fatalf("portal list view = %+v", devices)
	}

	single := readBody(doJSON("GET", "/portal/devices/"+mac, nil, customerCookie(cid)))
	assertNoLeak("portal get", single)
	var device PortalDevice
	if err := json.Unmarshal([]byte(single), &device); err != nil {
		t.Fatal(err)
	}
	if device.MAC != mac || device.CountryOverride != "US" || len(device.GatewayUpstreamNodes) != 0 {
		t.Fatalf("portal get view = %+v", device)
	}

	resp := doJSON("GET", "/portal/devices/"+mac, nil, customerCookie(other))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}

func TestPortalSetDeviceExit(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "gateway-exit@example.com")
	other := insertTestCustomer(t, "gateway-exit-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/exit", map[string]any{"enabled": false}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if got := scalar(t, "SELECT owner_exit_enabled FROM nodes WHERE mac = ?", mac); got != 0 {
		t.Fatalf("owner_exit_enabled = %d after disable, want 0", got)
	}

	resp = doJSON("PUT", "/portal/devices/"+mac+"/exit", map[string]any{"enabled": true}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if got := scalar(t, "SELECT owner_exit_enabled FROM nodes WHERE mac = ?", mac); got != 1 {
		t.Fatalf("owner_exit_enabled = %d after enable, want 1", got)
	}

	// Foreign customer cannot toggle it.
	resp = doJSON("PUT", "/portal/devices/"+mac+"/exit", map[string]any{"enabled": false}, customerCookie(other))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
	if got := scalar(t, "SELECT owner_exit_enabled FROM nodes WHERE mac = ?", mac); got != 1 {
		t.Fatalf("foreign customer changed owner_exit_enabled to %d", got)
	}

	// Unbinding clears the owner preference so the next owner starts from the default.
	mustExec(t, "UPDATE nodes SET owner_exit_enabled = 0 WHERE mac = ?", mac)
	resp = doJSON("POST", "/portal/devices/"+mac+"/unbind", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if got := scalar(t, "SELECT owner_exit_enabled FROM nodes WHERE mac = ?", mac); got != 1 {
		t.Fatalf("owner_exit_enabled = %d after unbind, want 1", got)
	}
}

func TestPortalBindDeviceSubscription(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "gateway-bind@example.com")
	pid := insertTestPlan(t, "gateway-bind")
	sid := insertTestSubscription(t, cid, pid, "active", time.Now().Add(24*time.Hour))
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/subscription", map[string]any{"subscription_id": sid}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	if got := scalar(t, "SELECT COALESCE(bound_subscription_id,0) FROM nodes WHERE mac = ?", mac); got != int64(sid) {
		t.Fatalf("bound_subscription_id = %d, want %d", got, sid)
	}

	// Re-binding the same subscription is idempotent; MySQL reports zero rows
	// affected when the value is unchanged, so that must not become a 409.
	resp = doJSON("PUT", "/portal/devices/"+mac+"/subscription", map[string]any{"subscription_id": sid}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	resp = doJSON("DELETE", "/portal/devices/"+mac+"/subscription", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	if got := scalar(t, "SELECT COALESCE(bound_subscription_id,0) FROM nodes WHERE mac = ?", mac); got != 0 {
		t.Fatalf("bound_subscription_id = %d after unbind, want 0", got)
	}
}

func TestPortalBindDeviceSubscriptionRejectsForeignSubscription(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "gateway-owner@example.com")
	other := insertTestCustomer(t, "gateway-other@example.com")
	pid := insertTestPlan(t, "gateway-foreign")
	otherSub := insertTestSubscription(t, other, pid, "active", time.Now().Add(24*time.Hour))
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, owner)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/subscription", map[string]any{"subscription_id": otherSub}, customerCookie(owner))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()

	if got := scalar(t, "SELECT COALESCE(bound_subscription_id,0) FROM nodes WHERE mac = ?", mac); got != 0 {
		t.Fatalf("foreign subscription was bound: %d", got)
	}
}

func TestPortalBindDeviceSubscriptionRejectsForeignDevice(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "gateway-device-owner@example.com")
	other := insertTestCustomer(t, "gateway-device-other@example.com")
	pid := insertTestPlan(t, "gateway-device")
	sid := insertTestSubscription(t, other, pid, "active", time.Now().Add(24*time.Hour))
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, owner)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/subscription", map[string]any{"subscription_id": sid}, customerCookie(other))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}

func TestPortalBindDeviceSubscriptionRejectsNonGateway(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "gateway-disabled@example.com")
	pid := insertTestPlan(t, "gateway-disabled")
	sid := insertTestSubscription(t, cid, pid, "active", time.Now().Add(24*time.Hour))
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	mustExec(t, "UPDATE nodes SET owner_customer_id = ?, gateway_enabled = 0 WHERE mac = ?", cid, mac)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/subscription", map[string]any{"subscription_id": sid}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
}

func TestPortalBindDeviceSubscriptionRejectsInvalidSubscription(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "gateway-expired@example.com")
	pid := insertTestPlan(t, "gateway-expired")
	expired := insertTestSubscription(t, cid, pid, "active", time.Now().Add(-time.Hour))
	suspended := insertTestSubscription(t, cid, pid, "suspended", time.Now().Add(24*time.Hour))
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)

	for _, sid := range []uint{expired, suspended} {
		resp := doJSON("PUT", "/portal/devices/"+mac+"/subscription", map[string]any{"subscription_id": sid}, customerCookie(cid))
		assertStatus(t, resp, http.StatusConflict)
		resp.Body.Close()
	}
	if got := scalar(t, "SELECT COALESCE(bound_subscription_id,0) FROM nodes WHERE mac = ?", mac); got != 0 {
		t.Fatalf("invalid subscription was bound: %d", got)
	}
}
