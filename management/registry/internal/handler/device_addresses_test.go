package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"hive/registry/internal/model"
)

func addressSample() model.DeviceAddressSnapshot {
	stamp := "2020-01-01T00:00:00Z"
	return model.DeviceAddressSnapshot{LAN: []model.LANAddress{
		{Interface: "eth0", Address: "192.168.1.2", PrefixLength: 24},
		{Interface: "wlan0", Address: "2001:db8::2", PrefixLength: 64},
	}, Egress: model.DeviceEgress{IPv4: "1.1.1.1", IPv6: "2606:4700:4700::1111", SampledAt: &stamp}}
}

func TestNormalizeDeviceAddresses(t *testing.T) {
	got, ok := normalizeDeviceAddresses(addressSample())
	if !ok || len(got.LAN) != 2 || got.Egress.IPv6 == "" {
		t.Fatalf("valid dual stack rejected: %+v", got)
	}
	for _, role := range []string{"", "wan", "lan"} {
		sample := addressSample()
		sample.LAN[0].Role = role
		if normalized, valid := normalizeDeviceAddresses(sample); !valid || normalized.LAN[0].Role != role {
			t.Fatalf("role %q rejected: %+v", role, normalized)
		}
	}
	for _, mutate := range []func(*model.DeviceAddressSnapshot){
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Interface = "../../eth0" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Interface = strings.Repeat("x", 16) },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Role = "uplink" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Address = "example.com" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Address = "127.0.0.1" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Address = "169.254.1.1" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].Address = "198.18.0.1" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[1].Address = "fe80::1%eth0" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[1].Address = "::ffff:192.168.1.1" },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].PrefixLength = 33 },
		func(s *model.DeviceAddressSnapshot) { s.LAN[1].PrefixLength = 129 },
		func(s *model.DeviceAddressSnapshot) { s.LAN[0].PrefixLength = -1 },
		func(s *model.DeviceAddressSnapshot) { s.LAN = append(s.LAN, s.LAN[0]) },
		func(s *model.DeviceAddressSnapshot) { s.LAN = make([]model.LANAddress, 33) },
		func(s *model.DeviceAddressSnapshot) { s.Egress.IPv4 = "192.168.1.1" },
		func(s *model.DeviceAddressSnapshot) { s.Egress.IPv4 = "2606:4700::1" },
		func(s *model.DeviceAddressSnapshot) { s.Egress.IPv6 = "fe80::1" },
		func(s *model.DeviceAddressSnapshot) { s.Egress.IPv6 = "1.1.1.1" },
		func(s *model.DeviceAddressSnapshot) { s.Egress.IPv6 = "fd00::1" },
		func(s *model.DeviceAddressSnapshot) { s.Egress.SampledAt = nil },
		func(s *model.DeviceAddressSnapshot) {
			stamp := "invalid"
			s.Egress.SampledAt = &stamp
		},
		func(s *model.DeviceAddressSnapshot) {
			stamp := time.Now().Add(time.Hour).Format(time.RFC3339)
			s.Egress.SampledAt = &stamp
		},
		func(s *model.DeviceAddressSnapshot) {
			stamp := time.Now().Add(time.Minute).Format(time.RFC3339)
			s.Egress.SampledAt = &stamp
		},
	} {
		sample := addressSample()
		mutate(&sample)
		if _, ok := normalizeDeviceAddresses(sample); ok {
			t.Fatalf("invalid sample accepted: %+v", sample)
		}
	}
	if empty, ok := normalizeDeviceAddresses(model.DeviceAddressSnapshot{}); !ok || empty.LAN == nil {
		t.Fatalf("unknown sample: %+v %v", empty, ok)
	}
}

