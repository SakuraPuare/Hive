package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/crypto/bcrypt"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── 客户门户请求/响应类型 ────────────────────────────────────────────────────

type portalRegisterRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	Nickname     string `json:"nickname"`
	ReferralCode string `json:"referral_code"`
}

type portalLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type portalOrderRequest struct {
	PlanID     uint   `json:"plan_id"`
	PromoCode  string `json:"promo_code"`
	UseBalance bool   `json:"use_balance"`
}

type portalTicketRequest struct {
	Subject string `json:"subject"`
	Content string `json:"content"`
}

type portalReplyRequest struct {
	Content string `json:"content"`
}

type portalMeResponse struct {
	ID        uint                        `json:"id"`
	Email     string                      `json:"email"`
	Nickname  string                      `json:"nickname"`
	Status    string                      `json:"status"`
	CreatedAt string                      `json:"created_at"`
	Subs      []model.CustomerSubscription `json:"subscriptions"`
}

// ── 客户认证中间件 ──────────────────────────────────────────────────────────

// requireCustomer 验证客户 session cookie，将 customerID 注入 header 供后续使用。
func (h *Handler) requireCustomer(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cid, ok := h.Auth.ParseCustomerSession(r)
		if !ok {
			h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		// 检查客户状态
		var status string
		h.DB.Raw("SELECT status FROM customers WHERE id = ?", cid).Scan(&status)
		if status != "active" {
			h.jsonErr(w, http.StatusForbidden, "account disabled")
			return
		}
		r.Header.Set("X-Customer-ID", strconv.FormatUint(uint64(cid), 10))
		next(w, r)
	}
}

// customerID 从 header 中提取已验证的客户 ID。
func customerID(r *http.Request) uint {
	id, _ := strconv.ParseUint(r.Header.Get("X-Customer-ID"), 10, 64)
	return uint(id)
}

// ── POST /portal/register — 客户自助注册 ────────────────────────────────────

