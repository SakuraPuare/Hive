package handler

import (
	"net/http"
	"strings"
	"testing"
)

func TestResolveGatewayDirectionAuto(t *testing.T) {
	cases := []struct {
		raw, country, want string
	}{
		{"auto", "CN", "domestic"},
		{"auto", "cn", "domestic"},
		{"auto", "US", "overseas"},
		{"auto", "HK", "overseas"},
		{"auto", "", "domestic"},     // unknown country must not route CN traffic abroad
		{" Auto ", "US", "overseas"}, // stored value is canonicalised
		{"overseas", "CN", "overseas"},
		{"domestic", "US", "domestic"},
		{"", "US", "domestic"},
		{"bogus", "US", "domestic"},
	}
	for _, c := range cases {
		if got := resolveGatewayDirection(c.raw, c.country); got != c.want {
			t.Errorf("resolveGatewayDirection(%q,%q) = %q, want %q", c.raw, c.country, got, c.want)
		}
	}
}

func TestHeartbeatRecordsCountry(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	cred := deviceToken(t, mac)
	beat := func(country string) {
		body := map[string]any{"mac": mac, "cpu_pct": 1.0, "mem_pct": 2.0, "disk_pct": 3.0, "uptime_sec": 4}
		if country != "" {
			body["country"] = country
		}
		resp := doBearer("POST", "/nodes/heartbeat", body, cred)
		assertStatus(t, resp, http.StatusOK)
		resp.Body.Close()
	}
	beat("us")
	var got string
	testDB.Raw("SELECT country FROM nodes WHERE mac = ?", mac).Scan(&got)
	if got != "US" {
		t.Fatalf("country = %q after heartbeat, want US", got)
	}
	// Legacy agents omit the field; an empty or malformed value must not wipe it.
	beat("")
	beat("USA")
	testDB.Raw("SELECT country FROM nodes WHERE mac = ?", mac).Scan(&got)
	if got != "US" {
		t.Fatalf("country = %q after empty/malformed heartbeat, want US", got)
	}
}

func TestGatewayAutoDirectionFollowsCountry(t *testing.T) {
	mac, _, _, credential := boundGatewayFixture(t)
	// Country is reported by the heartbeat; force both sides and check the split.
	// The fixture's upstream node is a 回国 node, so an overseas (non-CN) gateway
	// uses it; a mainland gateway needs an 出海 node to have any upstream at all.
	for _, c := range []struct{ country, upstreamDir, cnRule, matchRule string }{
		{"US", "domestic", "- RULE-SET,cn_domain,代理", "- MATCH,直连"},
		{"CN", "overseas", "- RULE-SET,cn_domain,直连", "- MATCH,代理"},
	} {
		mustExec(t, "UPDATE nodes SET exit_direction = ? WHERE mac = 'aabbccddeeff'", c.upstreamDir)
		mustExec(t, "UPDATE nodes SET gateway_direction = 'auto', country = ? WHERE mac = ?", c.country, mac)
		resp := doBearer("GET", "/nodes/"+mac+"/clash-config", nil, credential)
		assertStatus(t, resp, http.StatusOK)
		body := readBody(resp)
		if !strings.Contains(body, c.cnRule) || !strings.Contains(body, c.matchRule) {
			t.Fatalf("country=%s: want %q and %q in config", c.country, c.cnRule, c.matchRule)
		}
	}
}

func TestPortalSetDeviceGateway(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "gateway-dir@example.com")
	other := insertTestCustomer(t, "gateway-dir-other@example.com")
	mac := "aabbccddeeff"
	portalGatewayNode(t, mac, cid)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "auto"}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var got string
	testDB.Raw("SELECT gateway_direction FROM nodes WHERE mac = ?", mac).Scan(&got)
	if got != "auto" {
		t.Fatalf("gateway_direction = %q, want auto", got)
	}

	resp = doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "bogus"}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()

	// Another customer cannot steer someone else's gateway.
	resp = doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "overseas"}, customerCookie(other))
	if resp.StatusCode == http.StatusOK {
		t.Fatalf("foreign customer changed gateway direction")
	}
	resp.Body.Close()

	// Non-gateway devices are rejected.
	mustExec(t, "UPDATE nodes SET gateway_enabled = 0 WHERE mac = ?", mac)
	resp = doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "domestic"}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
}

