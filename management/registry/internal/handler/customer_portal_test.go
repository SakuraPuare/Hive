package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"hive/registry/internal/model"
)

// ═══════════════════════════════════════════════════════════════════════════════
// POST /portal/register
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalRegister_Success(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/register", map[string]string{
		"email":    "new@example.com",
		"password": "secret123",
		"nickname": "新用户",
	}, nil)
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// 验证 DB 中已创建
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM customers WHERE email = ?", "new@example.com").Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 customer, got %d", count)
	}
}

func TestPortalRegister_DefaultNickname(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/register", map[string]string{
		"email":    "nonick@example.com",
		"password": "secret123",
	}, nil)
	assertStatus(t, resp, http.StatusOK)

	var nickname string
	testDB.Raw("SELECT nickname FROM customers WHERE email = ?", "nonick@example.com").Scan(&nickname)
	if nickname != "nonick@example.com" {
		t.Fatalf("expected nickname=nonick@example.com, got %s", nickname)
	}
}

func TestPortalRegister_DuplicateEmail(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "dup@example.com")

	resp := doJSON("POST", "/portal/register", map[string]string{
		"email":    "dup@example.com",
		"password": "secret123",
	}, nil)
	assertStatus(t, resp, http.StatusConflict)
}

func TestPortalRegister_MissingFields(t *testing.T) {
	resetDB(t)

	// 缺少 email
	resp := doJSON("POST", "/portal/register", map[string]string{
		"password": "secret123",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)

	// 缺少 password
	resp = doJSON("POST", "/portal/register", map[string]string{
		"email": "x@example.com",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalRegister_InvalidJSON(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/register", "not json", nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /portal/login
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalLogin_Success(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "login@example.com") // password: test123

	resp := doJSON("POST", "/portal/login", map[string]string{
		"email":    "login@example.com",
		"password": "test123",
	}, nil)
	assertStatus(t, resp, http.StatusOK)

	// 验证 Set-Cookie
	cookies := resp.Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "hive_customer_session" && c.Value != "" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected hive_customer_session cookie to be set")
	}
}

func TestPortalLogin_WrongPassword(t *testing.T) {
	resetDB(t)
	insertTestCustomer(t, "wrong@example.com")

	resp := doJSON("POST", "/portal/login", map[string]string{
		"email":    "wrong@example.com",
		"password": "badpassword",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestPortalLogin_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/login", map[string]string{
		"email":    "noexist@example.com",
		"password": "test123",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestPortalLogin_DisabledAccount(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "disabled@example.com")
	testDB.Exec("UPDATE customers SET status = 'suspended' WHERE id = ?", cid)

	resp := doJSON("POST", "/portal/login", map[string]string{
		"email":    "disabled@example.com",
		"password": "test123",
	}, nil)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestPortalLogin_MissingFields(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/login", map[string]string{
		"email": "x@example.com",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)

	resp = doJSON("POST", "/portal/login", map[string]string{
		"password": "test123",
	}, nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /portal/logout
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalLogout(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/logout", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	// 验证 cookie 被清除
	for _, c := range resp.Cookies() {
		if c.Name == "hive_customer_session" && c.MaxAge == -1 {
			return
		}
	}
	t.Fatal("expected hive_customer_session cookie to be cleared")
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /portal/me
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalMe_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "me@example.com")
	planID := insertTestPlan(t, "测试套餐")
	insertTestSubscription(t, cid, planID, "active", time.Now().Add(30*24*time.Hour))

	resp := doJSON("GET", "/portal/me", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["email"] != "me@example.com" {
		t.Fatalf("expected email=me@example.com, got %v", body["email"])
	}
	subs := body["subscriptions"].([]any)
	if len(subs) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(subs))
	}
}

func TestPortalMe_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/me", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestPortalMe_ExpiredCookie(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "expired@example.com")

	resp := doJSON("GET", "/portal/me", nil, expiredCustomerCookie(cid))
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestPortalMe_DisabledAccount(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "dis@example.com")
	testDB.Exec("UPDATE customers SET status = 'suspended' WHERE id = ?", cid)

	resp := doJSON("GET", "/portal/me", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusForbidden)
}

func TestPortalMe_NoSubscriptions(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "nosub@example.com")

	resp := doJSON("GET", "/portal/me", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	subs := body["subscriptions"].([]any)
	if len(subs) != 0 {
		t.Fatalf("expected 0 subscriptions, got %d", len(subs))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /portal/plans
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalPlans_Public(t *testing.T) {
	resetDB(t)
	insertTestPlan(t, "套餐A")
	insertTestPlan(t, "套餐B")

	// 无需登录
	resp := doJSON("GET", "/portal/plans", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 2 {
		t.Fatalf("expected 2 plans, got %d", len(items))
	}
}

func TestPortalPlans_OnlyEnabled(t *testing.T) {
	resetDB(t)
	pid := insertTestPlan(t, "禁用套餐")
	testDB.Exec("UPDATE plans SET enabled = 0 WHERE id = ?", pid)
	insertTestPlan(t, "启用套餐")

	resp := doJSON("GET", "/portal/plans", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 1 {
		t.Fatalf("expected 1 enabled plan, got %d", len(items))
	}
	if items[0]["name"] != "启用套餐" {
		t.Fatalf("expected name=启用套餐, got %v", items[0]["name"])
	}
}

func TestPortalPlans_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/plans", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 plans, got %d", len(items))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /portal/subscriptions
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalSubscriptions_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "sub@example.com")
	planID := insertTestPlan(t, "套餐X")
	insertTestSubscription(t, cid, planID, "active", time.Now().Add(30*24*time.Hour))
	insertTestSubscription(t, cid, planID, "active", time.Now().Add(30*24*time.Hour))

	resp := doJSON("GET", "/portal/subscriptions", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 2 {
		t.Fatalf("expected 2 subscriptions, got %d", len(items))
	}
}

func TestPortalSubscriptions_Empty(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "empty@example.com")

	resp := doJSON("GET", "/portal/subscriptions", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 subscriptions, got %d", len(items))
	}
}

func TestPortalSubscriptions_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/subscriptions", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestPortalSubscriptions_OnlyOwnData(t *testing.T) {
	resetDB(t)
	cid1 := insertTestCustomer(t, "own1@example.com")
	cid2 := insertTestCustomer(t, "own2@example.com")
	planID := insertTestPlan(t, "套餐Y")
	insertTestSubscription(t, cid1, planID, "active", time.Now().Add(30*24*time.Hour))
	insertTestSubscription(t, cid2, planID, "active", time.Now().Add(30*24*time.Hour))
	insertTestSubscription(t, cid2, planID, "active", time.Now().Add(30*24*time.Hour))

	resp := doJSON("GET", "/portal/subscriptions", nil, customerCookie(cid1))
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 1 {
		t.Fatalf("expected 1 subscription for cid1, got %d", len(items))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /portal/orders
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalCreateOrder_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "order@example.com")
	planID := insertTestPlan(t, "下单套餐")

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id": planID,
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["order_no"] == nil || body["order_no"] == "" {
		t.Fatal("expected order_no in response")
	}
	if body["amount"] == nil {
		t.Fatal("expected amount in response")
	}

	// 验证 DB
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM orders WHERE customer_id = ?", cid).Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 order, got %d", count)
	}
}

func TestPortalCreateOrder_WithPromoCode(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "promo@example.com")
	planID := insertTestPlan(t, "优惠套餐") // price=1000
	insertTestPromoCode(t, "SAVE20", 20)     // 20% off

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "SAVE20",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	amount := int(body["amount"].(float64))
	if amount != 800 {
		t.Fatalf("expected amount=800 (20%% off 1000), got %d", amount)
	}
}

func TestPortalCreateOrder_InvalidPromoCode(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "badpromo@example.com")
	planID := insertTestPlan(t, "套餐Z")

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "NOTEXIST",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_PlanNotFound(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "noplan@example.com")

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id": 99999,
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_PlanDisabled(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "displan@example.com")
	planID := insertTestPlan(t, "禁用套餐")
	testDB.Exec("UPDATE plans SET enabled = 0 WHERE id = ?", planID)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id": planID,
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id": 1,
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestPortalCreateOrder_ExpiredPromoCode(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "exppromo@example.com")
	planID := insertTestPlan(t, "套餐EXP")
	pcID := insertTestPromoCode(t, "EXPIRED", 10)
	testDB.Exec("UPDATE promo_codes SET valid_to = '2020-01-01 00:00:00' WHERE id = ?", pcID)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "EXPIRED",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_DisabledPromoCode(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "dispromo@example.com")
	planID := insertTestPlan(t, "套餐DIS")
	pcID := insertTestPromoCode(t, "DISABLED", 10)
	testDB.Exec("UPDATE promo_codes SET enabled = 0 WHERE id = ?", pcID)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "DISABLED",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_MaxUsesExceeded(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "maxuse@example.com")
	planID := insertTestPlan(t, "套餐MAX")
	pcID := insertTestPromoCode(t, "MAXED", 10)
	testDB.Exec("UPDATE promo_codes SET max_uses = 1, used_count = 1 WHERE id = ?", pcID)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "MAXED",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_DiscountAmt(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "discamt@example.com")
	planID := insertTestPlan(t, "套餐AMT") // price=1000
	now := time.Now().UTC().Format(model.TimeLayout)
	testDB.Exec(`INSERT INTO promo_codes (code, discount_pct, discount_amt, max_uses, used_count, valid_from, valid_to, enabled, created_at, updated_at)
		VALUES ('AMT200', 0, 200, 100, 0, '2020-01-01 00:00:00', '2099-12-31 23:59:59', 1, ?, ?)`, now, now)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "AMT200",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	amount := int(body["amount"].(float64))
	if amount != 800 {
		t.Fatalf("expected amount=800 (1000-200), got %d", amount)
	}
}

