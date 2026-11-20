package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"hive/registry/internal/model"
)

func TestDashboardEndpointsDualStackNetworks(t *testing.T) {
	for _, test := range []struct {
		name string
		ip   string
		url  string
	}{
		{"ipv4", "172.20.1.2", "http://172.20.1.2:9090/ui/"},
		{"ipv6", "fd00::2", "http://[fd00::2]:9090/ui/"},
	} {
		t.Run(test.name, func(t *testing.T) {
			n := model.Node{EasytierIP: test.ip, TailscaleIP: test.ip, MeshIP: test.ip}
			sample := model.DeviceAddressSnapshot{LAN: []model.LANAddress{
				{Interface: "wan", Address: "192.168.1.2", Role: "wan"},
				{Interface: "wan", Address: "2001:db8::2", Role: "wan"},
				{Interface: "lan", Address: "10.42.2.1", Role: "lan"},
				{Interface: "wlan0", Address: "10.42.1.1", Role: "lan"},
				{Interface: "wlan1", Address: "10.42.0.1", Role: "lan"},
				{Interface: "duplicate", Address: "192.168.1.2", Role: "wan"},
			}, Egress: model.DeviceEgress{IPv4: "1.1.1.1", IPv6: "2606:4700:4700::1111"}}
			got := dashboardEndpoints(n, &sample)
			want := []DashboardEndpoint{
				{Network: "easytier", Address: test.ip, URL: test.url},
				{Network: "tailscale", Address: test.ip, URL: test.url},
				{Network: "mesh", Address: test.ip, URL: test.url},
				{Network: "wan", Interface: "wan", Address: "192.168.1.2", URL: "http://192.168.1.2:9090/ui/"},
				{Network: "wan", Interface: "wan", Address: "2001:db8::2", URL: "http://[2001:db8::2]:9090/ui/"},
				{Network: "lan", Interface: "lan", Address: "10.42.2.1", URL: "http://10.42.2.1:9090/ui/"},
				{Network: "hotspot5g", Interface: "wlan0", Address: "10.42.1.1", URL: "http://10.42.1.1:9090/ui/"},
				{Network: "hotspot2g", Interface: "wlan1", Address: "10.42.0.1", URL: "http://10.42.0.1:9090/ui/"},
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("endpoints = %+v, want %+v", got, want)
			}
		})
	}
}

func TestDashboardEndpointsLegacyAndObservedEmpty(t *testing.T) {
	legacy := dashboardEndpoints(model.Node{}, nil)
	want := []DashboardEndpoint{
		{Network: "lan-fallback", Address: "10.42.2.1", URL: "http://10.42.2.1:9090/ui/"},
		{Network: "hotspot5g-fallback", Address: "10.42.1.1", URL: "http://10.42.1.1:9090/ui/"},
		{Network: "hotspot2g-fallback", Address: "10.42.0.1", URL: "http://10.42.0.1:9090/ui/"},
	}
	if !reflect.DeepEqual(legacy, want) {
		t.Fatalf("legacy fallback = %+v", legacy)
	}
	sample := model.DeviceAddressSnapshot{LAN: []model.LANAddress{{Interface: "wan", Address: "192.168.1.2"}}}
	observed := dashboardEndpoints(model.Node{}, &sample)
	if len(observed) != 1 || observed[0].Network != "physical" {
		t.Fatalf("missing role guessed WAN or fabricated AP: %+v", observed)
	}
	empty := dashboardEndpoints(model.Node{}, &model.DeviceAddressSnapshot{})
	if empty == nil || len(empty) != 0 {
		t.Fatalf("known empty sample fabricated addresses: %+v", empty)
	}
}

func TestDashboardEndpointsRejectInvalidOverlayAddresses(t *testing.T) {
	for _, invalid := range []string{"pending", "PENDING", "example.com", "http://172.20.1.2", "127.0.0.1", "::1", "fe80::1", "fe80::1%eth0", "::ffff:192.168.1.2", "198.18.1.1", "0.0.0.0", "224.0.0.1"} {
		n := model.Node{EasytierIP: invalid, TailscaleIP: invalid, MeshIP: invalid}
		if got := dashboardEndpoints(n, &model.DeviceAddressSnapshot{}); len(got) != 0 {
			t.Fatalf("invalid %q became endpoint: %+v", invalid, got)
		}
	}
}