func (h *Handler) HandlePortalRegister(w http.ResponseWriter, r *http.Request) {
	var req portalRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Email == "" || req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "required: email, password")
		return
	}

	// 检查 email 唯一性
	var exists int64
	h.DB.Raw("SELECT COUNT(*) FROM customers WHERE email = ?", req.Email).Scan(&exists)
	if exists > 0 {
		h.jsonErr(w, http.StatusConflict, "email already registered")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	nickname := req.Nickname
	if nickname == "" {
		nickname = req.Email
	}

	result := h.DB.Exec(
		"INSERT INTO customers (email, password_hash, nickname, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
		req.Email, string(hash), nickname, "active", now, now,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}

	// 处理邀请关系
	var newCID uint
	h.DB.Raw("SELECT id FROM customers WHERE email = ?", req.Email).Scan(&newCID)
	if newCID > 0 {
		h.ProcessReferralOnRegister(newCID, req.ReferralCode)
	}

	store.WriteAuditLog(h.DB, req.Email, "customer_register", "", getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// ── POST /portal/login — 客户登录 ──────────────────────────────────────────

func (h *Handler) HandlePortalLogin(w http.ResponseWriter, r *http.Request) {
	var req portalLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Email == "" || req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "required: email, password")
		return
	}

	ip := getClientIP(r)

	var c struct {
		ID           uint
		PasswordHash string
		Status       string
	}
	if err := h.DB.Table("customers").Select("id, password_hash, status").
		Where("email = ?", req.Email).Scan(&c).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if c.ID == 0 {
		store.WriteAuditLog(h.DB, req.Email, "customer_login_fail", "not found", ip)
		h.jsonErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if c.Status != "active" {
		store.WriteAuditLog(h.DB, req.Email, "customer_login_fail", "account disabled", ip)
		h.jsonErr(w, http.StatusForbidden, "account disabled")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(c.PasswordHash), []byte(req.Password)) != nil {
		store.WriteAuditLog(h.DB, req.Email, "customer_login_fail", "wrong password", ip)
		h.jsonErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// 签发 cookie，有效期 7 天
	exp := time.Now().UTC().Add(7 * 24 * time.Hour).Unix()
	token := h.Auth.MakeCustomerSessionValue(exp, c.ID)

	secure := isSecureRequest(r)
	http.SetCookie(w, &http.Cookie{
		Name:     "hive_customer_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: h.Auth.Config.AdminCookieSameSite,
		MaxAge:   7 * 24 * 3600,
	})

	store.WriteAuditLog(h.DB, req.Email, "customer_login", "", ip)
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// ── POST /portal/logout — 客户登出 ─────────────────────────────────────────

func (h *Handler) HandlePortalLogout(w http.ResponseWriter, r *http.Request) {
	secure := isSecureRequest(r)
	http.SetCookie(w, &http.Cookie{
		Name:     "hive_customer_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: h.Auth.Config.AdminCookieSameSite,
		MaxAge:   -1,
	})
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// ── GET /portal/me — 当前客户信息 + 活跃订阅 ────────────────────────────────

func (h *Handler) HandlePortalMe(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)

	var c model.Customer
	if err := h.DB.Raw("SELECT id, email, nickname, status, created_at, updated_at FROM customers WHERE id = ?", cid).Scan(&c).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	subs := make([]model.CustomerSubscription, 0)
	h.DB.Raw("SELECT * FROM customer_subscriptions WHERE customer_id = ? AND status = 'active' ORDER BY id DESC", cid).Scan(&subs)

	h.jsonOK(w, portalMeResponse{
		ID:        c.ID,
		Email:     c.Email,
		Nickname:  c.Nickname,
		Status:    c.Status,
		CreatedAt: c.CreatedAt,
		Subs:      subs,
	})
}

// ── GET /portal/plans — 公开套餐列表 ────────────────────────────────────────

func (h *Handler) HandlePortalPlans(w http.ResponseWriter, r *http.Request) {
	plans := make([]model.Plan, 0)
	if err := h.DB.Raw("SELECT * FROM plans WHERE enabled = 1 ORDER BY sort_order, id").Scan(&plans).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, plans)
}

// ── GET /portal/subscriptions — 当前客户的所有订阅 ──────────────────────────

func (h *Handler) HandlePortalSubscriptions(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	subs := make([]model.CustomerSubscription, 0)
	if err := h.DB.Raw("SELECT * FROM customer_subscriptions WHERE customer_id = ? ORDER BY id DESC", cid).Scan(&subs).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, subs)
}

// ── POST /portal/orders — 客户下单 ─────────────────────────────────────────

func (h *Handler) HandlePortalCreateOrder(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)

	var req portalOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.PlanID == 0 {
		h.jsonErr(w, http.StatusBadRequest, "required: plan_id")
		return
	}

	// 验证套餐存在且启用
	var plan model.Plan
	h.DB.Raw("SELECT * FROM plans WHERE id = ? AND enabled = 1", req.PlanID).Scan(&plan)
	if plan.ID == 0 {
		h.jsonErr(w, http.StatusBadRequest, "plan not found or disabled")
		return
	}

	originalAmount := plan.Price
	finalAmount := originalAmount
	var promoCodeID *uint

	// 应用优惠码
	if req.PromoCode != "" {
		var promo model.PromoCode
		now := time.Now().UTC().Format("2006-01-02 15:04:05")
		h.DB.Raw(
			"SELECT * FROM promo_codes WHERE code = ? AND enabled = 1 AND (valid_from = '' OR valid_from <= ?) AND (valid_to = '' OR valid_to >= ?) AND (max_uses = 0 OR used_count < max_uses)",
			req.PromoCode, now, now,
		).Scan(&promo)
		if promo.ID == 0 {
			h.jsonErr(w, http.StatusBadRequest, "invalid or expired promo code")
			return
		}
		if promo.DiscountPct > 0 {
			finalAmount = originalAmount * (100 - promo.DiscountPct) / 100
		}
		if promo.DiscountAmt > 0 {
			finalAmount -= promo.DiscountAmt
		}
		if finalAmount < 0 {
			finalAmount = 0
		}
		promoCodeID = &promo.ID
	}

	// 余额抵扣
	var balanceDeducted int
	if req.UseBalance && finalAmount > 0 {
		finalAmount, balanceDeducted = h.ApplyBalanceDeduction(cid, finalAmount)
	}

	orderNo := generateOrderNo()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	if err := h.DB.Exec(
		"INSERT INTO orders (order_no, customer_id, plan_id, amount, original_amount, promo_code_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
		orderNo, cid, plan.ID, finalAmount, originalAmount, promoCodeID, "pending", now, now,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	// 优惠码使用次数 +1
	if promoCodeID != nil {
		h.DB.Exec("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?", *promoCodeID)
	}

	// 查询客户 email 用于审计
	var email string
	h.DB.Raw("SELECT email FROM customers WHERE id = ?", cid).Scan(&email)
	store.WriteAuditLog(h.DB, email, "portal_order_create", fmt.Sprintf("order: %s, plan: %d", orderNo, plan.ID), getClientIP(r))

	h.jsonOK(w, map[string]any{"order_no": orderNo, "amount": finalAmount, "original_amount": originalAmount, "balance_deducted": balanceDeducted})
}

// ── GET /portal/orders — 当前客户的订单列表 ─────────────────────────────────

func (h *Handler) HandlePortalOrders(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int64
	h.DB.Raw("SELECT COUNT(*) FROM orders WHERE customer_id = ?", cid).Scan(&total)

	orders := make([]model.Order, 0)
	h.DB.Raw("SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?", cid, limit, offset).Scan(&orders)

	h.jsonOK(w, map[string]any{"total": total, "items": orders})
}

// ── POST /portal/tickets — 提交工单 ────────────────────────────────────────

func (h *Handler) HandlePortalCreateTicket(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)

	var req portalTicketRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Subject == "" || req.Content == "" {
		h.jsonErr(w, http.StatusBadRequest, "required: subject, content")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	result := h.DB.Exec(
		"INSERT INTO tickets (customer_id, subject, status, created_at, updated_at) VALUES (?,?,?,?,?)",
		cid, req.Subject, "open", now, now,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}

	ticketID := result.Statement.Dest
	// 获取插入的 ticket ID
	var tid uint
	h.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&tid)

	// 插入首条内容作为回复
	var email string
	h.DB.Raw("SELECT email FROM customers WHERE id = ?", cid).Scan(&email)
	h.DB.Exec(
		"INSERT INTO ticket_replies (ticket_id, author, is_admin, content, created_at) VALUES (?,?,0,?,?)",
		tid, email, req.Content, now,
	)
	_ = ticketID

	store.WriteAuditLog(h.DB, email, "portal_ticket_create", fmt.Sprintf("ticket_id: %d", tid), getClientIP(r))

	h.jsonOK(w, map[string]any{"id": tid})
}