func TestPortalCreateOrder_DiscountFloorZero(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "floor@example.com")
	planID := insertTestPlan(t, "套餐FLOOR") // price=1000
	now := time.Now().UTC().Format(model.TimeLayout)
	testDB.Exec(`INSERT INTO promo_codes (code, discount_pct, discount_amt, max_uses, used_count, valid_from, valid_to, enabled, created_at, updated_at)
		VALUES ('HUGE', 0, 9999, 100, 0, '2020-01-01 00:00:00', '2099-12-31 23:59:59', 1, ?, ?)`, now, now)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "HUGE",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	amount := int(body["amount"].(float64))
	if amount != 0 {
		t.Fatalf("expected amount=0 (floor), got %d", amount)
	}
}

func TestPortalCreateOrder_UseBalance(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "balance@example.com")
	planID := insertTestPlan(t, "套餐BAL") // price=1000
	// 给客户充值 500
	testDB.Exec("UPDATE customers SET balance = 500 WHERE id = ?", cid)

	resp := doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":     planID,
		"use_balance": true,
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	balDeducted := int(body["balance_deducted"].(float64))
	if balDeducted == 0 {
		t.Fatal("expected balance_deducted > 0")
	}
}

func TestPortalCreateOrder_MissingPlanID(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "nopid@example.com")

	resp := doJSON("POST", "/portal/orders", map[string]any{}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_InvalidJSON(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "badjson@example.com")

	resp := doJSON("POST", "/portal/orders", "not json", customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateOrder_PromoCodeUsedCountIncremented(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "usecnt@example.com")
	planID := insertTestPlan(t, "套餐CNT")
	insertTestPromoCode(t, "COUNTME", 10)

	doJSON("POST", "/portal/orders", map[string]any{
		"plan_id":    planID,
		"promo_code": "COUNTME",
	}, customerCookie(cid))

	var usedCount int
	testDB.Raw("SELECT used_count FROM promo_codes WHERE code = 'COUNTME'").Scan(&usedCount)
	if usedCount != 1 {
		t.Fatalf("expected used_count=1, got %d", usedCount)
	}
}

func TestPortalCreateTicket_InvalidJSON(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "tjson@example.com")

	resp := doJSON("POST", "/portal/tickets", "not json", customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalReplyTicket_InvalidJSON(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "rjson@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("POST", fmt.Sprintf("/portal/tickets/%d/reply", tid), "not json", customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalLogin_InvalidJSON(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/login", "not json", nil)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalOrders_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "orders@example.com")
	planID := insertTestPlan(t, "订单套餐")

	// 创建两个订单
	doJSON("POST", "/portal/orders", map[string]any{"plan_id": planID}, customerCookie(cid))
	doJSON("POST", "/portal/orders", map[string]any{"plan_id": planID}, customerCookie(cid))

	resp := doJSON("GET", "/portal/orders", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 2 {
		t.Fatalf("expected total=2, got %v", total)
	}
}

func TestPortalOrders_Pagination(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "page@example.com")
	planID := insertTestPlan(t, "分页套餐")

	for i := 0; i < 5; i++ {
		doJSON("POST", "/portal/orders", map[string]any{"plan_id": planID}, customerCookie(cid))
	}

	resp := doJSON("GET", "/portal/orders?page=1&limit=2", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	items := body["items"].([]any)
	if total != 5 {
		t.Fatalf("expected total=5, got %v", total)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items on page 1, got %d", len(items))
	}
}

func TestPortalOrders_OnlyOwnData(t *testing.T) {
	resetDB(t)
	cid1 := insertTestCustomer(t, "o1@example.com")
	cid2 := insertTestCustomer(t, "o2@example.com")
	planID := insertTestPlan(t, "隔离套餐")

	doJSON("POST", "/portal/orders", map[string]any{"plan_id": planID}, customerCookie(cid1))
	doJSON("POST", "/portal/orders", map[string]any{"plan_id": planID}, customerCookie(cid2))
	doJSON("POST", "/portal/orders", map[string]any{"plan_id": planID}, customerCookie(cid2))

	resp := doJSON("GET", "/portal/orders", nil, customerCookie(cid1))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 1 {
		t.Fatalf("expected total=1 for cid1, got %v", total)
	}
}

func TestPortalOrders_Empty(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "noorder@example.com")

	resp := doJSON("GET", "/portal/orders", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 0 {
		t.Fatalf("expected total=0, got %v", total)
	}
}

func TestPortalOrders_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/orders", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /portal/tickets
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalCreateTicket_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "ticket@example.com")

	resp := doJSON("POST", "/portal/tickets", map[string]string{
		"subject": "无法连接",
		"content": "详细描述问题",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["id"] == nil {
		t.Fatal("expected id in response")
	}

	// 验证 DB
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM tickets WHERE customer_id = ?", cid).Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 ticket, got %d", count)
	}

	// 验证初始回复也被创建
	var replyCount int64
	testDB.Raw("SELECT COUNT(*) FROM ticket_replies WHERE ticket_id = ?", int(body["id"].(float64))).Scan(&replyCount)
	if replyCount != 1 {
		t.Fatalf("expected 1 initial reply, got %d", replyCount)
	}
}

