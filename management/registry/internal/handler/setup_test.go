package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"hive/registry/internal/config"
	"hive/registry/internal/mailer"
	"hive/registry/internal/middleware"
	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

var (
	testServer *httptest.Server
	testDB     *gorm.DB
	testCfg    *config.Config
	testAuth   *middleware.Auth
	testH      *Handler
)

func TestMain(m *testing.M) {
	testCfg = &config.Config{
		ListenAddr:          ":0",
		APISecret:           "test-api-secret",
		AdminUser:           "admin",
		AdminPass:           "admin123",
		AdminSessionSecret:  "test-session-secret-32bytes!!",
		AdminSessionTTL:     12 * time.Hour,
		AdminCookieName:     "hive_admin_session",
		CORSAllowedOrigins:  []string{"*"},
		AdminCookieSameSite: http.SameSiteLaxMode,
		XrayPath:            "ray",
		PrometheusURL:       "http://127.0.0.1:4230",
	}

	initTestDB()
	store.RunMigrations(testDB)
	store.BootstrapSuperadmin(testDB, testCfg.AdminUser, testCfg.AdminPass)
	store.BootstrapRBAC(testDB)

	testAuth = &middleware.Auth{Config: testCfg, DB: testDB}
	testMailer := &mailer.Mailer{Config: testCfg, DB: testDB}
	testH = &Handler{DB: testDB, Config: testCfg, Auth: testAuth, Mailer: testMailer}

	mux := testH.RegisterRoutes()
	testServer = httptest.NewServer(middleware.WithMetrics(middleware.WithCORS(mux, testCfg)))

	code := m.Run()

	testServer.Close()
	dropAllTables()
	os.Exit(code)
}

func initTestDB() {
	host := envOr("TEST_MYSQL_HOST", "127.0.0.1")
	port := envOr("TEST_MYSQL_PORT", "3306")
	user := envOr("TEST_MYSQL_USER", "hive")
	pass := envOr("TEST_MYSQL_PASSWORD", "")
	dbname := envOr("TEST_MYSQL_DB", "hive_registry_test")

	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&collation=utf8mb4_unicode_ci&time_zone=%%27%%2B00%%3A00%%27&timeout=10s&parseTime=true",
		user, pass, host, port, dbname,
	)

	var err error
	testDB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		log.Fatalf("test db open: %v", err)
	}
	sqlDB, _ := testDB.DB()
	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	if err = sqlDB.Ping(); err != nil {
		log.Fatalf("test db ping: %v", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func dropAllTables() {
	testDB.Exec("SET FOREIGN_KEY_CHECKS = 0")
	var tables []string
	testDB.Raw("SHOW TABLES").Scan(&tables)
	for _, t := range tables {
		testDB.Exec("DROP TABLE IF EXISTS `" + t + "`")
	}
	testDB.Exec("SET FOREIGN_KEY_CHECKS = 1")
}

func resetDB(t *testing.T) {
	t.Helper()
	testDB.Exec("SET FOREIGN_KEY_CHECKS = 0")
	for _, table := range []string{
		"ticket_replies", "tickets", "traffic_logs", "customer_subscriptions",
		"orders", "promo_codes", "risk_events", "password_reset_codes", "customers",
		"plan_lines", "plans",
		"line_nodes", "lines",
		"subscription_group_nodes", "subscription_groups",
		"node_status_checks", "nodes",
		"audit_logs",
		"announcements",
		"user_permissions", "user_roles", "role_permissions",
		"users",
	} {
		testDB.Exec("TRUNCATE TABLE `" + table + "`")
	}
	testDB.Exec("SET FOREIGN_KEY_CHECKS = 1")

	store.BootstrapSuperadmin(testDB, testCfg.AdminUser, testCfg.AdminPass)
	store.BootstrapRBAC(testDB)
}

// ── Cookie helpers ───────────────────────────────────────────────────────────

func adminCookie() *http.Cookie {
	exp := time.Now().Add(testCfg.AdminSessionTTL).Unix()
	return &http.Cookie{
		Name:  testCfg.AdminCookieName,
		Value: testAuth.MakeSessionValue(exp, "admin", "superadmin"),
	}
}

func userCookieWithRole(username, role string) *http.Cookie {
	exp := time.Now().Add(testCfg.AdminSessionTTL).Unix()
	return &http.Cookie{
		Name:  testCfg.AdminCookieName,
		Value: testAuth.MakeSessionValue(exp, username, role),
	}
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

func doJSON(method, path string, body any, cookie *http.Cookie) *http.Response {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, testServer.URL+path, reader)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("doJSON %s %s: %v", method, path, err)
	}
	return resp
}

func doBearer(method, path string, body any, token string) *http.Response {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, testServer.URL+path, reader)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("doBearer %s %s: %v", method, path, err)
	}
	return resp
}

