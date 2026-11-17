package handler

import (
	"net/http"
	"testing"
	"time"
)

func postAccounting(t *testing.T, mac, credential string, report NodeAccountingRequest) NodeXrayUsersResponse {
	t.Helper()
	resp := doBearer("POST", "/servers/"+mac+"/accounting", report, credential)
	assertStatus(t, resp, http.StatusOK)
	var out NodeXrayUsersResponse
	decodeBody(t, resp, &out)
	return out
}

func limitFor(t *testing.T, limits []NodeDeviceLimit, subscriptionID uint) NodeDeviceLimit {
	t.Helper()
	for _, limit := range limits {
		if limit.SubscriptionID == subscriptionID {
			return limit
		}
	}
	t.Fatalf("no device limit for subscription %d: %+v", subscriptionID, limits)
	return NodeDeviceLimit{}
}

func TestNodeAccountingStoresOnlineDevices(t *testing.T) {
	_, id, credential := accountingFixture(t)
	mustExec(t, "UPDATE customer_subscriptions SET device_limit = 2 WHERE id = ?", id)

	out := postAccounting(t, "aabbccddeeff", credential, NodeAccountingRequest{
		Epoch:    "online-one",
		Counters: []NodeTrafficCounter{},
		Online: []NodeOnlineDevice{{
			SubscriptionID: id,
			IPs:            []string{"203.0.113.7", "203.0.113.8"},
		}},
	})
	limit := limitFor(t, out.DeviceLimits, id)
	if limit.DeviceLimit != 2 || limit.Used != 2 || len(limit.AllowedIPs) != 2 {
		t.Fatalf("device limit = %+v, want limit=2 used=2 allowed=2", limit)
	}
	if got := scalar(t, "SELECT COUNT(*) FROM subscription_online_devices WHERE subscription_id = ?", id); got != 2 {
		t.Fatalf("stored online devices = %d, want 2", got)
	}
}

func TestDeviceLimitKeepsOldestOnlineIPsAcrossExits(t *testing.T) {
	_, id, credentialA := accountingFixture(t)
	mustExec(t, "UPDATE customer_subscriptions SET device_limit = 1 WHERE id = ?", id)

	insertSubTestNode(t, "112233445566")
	credentialB := serverToken(t, "112233445566")
	mustExec(t, "INSERT INTO line_nodes (line_id, node_mac) SELECT line_id, '112233445566' FROM line_nodes WHERE node_mac = 'aabbccddeeff'")

	outA := postAccounting(t, "aabbccddeeff", credentialA, NodeAccountingRequest{
		Epoch:    "online-a",
		Counters: []NodeTrafficCounter{},
		Online: []NodeOnlineDevice{{
			SubscriptionID: id,
			IPs:            []string{"203.0.113.7"},
		}},
	})
	if limit := limitFor(t, outA.DeviceLimits, id); limit.Used != 1 || len(limit.AllowedIPs) != 1 {
		t.Fatalf("first exit limit = %+v, want used=1 allowed=1", limit)
	}

	outB := postAccounting(t, "112233445566", credentialB, NodeAccountingRequest{
		Epoch:    "online-b",
		Counters: []NodeTrafficCounter{},
		Online: []NodeOnlineDevice{{
			SubscriptionID: id,
			IPs:            []string{"203.0.113.7", "203.0.113.8"},
		}},
	})
	limit := limitFor(t, outB.DeviceLimits, id)
	if limit.Used != 2 || len(limit.AllowedIPs) != 1 || limit.AllowedIPs[0] != "203.0.113.7" {
		t.Fatalf("second exit limit = %+v, want used=2 allowed=[203.0.113.7]", limit)
	}
}

func TestDeviceLimitZeroMeansUnlimited(t *testing.T) {
	_, id, credential := accountingFixture(t)
	mustExec(t, "UPDATE customer_subscriptions SET device_limit = 0 WHERE id = ?", id)

	out := postAccounting(t, "aabbccddeeff", credential, NodeAccountingRequest{
		Epoch:    "online-unlimited",
		Counters: []NodeTrafficCounter{},
		Online: []NodeOnlineDevice{{
			SubscriptionID: id,
			IPs:            []string{"203.0.113.7", "203.0.113.8"},
		}},
	})
	limit := limitFor(t, out.DeviceLimits, id)
	if limit.DeviceLimit != 0 || limit.Used != 2 || len(limit.AllowedIPs) != 0 {
		t.Fatalf("unlimited device limit = %+v, want limit=0 used=2 allowed=0", limit)
	}
}