func TestPortalDeviceDashboardLegacyAndEmptySnapshot(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "dashboard-legacy-owner@example.com")
	mac := "aabbcc334455"
	portalGatewayNode(t, mac, owner)
	path := "/portal/devices/" + mac + "/dashboard"
	resp := doJSON("GET", path, nil, customerCookie(owner))
	assertStatus(t, resp, http.StatusOK)
	var legacy DashboardResponse
	decodeBody(t, resp, &legacy)
	if legacy.SampledAt != nil || legacy.Egress.SampledAt != nil || !reflect.DeepEqual(legacy.Endpoints, dashboardEndpoints(model.Node{}, nil)) {
		t.Fatalf("legacy dashboard = %+v", legacy)
	}
	resp = doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "addresses": model.DeviceAddressSnapshot{}}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	resp = doJSON("GET", path, nil, customerCookie(owner))
	assertStatus(t, resp, http.StatusOK)
	var empty DashboardResponse
	decodeBody(t, resp, &empty)
	if empty.SampledAt == nil || empty.Endpoints == nil || len(empty.Endpoints) != 0 {
		t.Fatalf("known empty dashboard = %+v", empty)
	}
}

func TestPortalDeviceDashboardOwnedSnapshot(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "dashboard-snapshot-owner@example.com")
	other := insertTestCustomer(t, "dashboard-snapshot-other@example.com")
	mac := "aabbcc112233"
	portalGatewayNode(t, mac, owner)
	mustExec(t, "UPDATE nodes SET easytier_ip = ?, tailscale_ip = ?, mesh_ip = ? WHERE mac = ?", "172.20.1.2", "fd00::2", "100.64.1.2", mac)
	sample := addressSample()
	sample.LAN[0].Role = "wan"
	sample.LAN[1].Role = "lan"
	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "addresses": sample}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	path := "/portal/devices/" + mac + "/dashboard"
	resp = doJSON("GET", path, nil, customerCookie(owner))
	assertStatus(t, resp, http.StatusOK)
	data, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	var result DashboardResponse
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.MAC != mac || result.Secret != testH.gatewaySecret(mac) || result.SampledAt == nil || !reflect.DeepEqual(result.Egress, sample.Egress) || len(result.Endpoints) != 5 {
		t.Fatalf("dashboard snapshot = %+v", result)
	}
	if strings.Contains(string(data), "\"urls\"") || strings.Contains(string(data), "1.1.1.1:9090") || strings.Contains(string(data), "4700::1111]:9090") || strings.Contains(string(data), "10.42.") {
		t.Fatalf("obsolete/public/fabricated endpoint in %s", data)
	}
	for _, cookie := range []*http.Cookie{nil, customerCookie(other)} {
		resp = doJSON("GET", path, nil, cookie)
		if cookie == nil {
			assertStatus(t, resp, http.StatusUnauthorized)
		} else {
			assertStatus(t, resp, http.StatusNotFound)
		}
		denied, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if strings.Contains(string(denied), result.Secret) || strings.Contains(string(denied), "endpoints") {
			t.Fatalf("dashboard secret leaked: %s", denied)
		}
	}
	mustExec(t, "UPDATE nodes SET gateway_enabled = false WHERE mac = ?", mac)
	resp = doJSON("GET", path, nil, customerCookie(owner))
	assertStatus(t, resp, http.StatusNotFound)
	denied, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if strings.Contains(string(denied), result.Secret) {
		t.Fatalf("non-gateway secret leaked: %s", denied)
	}
}

func TestPortalDeviceDashboardCorruptSnapshot(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "dashboard-corrupt-owner@example.com")
	mac := "aabbcc223344"
	portalGatewayNode(t, mac, owner)
	stamp := "2020-01-01T00:00:00Z"
	for _, test := range []struct {
		name     string
		snapshot any
		stamp    any
	}{
		{"wrong-shape", "[]", stamp},
		{"null", "null", stamp},
		{"invalid-role", `{"lan":[{"interface":"eth0","address":"192.168.1.2","prefix_length":24,"role":"bad"}]}`, stamp},
		{"missing-snapshot", nil, stamp},
		{"missing-time", `{"lan":[]}`, nil},
		{"invalid-time", `{"lan":[]}`, "invalid"},
	} {
		t.Run(test.name, func(t *testing.T) {
			mustExec(t, "UPDATE nodes SET address_snapshot = ?, addresses_sampled_at = ? WHERE mac = ?", test.snapshot, test.stamp, mac)
			resp := doJSON("GET", "/portal/devices/"+mac+"/dashboard", nil, customerCookie(owner))
			assertStatus(t, resp, http.StatusInternalServerError)
			data, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if strings.Contains(string(data), testH.gatewaySecret(mac)) || strings.Contains(string(data), "endpoints") {
				t.Fatalf("corrupt snapshot leaked secret or fallback: %s", data)
			}
		})
	}
}
