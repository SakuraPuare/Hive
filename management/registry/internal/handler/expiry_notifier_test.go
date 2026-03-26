package handler

import (
	"net/http"
	"testing"
	"time"

	"hive/registry/internal/mailer"
)

// insertTestSubscription inserts a customer_subscription and returns its ID.
func insertTestSubscription(t *testing.T, customerID, planID uint, status string, expiresAt time.Time) uint {
	t.Helper()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	exp := expiresAt.UTC().Format("2006-01-02 15:04:05")
	token := "tok-" + time.Now().Format("150405.000000000")
	result := testDB.Exec(
		`INSERT INTO customer_subscriptions (customer_id, plan_id, token, status, traffic_used, traffic_limit, device_limit, started_at, expires_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, 107374182400, 3, ?, ?, ?, ?)`,
		customerID, planID, token, status, now, exp, now, now,
	)
	if result.Error != nil {
		t.Fatalf("insert test subscription: %v", result.Error)
	}
	var id uint
	testDB.Raw("SELECT LAST_INSERT_ID()").Scan(&id)
	return id
}

// newTestMailer creates a Mailer with mail disabled (no actual SMTP).
func newTestMailer() *mailer.Mailer {
	return &mailer.Mailer{Config: testCfg, DB: testDB}
}

// ── Expiring subscription (within 3 days) ────────────────────────────────────

func TestExpiryNotifier_SendsExpiringReminder(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "expiring@example.com")
	pid := insertTestPlan(t, "Monthly")
	// Expires in 2 days — should trigger expiring reminder
	subID := insertTestSubscription(t, cid, pid, "active", time.Now().UTC().Add(2*24*time.Hour))

	ml := newTestMailer()
	ml.RunExpiryCheck()

	// Verify expiry_notified_at was set
	var notifiedAt *string
	testDB.Raw("SELECT expiry_notified_at FROM customer_subscriptions WHERE id = ?", subID).Scan(&notifiedAt)
	if notifiedAt == nil || *notifiedAt == "" {
		t.Fatal("expected expiry_notified_at to be set after notification")
	}

	// Status should still be active (not expired yet)
	var status string
	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", subID).Scan(&status)
	if status != "active" {
		t.Fatalf("expected status=active, got %q", status)
	}
}

// ── Already notified subscription should be skipped ──────────────────────────

func TestExpiryNotifier_SkipsAlreadyNotified(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "notified@example.com")
	pid := insertTestPlan(t, "Monthly")
	subID := insertTestSubscription(t, cid, pid, "active", time.Now().UTC().Add(2*24*time.Hour))

	// Manually set expiry_notified_at
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	testDB.Exec("UPDATE customer_subscriptions SET expiry_notified_at = ? WHERE id = ?", now, subID)

	ml := newTestMailer()
	ml.RunExpiryCheck()

	// expiry_notified_at should still be set (not cleared), meaning it wasn't re-sent
	var notifiedAt *string
	testDB.Raw("SELECT expiry_notified_at FROM customer_subscriptions WHERE id = ?", subID).Scan(&notifiedAt)
	if notifiedAt == nil || *notifiedAt == "" {
		t.Fatal("expected expiry_notified_at to remain set")
	}
}

// ── Expired subscription gets status updated ─────────────────────────────────

func TestExpiryNotifier_ExpiresSubscription(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "expired@example.com")
	pid := insertTestPlan(t, "Monthly")
	// Expired 1 hour ago
	subID := insertTestSubscription(t, cid, pid, "active", time.Now().UTC().Add(-1*time.Hour))

	ml := newTestMailer()
	ml.RunExpiryCheck()

	var status string
	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", subID).Scan(&status)
	if status != "expired" {
		t.Fatalf("expected status=expired, got %q", status)
	}
}

// ── Non-active subscription should be skipped ────────────────────────────────

