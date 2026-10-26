package handler

import (
	"context"
	"fmt"
	"math"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
)

func generationReport(id uint, generation int64, value int64) NodeAccountingRequest {
	return NodeAccountingRequest{Generation: generation, Epoch: fmt.Sprintf("runtime-%d", generation), Counters: []NodeTrafficCounter{{Name: fmt.Sprintf("user>>>sub-%d>>>traffic>>>uplink", id), Value: value}}}
}

func postGeneration(t *testing.T, credential string, report NodeAccountingRequest, want int) {
	t.Helper()
	resp := doBearer("POST", "/servers/aabbccddeeff/accounting", report, credential)
	assertStatus(t, resp, want)
	resp.Body.Close()
}

func TestAccountingCleanupFencesDeletedHistoryAndPreservesCurrent(t *testing.T) {
	_, id, credential := accountingFixture(t)
	old, current := generationReport(id, 1, 70), generationReport(id, 2, 20)
	postGeneration(t, credential, old, 200)
	postGeneration(t, credential, current, 200)
	removed, err := testH.cleanupAccountingCounters(context.Background())
	if err != nil || removed != 1 {
		t.Fatalf("cleanup: %d %v", removed, err)
	}
	postGeneration(t, credential, old, 410)
	old.Counters[0].Value = 700
	postGeneration(t, credential, old, 410)
	postGeneration(t, credential, current, 200)
	current.Counters[0].Value = 25
	postGeneration(t, credential, current, 200)
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 95 {
		t.Fatal("retired retry rebilled or current delta lost")
	}
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=0 WHERE id=?", id)
	postGeneration(t, credential, current, 200)
	current.Counters[0].Value = 30
	postGeneration(t, credential, current, 200)
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 5 {
		t.Fatal("monthly reset rebilled cumulative traffic")
	}
	if scalar(t, "SELECT COUNT(*) FROM node_traffic_counters") != 1 || scalar(t, "SELECT COUNT(*) FROM node_accounting_state") != 1 {
		t.Fatal("history not bounded")
	}
	removed, err = testH.cleanupAccountingCounters(context.Background())
	if err != nil || removed != 0 {
		t.Fatalf("second cleanup: %d %v", removed, err)
	}
}