func TestDeviceAddressesOwnershipAndSnapshot(t *testing.T) {
	resetDB(t)
	originalFRPHost := testCfg.FRPServerAddr
	testCfg.FRPServerAddr = "frp.example.com"
	t.Cleanup(func() { testCfg.FRPServerAddr = originalFRPHost })
	cid := insertTestCustomer(t, "addresses-owner@example.com")
	other := insertTestCustomer(t, "addresses-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	mustExec(t, "UPDATE nodes SET tailscale_ip = ?, easytier_ip = ?, mesh_ip = ?, cf_url = ?, frp_port = ? WHERE mac = ?", "100.64.1.2", "172.20.1.2", "pending", "https://node.example.com", 22222, mac)
	path := "/portal/devices/" + mac + "/addresses"
	get := func() model.DeviceAddressesResponse {
		t.Helper()
		resp := doJSON("GET", path, nil, customerCookie(cid))
		assertStatus(t, resp, http.StatusOK)
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{"xray_uuid", "token", "claim_code", "tunnel_id", "address_snapshot"} {
			if strings.Contains(string(body), secret) {
				t.Fatalf("secret field leaked: %s", body)
			}
		}
		var result model.DeviceAddressesResponse
		if err := json.Unmarshal(body, &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	initial := get()
	if initial.SampledAt != nil || initial.LAN == nil || len(initial.LAN) != 0 || initial.Egress.SampledAt != nil || initial.MeshIP != "" || initial.FRP.Port != 22222 || initial.TailscaleIP != "100.64.1.2" {
		t.Fatalf("initial snapshot: %+v", initial)
	}
	if initial.FRP.Host != "frp.example.com" {
		t.Fatalf("FRP host did not come from registry config: %+v", initial.FRP)
	}
	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "addresses": addressSample()}, deviceToken(t, mac))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	result := get()
	if result.SampledAt == nil || len(result.LAN) != 2 || result.Egress.SampledAt == nil || *result.Egress.SampledAt != "2020-01-01T00:00:00Z" {
		t.Fatalf("missing snapshot: %+v", result)
	}
	if _, err := time.Parse(time.RFC3339, *result.SampledAt); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range []*http.Cookie{nil, customerCookie(other)} {
		resp := doJSON("GET", path, nil, cookie)
		want := http.StatusNotFound
		if cookie == nil {
			want = http.StatusUnauthorized
		}
		assertStatus(t, resp, want)
		resp.Body.Close()
	}
	mustExec(t, "UPDATE nodes SET owner_customer_id = NULL WHERE mac = ?", mac)
	resp = doJSON("GET", path, nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusNotFound)
	resp.Body.Close()
}

func TestHeartbeatAddressesValidationAndPreservation(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "addresses-preserve@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)
	beat := func(body map[string]any, status int) {
		t.Helper()
		resp := doBearer("POST", "/nodes/heartbeat", body, deviceToken(t, mac))
		assertStatus(t, resp, status)
		resp.Body.Close()
	}
	beat(map[string]any{"mac": mac, "addresses": addressSample()}, http.StatusOK)
	oldTime := "2020-02-01T00:00:00Z"
	mustExec(t, "UPDATE nodes SET addresses_sampled_at = ? WHERE mac = ?", oldTime, mac)
	beat(map[string]any{"mac": mac}, http.StatusOK)
	invalid := addressSample()
	invalid.LAN[0].Address = "not-an-ip"
	beat(map[string]any{"mac": mac, "addresses": invalid}, http.StatusBadRequest)
	var node model.Node
	if err := testDB.Where("mac = ?", mac).Take(&node).Error; err != nil {
		t.Fatal(err)
	}
	if node.AddressesSampledAt == nil || *node.AddressesSampledAt != oldTime || node.AddressSnapshot == nil {
		t.Fatalf("old/invalid heartbeat changed sample: %+v", node)
	}
	encoded, err := json.Marshal(node)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "address_snapshot") || strings.Contains(string(encoded), "addresses_sampled_at") {
		t.Fatal("private fields exposed on Node")
	}
	resp := doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac, "addresses": addressSample()}, "wrong-token")
	assertStatus(t, resp, http.StatusUnauthorized)
	resp.Body.Close()
}
