package handler

import (
	"net/http"
	"testing"
	"time"
)

func portalGatewayNode(t *testing.T, mac string, customerID uint) {
	t.Helper()
	insertTestNode(t, mac)
	mustExec(t, "UPDATE nodes SET owner_customer_id = ?, gateway_enabled = 1 WHERE mac = ?", customerID, mac)
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