func TestPortalCreateTicket_MissingFields(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "miss@example.com")

	// 缺少 subject
	resp := doJSON("POST", "/portal/tickets", map[string]string{
		"content": "内容",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)

	// 缺少 content
	resp = doJSON("POST", "/portal/tickets", map[string]string{
		"subject": "标题",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalCreateTicket_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/tickets", map[string]string{
		"subject": "test",
		"content": "test",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /portal/tickets
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalTickets_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "tlist@example.com")
	insertTestTicket(t, cid)
	insertTestTicket(t, cid)

	resp := doJSON("GET", "/portal/tickets", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 2 {
		t.Fatalf("expected total=2, got %v", total)
	}
}

func TestPortalTickets_OnlyOwnTickets(t *testing.T) {
	resetDB(t)
	cid1 := insertTestCustomer(t, "t1@example.com")
	cid2 := insertTestCustomer(t, "t2@example.com")
	insertTestTicket(t, cid1)
	insertTestTicket(t, cid2)
	insertTestTicket(t, cid2)

	resp := doJSON("GET", "/portal/tickets", nil, customerCookie(cid1))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 1 {
		t.Fatalf("expected total=1 for cid1, got %v", total)
	}
}

func TestPortalTickets_Pagination(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "tpage@example.com")
	for i := 0; i < 5; i++ {
		insertTestTicket(t, cid)
	}

	resp := doJSON("GET", "/portal/tickets?page=1&limit=2", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	items := body["items"].([]any)
	if total != 5 {
		t.Fatalf("expected total=5, got %v", total)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items on page 1, got %d", len(items))
	}
}

func TestPortalTickets_Empty(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "tempty@example.com")

	resp := doJSON("GET", "/portal/tickets", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 0 {
		t.Fatalf("expected total=0, got %v", total)
	}
}

func TestPortalTickets_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/tickets", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /portal/tickets/{id}
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalGetTicket_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "tdetail@example.com")
	tid := insertTestTicket(t, cid)

	// 添加一条回复
	now := time.Now().UTC().Format(model.TimeLayout)
	testDB.Exec(`INSERT INTO ticket_replies (ticket_id, author, is_admin, content, created_at)
		VALUES (?, 'admin', 1, '管理员回复', ?)`, tid, now)

	resp := doJSON("GET", fmt.Sprintf("/portal/tickets/%d", tid), nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	ticket := body["ticket"].(map[string]any)
	if ticket["subject"] != "Test Subject" {
		t.Fatalf("expected subject=Test Subject, got %v", ticket["subject"])
	}
	replies := body["replies"].([]any)
	if len(replies) != 1 {
		t.Fatalf("expected 1 reply, got %d", len(replies))
	}
}

func TestPortalGetTicket_NotOwned(t *testing.T) {
	resetDB(t)
	cid1 := insertTestCustomer(t, "owner@example.com")
	cid2 := insertTestCustomer(t, "other@example.com")
	tid := insertTestTicket(t, cid1)

	// cid2 尝试查看 cid1 的工单
	resp := doJSON("GET", fmt.Sprintf("/portal/tickets/%d", tid), nil, customerCookie(cid2))
	assertStatus(t, resp, http.StatusNotFound)
}

func TestPortalGetTicket_NotFound(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "nf@example.com")

	resp := doJSON("GET", "/portal/tickets/99999", nil, customerCookie(cid))
	assertStatus(t, resp, http.StatusNotFound)
}

