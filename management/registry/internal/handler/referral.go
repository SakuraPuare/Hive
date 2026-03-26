package handler

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// referralCodeAlphabet 排除易混淆字符 0OIl1
const referralCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// generateReferralCode 生成 8 位随机邀请码
func generateReferralCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	code := make([]byte, 8)
	for i := range b {
		code[i] = referralCodeAlphabet[int(b[i])%len(referralCodeAlphabet)]
	}
	return string(code), nil
}

// ensureReferralCode 确保客户有邀请码，没有则生成一个
func (h *Handler) ensureReferralCode(customerID uint) (string, error) {
	var code *string
	h.DB.Raw("SELECT referral_code FROM customers WHERE id = ?", customerID).Scan(&code)
	if code != nil && *code != "" {
		return *code, nil
	}
	for i := 0; i < 5; i++ {
		newCode, err := generateReferralCode()
		if err != nil {
			return "", err
		}
		result := h.DB.Exec("UPDATE customers SET referral_code = ? WHERE id = ? AND (referral_code IS NULL OR referral_code = '')", newCode, customerID)
		if result.Error != nil {
			continue // unique conflict, retry
		}
		if result.RowsAffected > 0 {
			return newCode, nil
		}
		// someone else set it concurrently
		h.DB.Raw("SELECT referral_code FROM customers WHERE id = ?", customerID).Scan(&code)
		if code != nil && *code != "" {
			return *code, nil
		}
	}
	return "", fmt.Errorf("failed to generate unique referral code")
}

// maskNickname 脱敏昵称：保留首尾各一个字符
func maskNickname(s string) string {
	runes := []rune(s)
	if len(runes) <= 2 {
		return string(runes[0:1]) + "**"
	}
	return string(runes[0:1]) + "***" + string(runes[len(runes)-1:])
}

// ── POST /portal/register 扩展：支持 referral_code ──────────────────────────

// ProcessReferralOnRegister 在注册成功后处理邀请关系。
// 由 HandlePortalRegister 调用，传入新客户 ID 和请求中的 referral_code。
func (h *Handler) ProcessReferralOnRegister(newCustomerID uint, referralCode string) {
	if referralCode == "" {
		return
	}
	var referrer struct {
		ID uint
	}
	h.DB.Raw("SELECT id FROM customers WHERE referral_code = ? AND id != ?", referralCode, newCustomerID).Scan(&referrer)
	if referrer.ID == 0 {
		return
	}
	h.DB.Exec("UPDATE customers SET referred_by = ? WHERE id = ? AND referred_by IS NULL",
		referrer.ID, newCustomerID)
}

// ── 支付成功时创建返利记录 ──────────────────────────────────────────────────

// CreateReferralCommission 在订单支付成功时调用，为邀请人创建返利记录。
func (h *Handler) CreateReferralCommission(order model.Order) {
	var referredBy *uint
	h.DB.Raw("SELECT referred_by FROM customers WHERE id = ?", order.CustomerID).Scan(&referredBy)
	if referredBy == nil || *referredBy == 0 {
		return
	}

	rate := h.Config.ReferralRate
	if rate <= 0 || rate > 100 {
		rate = 10
	}
	commission := order.Amount * rate / 100
	if commission <= 0 {
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	orderID := order.ID
	if err := h.DB.Exec(
		"INSERT INTO referrals (referrer_id, referee_id, order_id, commission, status, created_at) VALUES (?,?,?,?,?,?)",
		*referredBy, order.CustomerID, orderID, commission, "pending", now,
	).Error; err != nil {
		return
	}

	// 直接将返利加到邀请人余额
	h.DB.Exec("UPDATE customers SET balance = balance + ? WHERE id = ?", commission, *referredBy)

	// 审计日志
	var email string
	h.DB.Raw("SELECT email FROM customers WHERE id = ?", *referredBy).Scan(&email)
	store.WriteAuditLog(h.DB, email, "referral_commission",
		fmt.Sprintf("order: %s, referee_cid: %d, commission: %d", order.OrderNo, order.CustomerID, commission), "")
}

// ── GET /portal/referral — 我的邀请信息 ─────────────────────────────────────

func (h *Handler) HandlePortalReferral(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)

	code, err := h.ensureReferralCode(cid)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "generate code: "+err.Error())
		return
	}

	var totalInvites int64
	h.DB.Raw("SELECT COUNT(*) FROM customers WHERE referred_by = ?", cid).Scan(&totalInvites)

	var totalCommission int64
	h.DB.Raw("SELECT COALESCE(SUM(commission), 0) FROM referrals WHERE referrer_id = ?", cid).Scan(&totalCommission)

	var balance int
	h.DB.Raw("SELECT balance FROM customers WHERE id = ?", cid).Scan(&balance)

	h.jsonOK(w, map[string]any{
		"referral_code":    code,
		"referral_link":    fmt.Sprintf("?ref=%s", code),
		"total_invites":    totalInvites,
		"total_commission": totalCommission,
		"balance":          balance,
	})
}

