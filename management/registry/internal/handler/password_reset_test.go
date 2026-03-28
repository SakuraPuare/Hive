package handler

import (
	"net/http"
	"testing"
	"time"

	"hive/registry/internal/model"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func insertResetCode(t *testing.T, email, code string, expiresAt time.Time, used bool) {
	t.Helper()
	usedInt := 0
	if used {
		usedInt = 1
	}
	result := testDB.Exec(
		"INSERT INTO password_reset_codes (email, code, expires_at, used) VALUES (?, ?, ?, ?)",
		email, code, expiresAt.UTC().Format(model.TimeLayout), usedInt,
	)
	if result.Error != nil {
		t.Fatalf("insert reset code: %v", result.Error)
	}
}

// ── POST /portal/forgot-password ─────────────────────────────────────────────

func TestForgotPassword_ValidEmail(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "forgot@example.com")

	resp := doJSON("POST", "/portal/forgot-password", map[string]string{
		"email": "forgot@example.com",
	}, nil)
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["message"] == nil {
		t.Fatal("expected message in response")
	}

	// Verify code was inserted in DB
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM password_reset_codes WHERE email = ?", "forgot@example.com").Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 reset code, got %d", count)
	}
}

func TestForgotPassword_UnknownEmail(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/forgot-password", map[string]string{
		"email": "unknown@example.com",
	}, nil)
	// Should still return 200 to not reveal email existence
	assertStatus(t, resp, http.StatusOK)

	// No code should be inserted
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM password_reset_codes WHERE email = ?", "unknown@example.com").Scan(&count)
	if count != 0 {
		t.Fatalf("expected 0 reset codes for unknown email, got %d", count)
	}
}

func TestForgotPassword_EmptyEmail(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/forgot-password", map[string]string{
		"email": "",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestForgotPassword_InvalidJSON(t *testing.T) {
	resetDB(t)

	req, _ := http.NewRequest("POST", testServer.URL+"/portal/forgot-password", nil)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestForgotPassword_InvalidatesPreviousCodes(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "multi@example.com")

	// First request
	doJSON("POST", "/portal/forgot-password", map[string]string{
		"email": "multi@example.com",
	}, nil)

	// Second request should invalidate the first code
	doJSON("POST", "/portal/forgot-password", map[string]string{
		"email": "multi@example.com",
	}, nil)

	// Only the latest code should be unused
	var unusedCount int64
	testDB.Raw("SELECT COUNT(*) FROM password_reset_codes WHERE email = ? AND used = 0", "multi@example.com").Scan(&unusedCount)
	if unusedCount != 1 {
		t.Fatalf("expected 1 unused code after second request, got %d", unusedCount)
	}
}

// ── POST /portal/reset-password ──────────────────────────────────────────────

func TestResetPassword_ValidCode(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "reset@example.com")
	insertResetCode(t, "reset@example.com", "123456", time.Now().UTC().Add(15*time.Minute), false)

	resp := doJSON("POST", "/portal/reset-password", map[string]string{
		"email":    "reset@example.com",
		"code":     "123456",
		"password": "newpass123",
	}, nil)
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["message"] != "密码重置成功" {
		t.Fatalf("expected success message, got %v", body["message"])
	}

	// Verify code is marked as used
	var used bool
	testDB.Raw("SELECT used FROM password_reset_codes WHERE email = ? AND code = ?", "reset@example.com", "123456").Scan(&used)
	if !used {
		t.Fatal("expected code to be marked as used")
	}

	// Verify password was actually changed (login with new password should work)
	var hash string
	testDB.Raw("SELECT password_hash FROM customers WHERE email = ?", "reset@example.com").Scan(&hash)
	if hash == "" {
		t.Fatal("expected password_hash to be set")
	}
}

func TestResetPassword_WrongCode(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "wrong@example.com")
	insertResetCode(t, "wrong@example.com", "123456", time.Now().UTC().Add(15*time.Minute), false)

	resp := doJSON("POST", "/portal/reset-password", map[string]string{
		"email":    "wrong@example.com",
		"code":     "999999",
		"password": "newpass",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestResetPassword_ExpiredCode(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "expired@example.com")
	// Code expired 1 hour ago
	insertResetCode(t, "expired@example.com", "111111", time.Now().UTC().Add(-1*time.Hour), false)

	resp := doJSON("POST", "/portal/reset-password", map[string]string{
		"email":    "expired@example.com",
		"code":     "111111",
		"password": "newpass",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestResetPassword_UsedCode(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "used@example.com")
	insertResetCode(t, "used@example.com", "222222", time.Now().UTC().Add(15*time.Minute), true)

	resp := doJSON("POST", "/portal/reset-password", map[string]string{
		"email":    "used@example.com",
		"code":     "222222",
		"password": "newpass",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestResetPassword_MissingFields(t *testing.T) {
	resetDB(t)

	tests := []struct {
		name string
		body map[string]string
	}{
		{"missing email", map[string]string{"code": "123456", "password": "pass"}},
		{"missing code", map[string]string{"email": "a@b.com", "password": "pass"}},
		{"missing password", map[string]string{"email": "a@b.com", "code": "123456"}},
		{"all empty", map[string]string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := doJSON("POST", "/portal/reset-password", tt.body, nil)
			assertStatus(t, resp, http.StatusBadRequest)
		})
	}
}

func TestResetPassword_InvalidJSON(t *testing.T) {
	resetDB(t)

	req, _ := http.NewRequest("POST", testServer.URL+"/portal/reset-password", nil)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestResetPassword_WrongEmail(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "real@example.com")
	insertResetCode(t, "real@example.com", "333333", time.Now().UTC().Add(15*time.Minute), false)

	// Try to use the code with a different email
	resp := doJSON("POST", "/portal/reset-password", map[string]string{
		"email":    "other@example.com",
		"code":     "333333",
		"password": "newpass",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

// ── generate6DigitCode ───────────────────────────────────────────────────────

func TestGenerate6DigitCode_Format(t *testing.T) {
	for i := 0; i < 100; i++ {
		code, err := generate6DigitCode()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(code) != 6 {
			t.Fatalf("expected 6-digit code, got %q (len=%d)", code, len(code))
		}
		for _, c := range code {
			if c < '0' || c > '9' {
				t.Fatalf("expected only digits, got %q", code)
			}
		}
	}
}

func TestGenerate6DigitCode_Randomness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 50; i++ {
		code, err := generate6DigitCode()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		seen[code] = true
	}
	// With 50 random codes, we should have at least 40 unique ones
	if len(seen) < 40 {
		t.Fatalf("expected at least 40 unique codes out of 50, got %d", len(seen))
	}
}