func TestPortalGetTicket_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/tickets/1", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /portal/tickets/{id}/reply
// ═══════════════════════════════════════════════════════════════════════════════

func TestPortalReplyTicket_Success(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "reply@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("POST", fmt.Sprintf("/portal/tickets/%d/reply", tid), map[string]string{
		"content": "客户回复内容",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusOK)

	// 验证回复已创建
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM ticket_replies WHERE ticket_id = ?", tid).Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 reply, got %d", count)
	}

	// 验证 is_admin = 0
	var isAdmin int
	testDB.Raw("SELECT is_admin FROM ticket_replies WHERE ticket_id = ? ORDER BY id DESC LIMIT 1", tid).Scan(&isAdmin)
	if isAdmin != 0 {
		t.Fatal("expected is_admin=0 for customer reply")
	}

	// 验证工单状态变为 open
	var status string
	testDB.Raw("SELECT status FROM tickets WHERE id = ?", tid).Scan(&status)
	if status != "open" {
		t.Fatalf("expected ticket status=open after reply, got %s", status)
	}
}

func TestPortalReplyTicket_NotOwned(t *testing.T) {
	resetDB(t)
	cid1 := insertTestCustomer(t, "rowner@example.com")
	cid2 := insertTestCustomer(t, "rother@example.com")
	tid := insertTestTicket(t, cid1)

	resp := doJSON("POST", fmt.Sprintf("/portal/tickets/%d/reply", tid), map[string]string{
		"content": "不应该成功",
	}, customerCookie(cid2))
	assertStatus(t, resp, http.StatusNotFound)
}

