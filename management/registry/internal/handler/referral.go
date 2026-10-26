package handler

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"hive/registry/internal/model"
	"hive/registry/internal/store"

	"gorm.io/gorm"
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
	if err := h.DB.Raw("SELECT referral_code FROM customers WHERE id = ?", customerID).Scan(&code).Error; err != nil {
		return "", fmt.Errorf("query referral_code: %w", err)
	}
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
		if err := h.DB.Raw("SELECT referral_code FROM customers WHERE id = ?", customerID).Scan(&code).Error; err != nil {
			return "", fmt.Errorf("re-read referral_code: %w", err)
		}
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

// ── swagger types ────────────────────────────────────────────────────────────

// PortalReferralResponse is the response for GET /portal/referral.
type PortalReferralResponse struct {
	ReferralCode    string `json:"referral_code" example:"ABCD1234"`
	ReferralLink    string `json:"referral_link" example:"?ref=ABCD1234"`
	TotalInvites    int64  `json:"total_invites" example:"5"`
	TotalCommission int64  `json:"total_commission" example:"1000"`
	Balance         int    `json:"balance" example:"500"`
}

// PortalReferralRecord is a single referral record for the portal.
type PortalReferralRecord struct {
	ID              uint   `json:"id"`
	RefereeNickname string `json:"referee_nickname"`
	Commission      int    `json:"commission"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
}

// PortalReferralRecordsResponse is the response for GET /portal/referral/records.
type PortalReferralRecordsResponse struct {
	Total int64                  `json:"total"`
	Items []PortalReferralRecord `json:"items"`
}

// AdminReferralItem is a single referral record for admin listing.
type AdminReferralItem struct {
	model.Referral
	ReferrerEmail string `json:"referrer_email"`
	RefereeEmail  string `json:"referee_email"`
	OrderNo       string `json:"order_no"`
}

// AdminReferralListResponse is the response for GET /admin/referrals.
type AdminReferralListResponse struct {
	Total int64               `json:"total"`
	Items []AdminReferralItem `json:"items"`
}

// UpdateReferralRequest is the request body for PATCH /admin/referrals/{id}.
type UpdateReferralRequest struct {
	Status string `json:"status" example:"paid"`
}

// referralDBRow is the DB row used when building admin referral items.
type referralDBRow struct {
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

// referralRecordDBRow is the DB row used when building portal referral records.
type referralRecordDBRow struct {
	ID         uint
	RefereeID  uint
	Commission int
	Status     string
	CreatedAt  string
	Nickname   string
}

// referralLookupRow is used to look up a referral for status updates.
type referralLookupRow struct {
	ID         uint
	ReferrerID uint
	Commission int
	Status     string
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
	if err := h.DB.Raw("SELECT id FROM customers WHERE referral_code = ? AND id != ?", referralCode, newCustomerID).Scan(&referrer).Error; err != nil {
		log.Printf("referral: lookup referrer by code %s: %v", referralCode, err)
		return
	}
	if referrer.ID == 0 {
		return
	}
	if err := h.DB.Exec("UPDATE customers SET referred_by = ? WHERE id = ? AND referred_by IS NULL",
		referrer.ID, newCustomerID).Error; err != nil {
		log.Printf("referral: set referred_by for customer %d: %v", newCustomerID, err)
	}
}

// ── 支付成功时创建返利记录 ──────────────────────────────────────────────────

// ── GET /portal/referral — 我的邀请信息 ─────────────────────────────────────

// HandlePortalReferral godoc
// @Summary      获取我的邀请信息
// @ID           PortalReferral
// @Description  返回当前客户的邀请码、邀请链接、邀请人数、累计返利和余额
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Success      200 {object} PortalReferralResponse
// @Failure      500 {object} ErrorResponse
// @Router       /portal/referral [get]
func (h *Handler) HandlePortalReferral(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)

	code, err := h.ensureReferralCode(cid)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "generate code: "+err.Error())
		return
	}

	var totalInvites int64
	if err := h.DB.Raw("SELECT COUNT(*) FROM customers WHERE referred_by = ?", cid).Scan(&totalInvites).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	var totalCommission int64
	if err := h.DB.Raw("SELECT COALESCE(SUM(commission), 0) FROM referrals WHERE referrer_id = ?", cid).Scan(&totalCommission).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	var balance int
	if err := h.DB.Raw("SELECT balance FROM customers WHERE id = ?", cid).Scan(&balance).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, map[string]any{
		"referral_code":    code,
		"referral_link":    fmt.Sprintf("?ref=%s", code),
		"total_invites":    totalInvites,
		"total_commission": totalCommission,
		"balance":          balance,
	})
}

// ── GET /portal/referral/records — 我的邀请记录 ─────────────────────────────

// HandlePortalReferralRecords godoc
// @Summary      获取我的邀请记录
// @ID           PortalReferralRecords
// @Description  分页返回当前客户的邀请记录列表
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        page  query int false "页码（默认 1）"
// @Param        limit query int false "每页数量（默认 20，最大 100）"
// @Success      200 {object} PortalReferralRecordsResponse
// @Failure      500 {object} ErrorResponse
// @Router       /portal/referral/records [get]
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
	if err := h.DB.Raw("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", cid).Scan(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	var rows []referralRecordDBRow
	if err := h.DB.Raw(`
		SELECT r.id, r.referee_id, r.commission, r.status, r.created_at, c.nickname
		FROM referrals r
		LEFT JOIN customers c ON c.id = r.referee_id
		WHERE r.referrer_id = ?
		ORDER BY r.id DESC LIMIT ? OFFSET ?
	`, cid, limit, offset).Scan(&rows).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	records := make([]PortalReferralRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, PortalReferralRecord{
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

// HandleListReferrals godoc
// @Summary      获取邀请记录列表
// @ID           AdminListReferrals
// @Description  分页获取全局邀请记录，支持按状态筛选
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        page   query int    false "页码（默认 1）"
// @Param        limit  query int    false "每页数量（默认 20，最大 100）"
// @Param        status query string false "按状态筛选"
// @Success      200 {object} AdminReferralListResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/referrals [get]
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

	var rows []referralDBRow
	var q2 *gorm.DB
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

	items := make([]AdminReferralItem, 0, len(rows))
	for _, row := range rows {
		orderNo := ""
		if row.OrderNo != nil {
			orderNo = *row.OrderNo
		}
		items = append(items, AdminReferralItem{
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

// HandleUpdateReferral godoc
// @Summary      更新邀请记录状态
// @ID           AdminUpdateReferral
// @Description  修改指定邀请记录的状态（pending/paid/cancelled），自动调整余额
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        id   path int                  true "邀请记录 ID"
// @Param        body body UpdateReferralRequest true "新状态"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/referrals/{id} [patch]
func (h *Handler) HandleUpdateReferral(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req UpdateReferralRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Status != "pending" && req.Status != "paid" && req.Status != "cancelled" {
		h.jsonErr(w, http.StatusBadRequest, "status must be pending/paid/cancelled")
		return
	}

	rid, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		h.jsonErr(w, 400, "invalid referral id")
		return
	}
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		// Lock the order first, matching the refund path's lock order.
		var orderID *uint
		if err := tx.Raw("SELECT order_id FROM referrals WHERE id = ?", rid).Scan(&orderID).Error; err != nil {
			return err
		}
		if orderID != nil {
			var status string
			if err := tx.Raw("SELECT status FROM orders WHERE id = ? FOR UPDATE", *orderID).Scan(&status).Error; err != nil {
				return err
			}
			if status != "paid" && req.Status != "cancelled" {
				return orderInvalid("order is not paid")
			}
		}
		return changeReferralStatus(tx, uint(rid), req.Status)
	})
	if err != nil {
		h.orderError(w, err)
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "referral_status_update", fmt.Sprintf("id: %s -> %s", id, req.Status), getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}