// ── GET /portal/referral/records — 我的邀请记录 ─────────────────────────────

func (h *Handler) HandlePortalReferralRecords(w http.ResponseWriter, r *http.Request) {
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
	h.DB.Raw("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", cid).Scan(&total)

	type record struct {
		ID              uint   `json:"id"`
		RefereeNickname string `json:"referee_nickname"`
		Commission      int    `json:"commission"`
		Status          string `json:"status"`
		CreatedAt       string `json:"created_at"`
	}

	var rows []struct {
		ID         uint
		RefereeID  uint
		Commission int
		Status     string
		CreatedAt  string
		Nickname   string
	}
	h.DB.Raw(`
		SELECT r.id, r.referee_id, r.commission, r.status, r.created_at, c.nickname
		FROM referrals r
		LEFT JOIN customers c ON c.id = r.referee_id
		WHERE r.referrer_id = ?
		ORDER BY r.id DESC LIMIT ? OFFSET ?
	`, cid, limit, offset).Scan(&rows)

	records := make([]record, 0, len(rows))
	for _, row := range rows {
		records = append(records, record{
			ID:              row.ID,
			RefereeNickname: maskNickname(row.Nickname),
			Commission:      row.Commission,
			Status:          row.Status,
			CreatedAt:       row.CreatedAt,
		})
	}

	h.jsonOK(w, map[string]any{"total": total, "items": records})
}

// ── GET /admin/referrals — 全局邀请记录列表 ─────────────────────────────────

func (h *Handler) HandleListReferrals(w http.ResponseWriter, r *http.Request) {
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

	status := q.Get("status")

	query := h.DB.Table("referrals")
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	type adminReferral struct {
		model.Referral
		ReferrerEmail string `json:"referrer_email"`
		RefereeEmail  string `json:"referee_email"`
		OrderNo       string `json:"order_no"`
	}

	var rows []struct {
		ID            uint
		ReferrerID    uint
		RefereeID     uint
		OrderID       *uint
		Commission    int
		Status        string
		CreatedAt     string
		ReferrerEmail string
		RefereeEmail  string
		OrderNo       *string
	}
	q2 := h.DB.Raw(`
		SELECT r.id, r.referrer_id, r.referee_id, r.order_id, r.commission, r.status, r.created_at,
		       c1.email AS referrer_email, c2.email AS referee_email, o.order_no
		FROM referrals r
		LEFT JOIN customers c1 ON c1.id = r.referrer_id
		LEFT JOIN customers c2 ON c2.id = r.referee_id
		LEFT JOIN orders o ON o.id = r.order_id
		WHERE 1=1
	`)
	if status != "" {
		q2 = h.DB.Raw(`
			SELECT r.id, r.referrer_id, r.referee_id, r.order_id, r.commission, r.status, r.created_at,
			       c1.email AS referrer_email, c2.email AS referee_email, o.order_no
			FROM referrals r
			LEFT JOIN customers c1 ON c1.id = r.referrer_id
			LEFT JOIN customers c2 ON c2.id = r.referee_id
			LEFT JOIN orders o ON o.id = r.order_id
			WHERE r.status = ?
			ORDER BY r.id DESC LIMIT ? OFFSET ?
		`, status, limit, offset)
	} else {
		q2 = h.DB.Raw(`
			SELECT r.id, r.referrer_id, r.referee_id, r.order_id, r.commission, r.status, r.created_at,
			       c1.email AS referrer_email, c2.email AS referee_email, o.order_no
			FROM referrals r
			LEFT JOIN customers c1 ON c1.id = r.referrer_id
			LEFT JOIN customers c2 ON c2.id = r.referee_id
			LEFT JOIN orders o ON o.id = r.order_id
			ORDER BY r.id DESC LIMIT ? OFFSET ?
		`, limit, offset)
	}
	if err := q2.Scan(&rows).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	items := make([]adminReferral, 0, len(rows))
	for _, row := range rows {
		orderNo := ""
		if row.OrderNo != nil {
			orderNo = *row.OrderNo
		}
		items = append(items, adminReferral{
			Referral: model.Referral{
				ID:         row.ID,
				ReferrerID: row.ReferrerID,
				RefereeID:  row.RefereeID,
				OrderID:    row.OrderID,
				Commission: row.Commission,
				Status:     row.Status,
				CreatedAt:  row.CreatedAt,
			},
			ReferrerEmail: row.ReferrerEmail,
			RefereeEmail:  row.RefereeEmail,
			OrderNo:       orderNo,
		})
	}

	h.jsonOK(w, map[string]any{"total": total, "items": items})
}