func TestPortalReplyTicket_EmptyContent(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "rempty@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("POST", fmt.Sprintf("/portal/tickets/%d/reply", tid), map[string]string{
		"content": "",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestPortalReplyTicket_NotFound(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "rnf@example.com")

	resp := doJSON("POST", "/portal/tickets/99999/reply", map[string]string{
		"content": "test",
	}, customerCookie(cid))
	assertStatus(t, resp, http.StatusNotFound)
}

func TestPortalReplyTicket_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/portal/tickets/1/reply", map[string]string{
		"content": "test",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ═══════════════════════════════════════════════════════════════════════════════
// requireCustomer 中间件
// ═══════════════════════════════════════════════════════════════════════════════

func TestRequireCustomer_InvalidSignature(t *testing.T) {
	resetDB(t)

	cookie := &http.Cookie{
		Name:  "hive_customer_session",
		Value: "9999999999.1.invalidsig",
	}
	resp := doJSON("GET", "/portal/me", nil, cookie)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func TestRequireCustomer_MalformedCookie(t *testing.T) {
	resetDB(t)

	cookie := &http.Cookie{
		Name:  "hive_customer_session",
		Value: "garbage",
	}
	resp := doJSON("GET", "/portal/me", nil, cookie)
	assertStatus(t, resp, http.StatusUnauthorized)
}