func TestAccountingCleanupLegacyUpgradeAndBatchIsolation(t *testing.T) {
	_, id, credential := accountingFixture(t)
	legacy := generationReport(id, 0, 70)
	postGeneration(t, credential, legacy, 200)
	if n, err := testH.cleanupAccountingCounters(context.Background()); n != 0 || err != nil {
		t.Fatalf("removed legacy watermark: %d %v", n, err)
	}
	postGeneration(t, credential, legacy, 200)
	insertSubTestNode(t, "112233445566")
	mustExec(t, "INSERT INTO node_traffic_counters (node_mac,epoch,counter_name,bytes) VALUES ('112233445566','old','unrelated',100)")
	// Exercise multiple bounded DELETE transactions with pre-upgrade history.
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < 1005; i++ {
			if err := tx.Exec("INSERT INTO node_traffic_counters (node_mac,epoch,counter_name,bytes) VALUES ('aabbccddeeff',?,'historical',100)", fmt.Sprint(i)).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	postGeneration(t, credential, generationReport(id, 1, 10), 200)
	n, err := testH.cleanupAccountingCounters(context.Background())
	if err != nil || n != 1006 {
		t.Fatalf("batch cleanup: %d %v", n, err)
	}
	postGeneration(t, credential, legacy, 410)
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 80 || scalar(t, "SELECT COUNT(*) FROM node_traffic_counters") != 2 {
		t.Fatal("cleanup affected billing or another node")
	}
}

func TestAccountingGenerationValidationAndPersistentFence(t *testing.T) {
	_, id, credential := accountingFixture(t)
	postGeneration(t, credential, generationReport(id, -1, 1), 400)
	postGeneration(t, credential, generationReport(id, 2, 1), 409)
	postGeneration(t, credential, generationReport(id, 1, 10), 200)
	wrongEpoch := generationReport(id, 1, 10)
	wrongEpoch.Epoch = "other"
	postGeneration(t, credential, wrongEpoch, 409)
	wrongEpoch.Generation = 2
	wrongEpoch.Epoch = "runtime-1"
	postGeneration(t, credential, wrongEpoch, 409)
	postGeneration(t, credential, generationReport(id, 2, 20), 200)
	if _, err := testH.cleanupAccountingCounters(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Revoke/re-enable and construct a fresh handler: neither resets the DB fence.
	resp := doJSON("DELETE", "/admin/nodes/aabbccddeeff/server-credential", nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	credential = serverToken(t, "aabbccddeeff")
	postGeneration(t, credential, generationReport(id, 1, 10), 410)
	fresh := &Handler{DB: testDB, Auth: testAuth, Config: testCfg}
	req := httptest.NewRequest("GET", "/servers/aabbccddeeff/accounting/state", nil)
	req.SetPathValue("mac", "aabbccddeeff")
	req.Header.Set("Authorization", "Bearer "+credential)
	w := httptest.NewRecorder()
	fresh.HandleNodeAccountingState(w, req)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("state: %d %s", w.Code, w.Body.String())
	}
	var state NodeAccountingState
	decodeBody(t, w.Result(), &state)
	if state.Generation != 2 || state.Epoch != "runtime-2" {
		t.Fatalf("lost fence: %+v", state)
	}
	for _, token := range []string{deviceToken(t, "aabbccddeeff"), testCfg.AdminAPISecret, ""} {
		resp = doBearer("GET", "/servers/aabbccddeeff/accounting/state", nil, token)
		assertStatus(t, resp, 401)
		resp.Body.Close()
	}
}

func TestAccountingGenerationAndBillingRollbackTogether(t *testing.T) {
	_, id, credential := accountingFixture(t)
	postGeneration(t, credential, generationReport(id, 1, 10), 200)
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=? WHERE id=?", int64(math.MaxInt64), id)
	postGeneration(t, credential, generationReport(id, 2, 20), 500) // BIGINT overflow aborts billing.
	if scalar(t, "SELECT generation FROM node_accounting_state") != 1 {
		t.Fatal("failed billing retired live counters")
	}
	if n, err := testH.cleanupAccountingCounters(context.Background()); n != 0 || err != nil {
		t.Fatalf("cleaned failed transition: %d %v", n, err)
	}
	mustExec(t, "UPDATE customer_subscriptions SET traffic_used=10 WHERE id=?", id)
	postGeneration(t, credential, generationReport(id, 2, 20), 200)
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 30 {
		t.Fatal("retry lost traffic")
	}
}

func TestAccountingCleanupConcurrentReportsAndWorkers(t *testing.T) {
	_, id, credential := accountingFixture(t)
	old, current := generationReport(id, 1, 70), generationReport(id, 2, 20)
	postGeneration(t, credential, old, 200)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%3 == 0 {
				if _, err := testH.cleanupAccountingCounters(context.Background()); err != nil {
					t.Error(err)
				}
				return
			}
			report := current
			if i%3 == 1 {
				report = old
			}
			resp := doBearer("POST", "/servers/aabbccddeeff/accounting", report, credential)
			defer resp.Body.Close()
			if resp.StatusCode != 200 && !(i%3 == 1 && resp.StatusCode == 410) {
				t.Errorf("report status %d", resp.StatusCode)
			}
		}(i)
	}
	wg.Wait()
	if _, err := testH.cleanupAccountingCounters(context.Background()); err != nil {
		t.Fatal(err)
	}
	if scalar(t, "SELECT traffic_used FROM customer_subscriptions WHERE id=?", id) != 90 || scalar(t, "SELECT COUNT(*) FROM node_traffic_counters") != 1 {
		t.Fatal("race lost/doubled usage or removed current counters")
	}
}

func TestAccountingCleanupLoopStartsImmediatelyAndCancels(t *testing.T) {
	_, id, credential := accountingFixture(t)
	postGeneration(t, credential, generationReport(id, 1, 70), 200)
	postGeneration(t, credential, generationReport(id, 2, 20), 200)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); testH.StartAccountingCleanupLoop(ctx) }()
	deadline := time.Now().Add(5 * time.Second)
	for scalar(t, "SELECT COUNT(*) FROM node_traffic_counters") != 1 {
		if time.Now().After(deadline) {
			t.Fatal("startup cleanup did not run")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("loop did not stop")
	}
	if _, err := testH.cleanupAccountingCounters(ctx); err == nil {
		t.Fatal("cleanup ignored cancellation")
	}
}