func TestPortalGatewayDirectionRequiresMatchingUpstream(t *testing.T) {
	mac, owner, _, _ := boundGatewayFixture(t)
	// The bound subscription's line contains a 回国 node, so only an overseas
	// split has an upstream; the domestic split would fail closed.
	resp := doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "domestic"}, customerCookie(owner))
	assertStatus(t, resp, http.StatusConflict)
	resp.Body.Close()
	resp = doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "overseas"}, customerCookie(owner))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()

	// auto follows the reported country: CN -> domestic (no upstream, rejected),
	// US -> overseas (upstream present).
	mustExec(t, "UPDATE nodes SET country = 'CN' WHERE mac = ?", mac)
	resp = doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "auto"}, customerCookie(owner))
	assertStatus(t, resp, http.StatusConflict)
	resp.Body.Close()
	mustExec(t, "UPDATE nodes SET country = 'US' WHERE mac = ?", mac)
	resp = doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "auto"}, customerCookie(owner))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
}

func TestPortalGatewayDirectWithoutUpstream(t *testing.T) {
	mac, owner, sid, _ := boundGatewayFixture(t)
	// Keep the subscription bound but remove its only eligible upstream.
	mustExec(t, "UPDATE nodes SET exit_enabled = 0 WHERE mac = 'aabbccddeeff'")
	mustExec(t, "UPDATE nodes SET country = 'CN' WHERE mac = ?", mac)

	resp := doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": "direct"}, customerCookie(owner))
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var got string
	testDB.Raw("SELECT gateway_direction FROM nodes WHERE mac = ?", mac).Scan(&got)
	if got != "direct" {
		t.Fatalf("gateway_direction = %q, want direct", got)
	}
	if got := scalar(t, "SELECT bound_subscription_id FROM nodes WHERE mac = ?", mac); got != int64(sid) {
		t.Fatalf("bound_subscription_id = %d, want %d", got, sid)
	}

	for _, direction := range []string{"auto", "domestic", "overseas", "global"} {
		t.Run(direction, func(t *testing.T) {
			resp := doJSON("PUT", "/portal/devices/"+mac+"/gateway", map[string]any{"gateway_direction": direction}, customerCookie(owner))
			assertStatus(t, resp, http.StatusConflict)
			resp.Body.Close()
			var got string
			testDB.Raw("SELECT gateway_direction FROM nodes WHERE mac = ?", mac).Scan(&got)
			if got != "direct" {
				t.Fatalf("rejected %s changed gateway_direction to %q", direction, got)
			}
		})
	}
}

func TestCountryOverrideBeatsReportedCountry(t *testing.T) {
	mac, _, _, credential := boundGatewayFixture(t)
	// Reported CN would pick the domestic split; the override must win.
	mustExec(t, "UPDATE nodes SET exit_direction = 'domestic' WHERE mac = 'aabbccddeeff'")
	mustExec(t, "UPDATE nodes SET gateway_direction = 'auto', country = 'CN', country_override = 'US' WHERE mac = ?", mac)
	resp := doBearer("GET", "/nodes/"+mac+"/clash-config", nil, credential)
	assertStatus(t, resp, http.StatusOK)
	body := readBody(resp)
	if !strings.Contains(body, "- RULE-SET,cn_domain,代理") || !strings.Contains(body, "- MATCH,直连") {
		t.Fatalf("override US did not produce the overseas split")
	}
	// Clearing the override falls back to the reported country (CN → domestic
	// split, which needs an 出海 upstream to be non-empty).
	mustExec(t, "UPDATE nodes SET country_override = '' WHERE mac = ?", mac)
	mustExec(t, "UPDATE nodes SET exit_direction = 'overseas' WHERE mac = 'aabbccddeeff'")
	resp = doBearer("GET", "/nodes/"+mac+"/clash-config", nil, credential)
	assertStatus(t, resp, http.StatusOK)
	body = readBody(resp)
	if !strings.Contains(body, "- RULE-SET,cn_domain,直连") || !strings.Contains(body, "- MATCH,代理") {
		t.Fatalf("cleared override did not fall back to the reported CN split: %s", body)
	}
}

func TestAdminSetsCountryOverride(t *testing.T) {
	resetDB(t)
	insertTestNode(t, "aabbccddeeff")
	resp := doJSON("PATCH", "/nodes/aabbccddeeff", map[string]any{"country_override": "jp"}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	var got string
	testDB.Raw("SELECT country_override FROM nodes WHERE mac = 'aabbccddeeff'").Scan(&got)
	if got != "JP" {
		t.Fatalf("country_override = %q, want JP", got)
	}
	resp = doJSON("PATCH", "/nodes/aabbccddeeff", map[string]any{"country_override": "nowhere"}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
	resp.Body.Close()
	resp = doJSON("PATCH", "/nodes/aabbccddeeff", map[string]any{"country_override": ""}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	resp.Body.Close()
	testDB.Raw("SELECT country_override FROM nodes WHERE mac = 'aabbccddeeff'").Scan(&got)
	if got != "" {
		t.Fatalf("country_override = %q after clearing, want empty", got)
	}
}