func TestOnlineReportIgnoresSubscriptionOutsideNodeLines(t *testing.T) {
	_, _, credential := accountingFixture(t)
	otherPlan := insertTestPlan(t, "online-other-plan")
	otherCustomer := insertTestCustomer(t, "online-other@example.com")
	otherSubscription := insertTestSubscription(t, otherCustomer, otherPlan, "active", time.Now().Add(24*time.Hour))

	out := postAccounting(t, "aabbccddeeff", credential, NodeAccountingRequest{
		Epoch:    "online-unassigned",
		Counters: []NodeTrafficCounter{},
		Online: []NodeOnlineDevice{{
			SubscriptionID: otherSubscription,
			IPs:            []string{"203.0.113.9"},
		}},
	})
	if got := scalar(t, "SELECT COUNT(*) FROM subscription_online_devices WHERE subscription_id = ?", otherSubscription); got != 0 {
		t.Fatalf("unassigned subscription stored %d online devices", got)
	}
	for _, limit := range out.DeviceLimits {
		if limit.SubscriptionID == otherSubscription {
			t.Fatalf("unassigned subscription returned a device limit: %+v", limit)
		}
	}
}

func TestOnlineDeviceTTLExpiresRows(t *testing.T) {
	_, id, credential := accountingFixture(t)
	mustExec(t, "UPDATE customer_subscriptions SET device_limit = 2 WHERE id = ?", id)
	old := time.Now().UTC().Add(-time.Hour)
	mustExec(t,
		"INSERT INTO subscription_online_devices (subscription_id, node_mac, ip, first_seen, last_seen) VALUES (?, 'aabbccddeeff', '203.0.113.1', ?, ?)",
		id, old, old,
	)

	out := postAccounting(t, "aabbccddeeff", credential, NodeAccountingRequest{
		Epoch:    "online-ttl",
		Counters: []NodeTrafficCounter{},
		Online: []NodeOnlineDevice{{
			SubscriptionID: id,
			IPs:            []string{"203.0.113.7"},
		}},
	})
	if limit := limitFor(t, out.DeviceLimits, id); limit.Used != 1 {
		t.Fatalf("expired row counted: %+v", limit)
	}
	if got := scalar(t, "SELECT COUNT(*) FROM subscription_online_devices WHERE subscription_id = ? AND ip = '203.0.113.1'", id); got != 0 {
		t.Fatalf("expired row was not cleaned up: %d", got)
	}
}

func TestNodeAccountingRejectsInvalidOnlineDevices(t *testing.T) {
	_, id, credential := accountingFixture(t)
	validIP := "203.0.113.7"
	for _, report := range []NodeAccountingRequest{
		{Epoch: "online-bad-ip", Counters: []NodeTrafficCounter{}, Online: []NodeOnlineDevice{{SubscriptionID: id, IPs: []string{"not-an-ip"}}}},
		{Epoch: "online-dup-ip", Counters: []NodeTrafficCounter{}, Online: []NodeOnlineDevice{{SubscriptionID: id, IPs: []string{validIP, validIP}}}},
		{Epoch: "online-zero-sub", Counters: []NodeTrafficCounter{}, Online: []NodeOnlineDevice{{SubscriptionID: 0, IPs: []string{validIP}}}},
		{Epoch: "online-dup-sub", Counters: []NodeTrafficCounter{}, Online: []NodeOnlineDevice{
			{SubscriptionID: id, IPs: []string{validIP}},
			{SubscriptionID: id, IPs: []string{"203.0.113.8"}},
		}},
	} {
		resp := doBearer("POST", "/servers/aabbccddeeff/accounting", report, credential)
		assertStatus(t, resp, http.StatusBadRequest)
		resp.Body.Close()
	}
}
