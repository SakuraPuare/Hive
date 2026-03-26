package handler

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── request/response types ────────────────────────────────────────────────────

type UpdateOrderStatusRequest struct {
	Status string `json:"status"`
}

type CreatePromoCodeRequest struct {
	Code        string  `json:"code"`
	DiscountPct *int    `json:"discount_pct"`
	DiscountAmt *int    `json:"discount_amt"`
	MaxUses     *int    `json:"max_uses"`
	ValidFrom   *string `json:"valid_from"`
	ValidTo     *string `json:"valid_to"`
	Enabled     *bool   `json:"enabled"`
}

type UpdatePromoCodeRequest struct {
	Code        *string `json:"code"`
	DiscountPct *int    `json:"discount_pct"`
	DiscountAmt *int    `json:"discount_amt"`
	MaxUses     *int    `json:"max_uses"`
	ValidFrom   *string `json:"valid_from"`
	ValidTo     *string `json:"valid_to"`
	Enabled     *bool   `json:"enabled"`
}

type OrderListResponse struct {
	Total int64        `json:"total"`
	Items []model.Order `json:"items"`
}

// ── local helpers ─────────────────────────────────────────────────────────────

func generateOrderNo() string {
	ts := time.Now().UTC().Format("20060102150405")
	b := make([]byte, 2)
	rand.Read(b)
	return fmt.Sprintf("HV%s%x", ts, b)
}

// ── handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) HandleListOrders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	customerID := q.Get("customer_id")
	status := q.Get("status")
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	query := h.DB.Table("orders o")
	if customerID != "" {
		query = query.Where("o.customer_id = ?", customerID)
	}
	if status != "" {
		query = query.Where("o.status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	orders := make([]model.Order, 0)
	if err := query.Select("id, order_no, customer_id, plan_id, amount, original_amount, promo_code_id, status, paid_at, created_at, updated_at").
		Order("o.id DESC").Limit(limit).Offset(offset).Scan(&orders).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, OrderListResponse{Total: total, Items: orders})
}

func (h *Handler) HandleGetOrder(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var o model.Order
	if err := h.DB.Raw(
		"SELECT id, order_no, customer_id, plan_id, amount, original_amount, promo_code_id, status, paid_at, created_at, updated_at FROM orders WHERE id = ?", id).
		Scan(&o).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if o.ID == 0 {
		h.jsonErr(w, http.StatusNotFound, "order not found")
		return
	}
	h.jsonOK(w, o)
}

func (h *Handler) HandleUpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req UpdateOrderStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Status == "" {
		h.jsonErr(w, http.StatusBadRequest, "status required")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	var o model.Order
	if err := h.DB.Raw(
		"SELECT id, order_no, customer_id, plan_id, amount, original_amount, promo_code_id, status, paid_at, created_at, updated_at FROM orders WHERE id = ?", id).
		Scan(&o).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if o.ID == 0 {
		h.jsonErr(w, http.StatusNotFound, "order not found")
		return
	}

	if req.Status == "paid" {
		if err := h.DB.Exec("UPDATE orders SET status=?, paid_at=?, updated_at=? WHERE id=?",
			req.Status, now, now, id).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
	} else {
		if err := h.DB.Exec("UPDATE orders SET status=?, updated_at=? WHERE id=?",
			req.Status, now, id).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
	}

	if req.Status == "paid" && o.Status != "paid" {
		var plan struct {
			DurationDays int   `gorm:"column:duration_days"`
			TrafficLimit int64 `gorm:"column:traffic_limit"`
			DeviceLimit  int   `gorm:"column:device_limit"`
		}
		h.DB.Raw("SELECT duration_days, traffic_limit, device_limit FROM plans WHERE id=?", o.PlanID).Scan(&plan)

		token, err := generateToken()
		if err != nil {
			token = generateOrderNo()
		}
		startedAt := now
		expiresAt := time.Now().UTC().AddDate(0, 0, plan.DurationDays).Format("2006-01-02 15:04:05")
		h.DB.Exec(
			"INSERT INTO customer_subscriptions (customer_id, plan_id, token, traffic_used, traffic_limit, device_limit, started_at, expires_at, status, created_at, updated_at) VALUES (?,?,?,0,?,?,?,?,'active',?,?)",
			o.CustomerID, o.PlanID, token, plan.TrafficLimit, plan.DeviceLimit, startedAt, expiresAt, now, now,
		)

		// 邀请返利
		h.CreateReferralCommission(o)
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "order_status_update",
		fmt.Sprintf("order %s status -> %s", o.OrderNo, req.Status),
		getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

func (h *Handler) HandleListPromoCodes(w http.ResponseWriter, r *http.Request) {
	items := make([]model.PromoCode, 0)
	if err := h.DB.Raw(
		"SELECT id, code, discount_pct, discount_amt, max_uses, used_count, valid_from, valid_to, enabled, created_at, updated_at FROM promo_codes ORDER BY id DESC").
		Scan(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, items)
}

func (h *Handler) HandleCreatePromoCode(w http.ResponseWriter, r *http.Request) {
	var req CreatePromoCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Code == "" || req.ValidFrom == nil || req.ValidTo == nil {
		h.jsonErr(w, http.StatusBadRequest, "code, valid_from, valid_to required")
		return
	}
	enabled := 1
	if req.Enabled != nil && !*req.Enabled {
		enabled = 0
	}
	discountPct := 0
	if req.DiscountPct != nil {
		discountPct = *req.DiscountPct
	}
	discountAmt := 0
	if req.DiscountAmt != nil {
		discountAmt = *req.DiscountAmt
	}
	maxUses := 0
	if req.MaxUses != nil {
		maxUses = *req.MaxUses
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := h.DB.Exec(
		"INSERT INTO promo_codes (code, discount_pct, discount_amt, max_uses, used_count, valid_from, valid_to, enabled, created_at, updated_at) VALUES (?,?,?,?,0,?,?,?,?,?)",
		req.Code, discountPct, discountAmt, maxUses, *req.ValidFrom, *req.ValidTo, enabled, now, now).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	var newID int64
	h.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&newID)

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "promo_code_create", "code: "+req.Code, getClientIP(r))

	h.jsonOK(w, map[string]any{"id": newID})
}

func (h *Handler) HandleUpdatePromoCode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req UpdatePromoCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	updates := map[string]any{"updated_at": now}
	if req.DiscountPct != nil {
		updates["discount_pct"] = *req.DiscountPct
	}
	if req.DiscountAmt != nil {
		updates["discount_amt"] = *req.DiscountAmt
	}
	if req.MaxUses != nil {
		updates["max_uses"] = *req.MaxUses
	}
	if req.ValidFrom != nil {
		updates["valid_from"] = *req.ValidFrom
	}
	if req.ValidTo != nil {
		updates["valid_to"] = *req.ValidTo
	}
	if req.Enabled != nil {
		v := 0
		if *req.Enabled {
			v = 1
		}
		updates["enabled"] = v
	}

	if err := h.DB.Table("promo_codes").Where("id = ?", id).Updates(updates).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "promo_code_update", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

func (h *Handler) HandleDeletePromoCode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.DB.Exec("DELETE FROM promo_codes WHERE id=?", id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "promo_code_delete", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}