// ── GET /portal/tickets — 当前客户的工单列表 ────────────────────────────────

func (h *Handler) HandlePortalTickets(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int64
	h.DB.Raw("SELECT COUNT(*) FROM tickets WHERE customer_id = ?", cid).Scan(&total)

	tickets := make([]model.Ticket, 0)
	h.DB.Raw(
		"SELECT t.id, t.customer_id, COALESCE(c.email,'') AS customer_email, t.subject, t.status, t.created_at, t.updated_at "+
			"FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.customer_id = ? ORDER BY t.id DESC LIMIT ? OFFSET ?",
		cid, limit, offset,
	).Scan(&tickets)

	h.jsonOK(w, map[string]any{"total": total, "items": tickets})
}

// ── GET /portal/tickets/{id} — 工单详情+回复 ────────────────────────────────

func (h *Handler) HandlePortalGetTicket(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	id := r.PathValue("id")

	var t model.Ticket
	h.DB.Raw(
		"SELECT t.id, t.customer_id, COALESCE(c.email,'') AS customer_email, t.subject, t.status, t.created_at, t.updated_at "+
			"FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.id = ? AND t.customer_id = ?",
		id, cid,
	).Scan(&t)
	if t.ID == 0 {
		h.jsonErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	var rows []ticketReplyRow
	h.DB.Raw(
		"SELECT id, ticket_id, author, is_admin, content, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY id ASC", id,
	).Scan(&rows)

	replies := make([]model.TicketReply, 0, len(rows))
	for _, row := range rows {
		replies = append(replies, model.TicketReply{
			ID:        row.ID,
			TicketID:  row.TicketID,
			Author:    row.Author,
			IsAdmin:   row.IsAdmin == 1,
			Content:   row.Content,
			CreatedAt: row.CreatedAt,
		})
	}

	h.jsonOK(w, TicketDetailResponse{Ticket: t, Replies: replies})
}

// ── POST /portal/tickets/{id}/reply — 客户回复工单 ──────────────────────────

func (h *Handler) HandlePortalReplyTicket(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	id := r.PathValue("id")

	var req portalReplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Content == "" {
		h.jsonErr(w, http.StatusBadRequest, "content required")
		return
	}

	// 验证工单属于当前客户
	var ticketID uint
	h.DB.Raw("SELECT id FROM tickets WHERE id = ? AND customer_id = ?", id, cid).Scan(&ticketID)
	if ticketID == 0 {
		h.jsonErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	var email string
	h.DB.Raw("SELECT email FROM customers WHERE id = ?", cid).Scan(&email)

	if err := h.DB.Exec(
		"INSERT INTO ticket_replies (ticket_id, author, is_admin, content, created_at) VALUES (?,?,0,?,?)",
		id, email, req.Content, now,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	// 更新工单状态为 open（客户回复后重新打开）
	h.DB.Exec("UPDATE tickets SET status='open', updated_at=? WHERE id=?", now, id)

	h.jsonOK(w, map[string]string{"status": "ok"})
}
