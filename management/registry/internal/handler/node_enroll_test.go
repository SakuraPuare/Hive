package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"testing"

	"hive/registry/internal/model"
)

// 共享镜像里没有任何凭证：设备第一次上电只能凭 MAC 自助上线。这些测试钉住
// "面板立刻能看到设备"、"凭证真的能用"、以及"不能被顶号/重复领证"三条底线。

const claimCodeShape = `^[0-9A-Z]{4}-[0-9A-Z]{4}$`

func insertNodeRow(t *testing.T, mac, hostname, easytierIP, tailscaleIP string, owner *uint, gateway bool) {
	t.Helper()
	gatewayValue := 0
	if gateway {
		gatewayValue = 1
	}
	if err := testDB.Exec(
		`INSERT INTO nodes (mac, mac6, hostname, cf_url, xray_uuid, easytier_ip, tailscale_ip, gateway_enabled, server_enabled, owner_customer_id, registered_at, last_seen)
		 VALUES (?, ?, ?, '', '00000000-0000-4000-8000-000000000000', ?, ?, ?, 0, ?, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
		mac, mac[6:], hostname, easytierIP, tailscaleIP, gatewayValue, owner,
	).Error; err != nil {
		t.Fatalf("insert node %s: %v", mac, err)
	}
}

func TestNodeEnroll_FirstBootGetsCredentialAndClaimCode(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"

	resp := doJSON("POST", "/nodes/enroll", map[string]string{
		"mac": mac, "mac6": "cdeeff", "hostname": "hive-cdeeff",
	}, nil)
	assertStatus(t, resp, http.StatusOK)
	var body EnrollResponse
	decodeBody(t, resp, &body)
	if body.MAC != mac || body.Token == "" {
		t.Fatalf("unexpected enroll response: %+v", body)
	}
	if !regexp.MustCompile(claimCodeShape).MatchString(body.ClaimCode) {
		t.Fatalf("claim code shape = %q", body.ClaimCode)
	}

	// 管理面板靠这一行显示"哪台设备上线了"：必须有 registered_at/last_seen。
	var node model.Node
	testDB.Raw("SELECT mac, mac6, hostname, registered_at, last_seen FROM nodes WHERE mac = ?", mac).Scan(&node)
	if node.MAC != mac || node.Hostname != "hive-cdeeff" || node.MAC6 != "cdeeff" {
		t.Fatalf("node row = %+v", node)
	}
	if node.RegisteredAt == "" || node.LastSeen == "" {
		t.Fatalf("node row lacks presence timestamps: %+v", node)
	}

	// 认领码只存 sha256，明文只回一次。
	var storedHash, claimHash string
	testDB.Raw("SELECT token_hash FROM device_credentials WHERE mac = ?", mac).Scan(&storedHash)
	sum := sha256.Sum256([]byte(body.Token))
	if storedHash != hex.EncodeToString(sum[:]) {
		t.Fatalf("stored credential hash mismatch")
	}
	testDB.Raw("SELECT claim_code_hash FROM nodes WHERE mac = ?", mac).Scan(&claimHash)
	if claimHash != hashClaimCode(body.ClaimCode) {
		t.Fatalf("stored claim hash does not match the returned code")
	}

	// 领到的凭证必须真的能过 RequireDeviceAuth，否则 provisioning 还是全 401。
	hb := doBearer("POST", "/nodes/heartbeat", map[string]any{
		"mac": mac, "cpu_pct": 12.5, "mem_pct": 40.0, "disk_pct": 55.0, "uptime_sec": 60,
	}, body.Token)
	assertStatus(t, hb, http.StatusOK)
	var probeStatus string
	testDB.Raw("SELECT status FROM node_status_checks WHERE mac = ?", mac).Scan(&probeStatus)
	if probeStatus != "online" {
		t.Fatalf("heartbeat did not mark the node online: %q", probeStatus)
	}
}

func TestNodeEnroll_RefusesSecondEnrollment(t *testing.T) {
	resetDB(t)
	mac := "001122334455"
	first := doJSON("POST", "/nodes/enroll", map[string]string{"mac": mac}, nil)
	assertStatus(t, first, http.StatusOK)
	var enrolled EnrollResponse
	decodeBody(t, first, &enrolled)

	second := doJSON("POST", "/nodes/enroll", map[string]string{"mac": mac}, nil)
	assertStatus(t, second, http.StatusConflict)

	// 原凭证仍然有效：不能被"再刷一次固件"把凭证换掉。
	hb := doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac}, enrolled.Token)
	assertStatus(t, hb, http.StatusOK)
}

func TestNodeEnroll_RefusesClaimedDevice(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "owner@example.com")
	mac := "0a1b2c3d4e5f"
	insertNodeRow(t, mac, "hive-3d4e5f", "", "", &cid, true)

	resp := doJSON("POST", "/nodes/enroll", map[string]string{"mac": mac}, nil)
	assertStatus(t, resp, http.StatusConflict)
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM device_credentials WHERE mac = ?", mac).Scan(&count)
	if count != 0 {
		t.Fatalf("claimed device must not receive a credential")
	}
}

func TestNodeEnroll_AdoptsPreexistingUnclaimedRow(t *testing.T) {
	resetDB(t)
	mac := "112233445566"
	// 旧流程（管理员预置/曾经注册过但没发证）留下的节点行：没有凭证、没有认领码。
	insertNodeRow(t, mac, "hive-33445566", "", "", nil, false)

	resp := doJSON("POST", "/nodes/enroll", map[string]string{"mac": mac, "hostname": "hive-renamed"}, nil)
	assertStatus(t, resp, http.StatusOK)
	var body EnrollResponse
	decodeBody(t, resp, &body)
	if body.Token == "" || body.ClaimCode == "" {
		t.Fatalf("adopted device must get token and claim code: %+v", body)
	}
	var hostname string
	testDB.Raw("SELECT hostname FROM nodes WHERE mac = ?", mac).Scan(&hostname)
	if hostname != "hive-renamed" {
		t.Fatalf("hostname = %q", hostname)
	}
}

func TestNodeEnroll_RejectsMalformedRequest(t *testing.T) {
	resetDB(t)
	for _, body := range []map[string]string{
		{"mac": "not-a-mac"},
		{"mac": ""},
	} {
		resp := doJSON("POST", "/nodes/enroll", body, nil)
		assertStatus(t, resp, http.StatusBadRequest)
	}
}

func TestNodeEnroll_AppearsInAdminNodeListAsOnline(t *testing.T) {
	resetDB(t)
	mac := "e1e2e3e4e5e6"
	resp := doJSON("POST", "/nodes/enroll", map[string]string{"mac": mac, "hostname": "hive-e4e5e6"}, nil)
	assertStatus(t, resp, http.StatusOK)
	var enrolled EnrollResponse
	decodeBody(t, resp, &enrolled)
	assertStatus(t, doBearer("POST", "/nodes/heartbeat", map[string]any{"mac": mac}, enrolled.Token), http.StatusOK)

	// 需求 1 的验收点：刷写后管理面板立刻能看到这台设备，且状态是在线。
	list := doJSON("GET", "/nodes", nil, adminCookie())
	assertStatus(t, list, http.StatusOK)
	found := false
	for _, row := range parseJSONArray(list) {
		if row["mac"] != mac {
			continue
		}
		found = true
		if row["probe_status"] != "online" {
			t.Fatalf("probe_status = %v, want online", row["probe_status"])
		}
		if row["hostname"] != "hive-e4e5e6" {
			t.Fatalf("hostname = %v", row["hostname"])
		}
	}
	if !found {
		t.Fatalf("enrolled node %s missing from GET /nodes", mac)
	}
}

func TestPortalDeviceDashboard_ReturnsMeshURLAndSecret(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "gw@example.com")
	mac := "a1a2a3a4a5a6"
	insertNodeRow(t, mac, "hive-a4a5a6", "172.20.1.7", "100.64.0.9", &cid, true)

	resp := doJSON("GET", "/portal/devices/"+mac+"/dashboard", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)
	var body DashboardResponse
	decodeBody(t, resp, &body)
	if body.Secret != testH.gatewaySecret(mac) {
		t.Fatalf("secret does not match the per-node controller secret")
	}
	found := false
	for _, u := range body.URLs {
		if u == "http://172.20.1.7:9090/ui" {
			found = true
		}
	}
	if !found {
		t.Fatalf("mesh dashboard URL missing: %v", body.URLs)
	}
}

func TestPortalDeviceDashboard_HidesOtherCustomersAndNonGateways(t *testing.T) {
	resetDB(t)
	owner := insertTestCustomer(t, "owner2@example.com")
	other := insertTestCustomer(t, "other@example.com")
	mac := "b1b2b3b4b5b6"
	insertNodeRow(t, mac, "hive-b4b5b6", "172.20.1.8", "", &owner, true)

	assertStatus(t, doJSON("GET", "/portal/devices/"+mac+"/dashboard", nil, customerCookie(other)), http.StatusNotFound)

	plain := "b2b3b4b5b6b7"
	insertNodeRow(t, plain, "hive-b5b6b7", "172.20.1.9", "", &owner, false)
	assertStatus(t, doJSON("GET", "/portal/devices/"+plain+"/dashboard", nil, customerCookie(owner)), http.StatusNotFound)
}

func TestPortalDeviceMihomo_RejectsUnknownPaths(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "mihomo@example.com")
	mac := "c1c2c3c4c5c6"
	insertNodeRow(t, mac, "hive-c4c5c6", "172.20.1.10", "", &cid, true)

	assertStatus(t, doJSON("GET", "/portal/devices/"+mac+"/mihomo/configs", nil, customerCookie(cid)), http.StatusNotFound)
}

func TestPortalDeviceMihomo_ReportsMissingManagementAddress(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "noaddr@example.com")
	mac := "d1d2d3d4d5d6"
	// 还没拿到 EasyTier/Tailscale 地址的网关：前端应看到可判定的 503，而不是超时。
	insertNodeRow(t, mac, "hive-d4d5d6", "", "pending", &cid, true)

	resp := doJSON("GET", "/portal/devices/"+mac+"/mihomo/connections", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusServiceUnavailable)
}