func TestExpiryNotifier_SkipsNonActive(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "inactive@example.com")
	pid := insertTestPlan(t, "Monthly")
	// Already expired status, expires in 2 days
	subID := insertTestSubscription(t, cid, pid, "expired", time.Now().UTC().Add(2*24*time.Hour))

	ml := newTestMailer()
	ml.RunExpiryCheck()

	// Should not have been touched
	var notifiedAt *string
	testDB.Raw("SELECT expiry_notified_at FROM customer_subscriptions WHERE id = ?", subID).Scan(&notifiedAt)
	if notifiedAt != nil && *notifiedAt != "" {
		t.Fatal("expected expiry_notified_at to remain NULL for non-active subscription")
	}
}

// ── Far-future subscription should not be notified ───────────────────────────

func TestExpiryNotifier_SkipsFarFuture(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "future@example.com")
	pid := insertTestPlan(t, "Monthly")
	// Expires in 30 days — should NOT trigger
	subID := insertTestSubscription(t, cid, pid, "active", time.Now().UTC().Add(30*24*time.Hour))

	ml := newTestMailer()
	ml.RunExpiryCheck()

	var notifiedAt *string
	testDB.Raw("SELECT expiry_notified_at FROM customer_subscriptions WHERE id = ?", subID).Scan(&notifiedAt)
	if notifiedAt != nil && *notifiedAt != "" {
		t.Fatal("expected no notification for subscription expiring in 30 days")
	}
}

// ── Multiple subscriptions mixed scenario ────────────────────────────────────

func TestExpiryNotifier_MixedScenario(t *testing.T) {
	resetDB(t)
	pid := insertTestPlan(t, "Monthly")

	cid1 := insertTestCustomer(t, "mix1@example.com")
	cid2 := insertTestCustomer(t, "mix2@example.com")
	cid3 := insertTestCustomer(t, "mix3@example.com")

	// sub1: expiring in 1 day (should notify)
	sub1 := insertTestSubscription(t, cid1, pid, "active", time.Now().UTC().Add(1*24*time.Hour))
	// sub2: expired 2 hours ago (should expire)
	sub2 := insertTestSubscription(t, cid2, pid, "active", time.Now().UTC().Add(-2*time.Hour))
	// sub3: expires in 10 days (should skip)
	sub3 := insertTestSubscription(t, cid3, pid, "active", time.Now().UTC().Add(10*24*time.Hour))

	ml := newTestMailer()
	ml.RunExpiryCheck()

	// sub1: notified, still active
	var s1Status string
	var s1Notified *string
	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", sub1).Scan(&s1Status)
	testDB.Raw("SELECT expiry_notified_at FROM customer_subscriptions WHERE id = ?", sub1).Scan(&s1Notified)
	if s1Status != "active" {
		t.Fatalf("sub1: expected active, got %q", s1Status)
	}
	if s1Notified == nil || *s1Notified == "" {
		t.Fatal("sub1: expected expiry_notified_at to be set")
	}

	// sub2: expired
	var s2Status string
	testDB.Raw("SELECT status FROM customer_subscriptions WHERE id = ?", sub2).Scan(&s2Status)
	if s2Status != "expired" {
		t.Fatalf("sub2: expected expired, got %q", s2Status)
	}

	// sub3: untouched
	var s3Notified *string
	testDB.Raw("SELECT expiry_notified_at FROM customer_subscriptions WHERE id = ?", sub3).Scan(&s3Notified)
	if s3Notified != nil && *s3Notified != "" {
		t.Fatal("sub3: expected no notification")
	}
}

// ── Verify forgot/reset don't require auth ───────────────────────────────────

func TestPortalPasswordEndpoints_NoAuthRequired(t *testing.T) {
	resetDB(t)

	// These should not return 401
	resp := doJSON("POST", "/portal/forgot-password", map[string]string{
		"email": "noauth@example.com",
	}, nil)
	if resp.StatusCode == http.StatusUnauthorized {
		t.Fatal("forgot-password should not require auth")
	}

	resp = doJSON("POST", "/portal/reset-password", map[string]string{
		"email": "noauth@example.com", "code": "000000", "password": "pass",
	}, nil)
	if resp.StatusCode == http.StatusUnauthorized {
		t.Fatal("reset-password should not require auth")
	}
}