// ── PATCH /admin/referrals/{id} — 修改返利状态 ──────────────────────────────

func (h *Handler) HandleUpdateReferral(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Status != "pending" && req.Status != "paid" && req.Status != "cancelled" {
		h.jsonErr(w, http.StatusBadRequest, "status must be pending/paid/cancelled")
		return
	}

	// 查询当前记录
	var ref struct {
		ID         uint
		ReferrerID uint
		Commission int
		Status     string
	}
	h.DB.Raw("SELECT id, referrer_id, commission, status FROM referrals WHERE id = ?", id).Scan(&ref)
	if ref.ID == 0 {
		h.jsonErr(w, http.StatusNotFound, "referral not found")
		return
	}

	oldStatus := ref.Status

	if err := h.DB.Exec("UPDATE referrals SET status = ? WHERE id = ?", req.Status, id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	// 余额调整：如果从 pending 变为 cancelled，扣回余额
	if oldStatus == "pending" && req.Status == "cancelled" {
		h.DB.Exec("UPDATE customers SET balance = GREATEST(balance - ?, 0) WHERE id = ?", ref.Commission, ref.ReferrerID)
		var email string
		h.DB.Raw("SELECT email FROM customers WHERE id = ?", ref.ReferrerID).Scan(&email)
		store.WriteAuditLog(h.DB, email, "referral_balance_deduct",
			fmt.Sprintf("referral_id: %s, amount: %d, reason: cancelled", id, ref.Commission), "")
	}
	// 如果从 cancelled 恢复为 pending，加回余额
	if oldStatus == "cancelled" && req.Status == "pending" {
		h.DB.Exec("UPDATE customers SET balance = balance + ? WHERE id = ?", ref.Commission, ref.ReferrerID)
		var email string
		h.DB.Raw("SELECT email FROM customers WHERE id = ?", ref.ReferrerID).Scan(&email)
		store.WriteAuditLog(h.DB, email, "referral_balance_restore",
			fmt.Sprintf("referral_id: %s, amount: %d", id, ref.Commission), "")
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "referral_status_update",
		fmt.Sprintf("id: %s, %s -> %s", id, oldStatus, req.Status), getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// ── 下单时余额抵扣 ─────────────────────────────────────────────────────────

// ApplyBalanceDeduction 在下单时扣减余额，返回实际抵扣金额。
// amount 是待支付金额（分），返回抵扣后的应付金额和抵扣金额。
func (h *Handler) ApplyBalanceDeduction(customerID uint, amount int) (finalAmount int, deducted int) {
	if amount <= 0 {
		return 0, 0
	}
	var balance int
	h.DB.Raw("SELECT balance FROM customers WHERE id = ?", customerID).Scan(&balance)
	if balance <= 0 {
		return amount, 0
	}
	deducted = balance
	if deducted > amount {
		deducted = amount
	}
	finalAmount = amount - deducted
	h.DB.Exec("UPDATE customers SET balance = balance - ? WHERE id = ?", deducted, customerID)

	var email string
	h.DB.Raw("SELECT email FROM customers WHERE id = ?", customerID).Scan(&email)
	store.WriteAuditLog(h.DB, email, "balance_deduct",
		fmt.Sprintf("amount: %d, remaining: %d", deducted, balance-deducted), "")

	return finalAmount, deducted
}
