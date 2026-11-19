package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"hive/registry/internal/model"
)

func TestNormalizeServiceStates(t *testing.T) {
	states, ok := normalizeServiceStates([]model.ServiceStatus{{Name: "xray", ActiveState: "inactive", SubState: "dead", LoadState: "not-found"}})
	if !ok || len(states) != len(serviceControlServices) {
		t.Fatalf("invalid normalized sample: %v %v", states, ok)
	}
	for _, state := range states {
		want := "unknown"
		if state.Name == "xray" {
			want = "not-found"
		}
		if state.ActiveState != want || state.SubState != want || state.LoadState != want {
			t.Fatalf("unexpected state: %+v", state)
		}
	}
	valid := model.ServiceStatus{Name: "xray", ActiveState: "active", SubState: "running", LoadState: "loaded"}
	for _, invalid := range [][]model.ServiceStatus{
		{valid, valid},
		{{Name: "arbitrary.service", ActiveState: "active", SubState: "running", LoadState: "loaded"}},
		{{Name: "xray", ActiveState: "active\n", SubState: "running", LoadState: "loaded"}},
		{{Name: "xray", ActiveState: "active", SubState: "", LoadState: "loaded"}},
	} {
		if _, ok := normalizeServiceStates(invalid); ok {
			t.Fatalf("accepted invalid states: %+v", invalid)
		}
	}
}

func TestPortalDeviceServicesHeartbeat(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "service-owner@example.com")
	other := insertTestCustomer(t, "service-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	path := "/portal/devices/" + mac + "/services"
	get := func() model.DeviceServicesResponse {
		t.Helper()
		resp := doJSON("GET", path, nil, customerCookie(cid))
		assertStatus(t, resp, http.StatusOK)
		defer resp.Body.Close()
		var result model.DeviceServicesResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	initial := get()
	if initial.SampledAt != nil || len(initial.Services) != len(serviceControlServices) {
		t.Fatalf("legacy node invented a sample: %+v", initial)
	}
	for _, state := range initial.Services {
		if state.ActiveState != "unknown" || state.SubState != "unknown" || state.LoadState != "unknown" {
			t.Fatalf("legacy node invented health: %+v", state)
		}
	}
	sample := []model.ServiceStatus{
		{Name: "xray", ActiveState: "active", SubState: "running", LoadState: "loaded"},
		{Name: "frpc", ActiveState: "failed", SubState: "failed", LoadState: "loaded"},
		{Name: "warp-svc", ActiveState: "inactive", SubState: "dead", LoadState: "not-found"},
	}
	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "services": sample}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	result := get()
	if result.SampledAt == nil {
		t.Fatal("missing sample time")
	}
	if _, err := time.Parse(time.RFC3339, *result.SampledAt); err != nil {
		t.Fatal(err)
	}
	for _, state := range result.Services {
		switch state.Name {
		case "xray":
			if state.ActiveState != "active" || state.SubState != "running" {
				t.Fatalf("xray: %+v", state)
			}
		case "frpc":
			if state.ActiveState != "failed" {
				t.Fatalf("frpc: %+v", state)
			}
		case "warp-svc":
			if state.ActiveState != "not-found" {
				t.Fatalf("warp: %+v", state)
			}
		}
	}
	// No snapshot in a legacy heartbeat must preserve, not refresh, the old sample.
	oldTime := "2020-01-01T00:00:00Z"
	mustExec(t, "UPDATE nodes SET services_sampled_at = ? WHERE mac = ?", oldTime, mac)
	resp = doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	if got := get(); got.SampledAt == nil || *got.SampledAt != oldTime {
		t.Fatalf("legacy heartbeat refreshed sample: %+v", got)
	}
	for _, cookie := range []*http.Cookie{nil, customerCookie(other)} {
		resp = doJSON("GET", path, nil, cookie)
		want := http.StatusNotFound
		if cookie == nil {
			want = http.StatusUnauthorized
		}
		assertStatus(t, resp, want)
		resp.Body.Close()
	}
	resp = doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "services": []model.ServiceStatus{{Name: "sshd"}}}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	if got := get(); got.SampledAt == nil || *got.SampledAt != oldTime {
		t.Fatalf("invalid heartbeat changed snapshot: %+v", got)
	}
	resp = doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "services": sample}, "wrong-token")
	assertStatus(t, resp, http.StatusUnauthorized)
	resp.Body.Close()
	mustExec(t, "UPDATE nodes SET owner_customer_id = NULL WHERE mac = ?", mac)
	resp = doJSON("GET", path, nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}