// ── Response helpers ─────────────────────────────────────────────────────────

func parseJSON(resp *http.Response) map[string]any {
	defer resp.Body.Close()
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	return m
}

func parseJSONArray(resp *http.Response) []map[string]any {
	defer resp.Body.Close()
	var arr []map[string]any
	json.NewDecoder(resp.Body).Decode(&arr)
	return arr
}

func parseStringArray(resp *http.Response) []string {
	defer resp.Body.Close()
	var arr []string
	json.NewDecoder(resp.Body).Decode(&arr)
	return arr
}

func readBody(resp *http.Response) string {
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func assertStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("status = %d, want %d; body = %s", resp.StatusCode, want, string(body))
	}
}

// ── DB insert helpers ────────────────────────────────────────────────────────

func insertTestNode(t *testing.T, mac string) {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	mac6 := mac
	if len(mac) > 6 {
		mac6 = mac[len(mac)-6:]
	}
	result := testDB.Exec(`INSERT INTO nodes (mac, mac6, hostname, cf_url, xray_uuid, registered_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		mac, mac6, "host-"+mac, "https://"+mac+".example.com", "uuid-"+mac, now, now)
	if result.Error != nil {
		t.Fatalf("insert test node %s: %v", mac, result.Error)
	}
}

func insertTestCustomer(t *testing.T, email string) uint {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	hash, _ := bcrypt.GenerateFromPassword([]byte("test123"), bcrypt.MinCost)
	var id uint
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO customers (email, password_hash, nickname, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`,
			email, string(hash), "nick-"+email, now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&id).Error
	}); err != nil {
		t.Fatalf("insert test customer %s: %v", email, err)
	}
	return id
}

func insertTestPlan(t *testing.T, name string) uint {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	var id uint
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO plans (name, traffic_limit, speed_limit, device_limit, duration_days, price, enabled, sort_order, created_at, updated_at)
		VALUES (?, 107374182400, 100, 3, 30, 1000, 1, 0, ?, ?)`,
			name, now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&id).Error
	}); err != nil {
		t.Fatalf("insert test plan %s: %v", name, err)
	}
	return id
}

func customerCookie(customerID uint) *http.Cookie {
	exp := time.Now().Add(7 * 24 * time.Hour).Unix()
	return &http.Cookie{
		Name:  "hive_customer_session",
		Value: testAuth.MakeCustomerSessionValue(exp, customerID),
	}
}

func expiredCustomerCookie(customerID uint) *http.Cookie {
	exp := time.Now().Add(-1 * time.Hour).Unix()
	return &http.Cookie{
		Name:  "hive_customer_session",
		Value: testAuth.MakeCustomerSessionValue(exp, customerID),
	}
}

func insertTestPromoCode(t *testing.T, code string, discountPct int) uint {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	var id uint
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO promo_codes (code, discount_pct, discount_amt, max_uses, used_count, valid_from, valid_to, enabled, created_at, updated_at)
		VALUES (?, ?, 0, 100, 0, ?, ?, 1, ?, ?)`,
			code, discountPct, "2020-01-01 00:00:00", "2099-12-31 23:59:59", now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&id).Error
	}); err != nil {
		t.Fatalf("insert test promo code %s: %v", code, err)
	}
	return id
}

func createTestUser(t *testing.T, username, password, role string) uint {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	var uid uint
	if err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			username, string(hash), role, now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&uid).Error
	}); err != nil {
		t.Fatalf("create test user %s: %v", username, err)
	}

	var roleID uint
	testDB.Raw("SELECT id FROM roles WHERE name = ?", role).Scan(&roleID)
	if roleID > 0 {
		testDB.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, roleID)
	}
	return uid
}
