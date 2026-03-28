package handler

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"gorm.io/gorm"

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

// HandleListOrders godoc
// @Summary      获取订单列表
// @ID           AdminListOrders
// @Description  分页获取订单列表，支持按客户和状态筛选
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        customer_id query string false "按客户 ID 筛选"
// @Param        status      query string false "按状态筛选"
// @Param        page        query int    false "页码（默认 1）"
// @Param        limit       query int    false "每页数量（默认 20，最大 100）"
// @Success      200 {object} OrderListResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/orders [get]
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

// HandleGetOrder godoc
// @Summary      获取订单详情
// @ID           AdminGetOrder
// @Description  根据 ID 获取单个订单
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        id path int true "订单 ID"
// @Success      200 {object} model.Order
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/orders/{id} [get]
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

// HandleUpdateOrderStatus godoc
// @Summary      更新订单状态
// @ID           AdminUpdateOrderStatus
// @Description  更新指定订单的状态，若改为 paid 则自动创建订阅
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        id   path int                    true "订单 ID"
// @Param        body body UpdateOrderStatusRequest true "新状态"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/orders/{id}/status [patch]
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

	now := time.Now().UTC().Format(model.TimeLayout)

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
		if err := h.DB.Raw("SELECT duration_days, traffic_limit, device_limit FROM plans WHERE id=?", o.PlanID).Scan(&plan).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}

		token, err := generateToken()
		if err != nil {
			token = generateOrderNo()
		}
		startedAt := now
		expiresAt := time.Now().UTC().AddDate(0, 0, plan.DurationDays).Format(model.TimeLayout)
		if err := h.DB.Exec(
			"INSERT INTO customer_subscriptions (customer_id, plan_id, token, traffic_used, traffic_limit, device_limit, started_at, expires_at, status, created_at, updated_at) VALUES (?,?,?,0,?,?,?,?,'active',?,?)",
			o.CustomerID, o.PlanID, token, plan.TrafficLimit, plan.DeviceLimit, startedAt, expiresAt, now, now,
		).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}

		// 邀请返利
		h.CreateReferralCommission(o)
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "order_status_update",
		fmt.Sprintf("order %s status -> %s", o.OrderNo, req.Status),
		getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleListPromoCodes godoc
// @Summary      获取优惠码列表
// @ID           AdminListPromoCodes
// @Description  获取所有优惠码，按 ID 倒序排列
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {array}  model.PromoCode
// @Failure      500 {object} ErrorResponse
// @Router       /admin/promo-codes [get]
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

// HandleCreatePromoCode godoc
// @Summary      创建优惠码
// @ID           AdminCreatePromoCode
// @Description  创建新的优惠码
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        body body CreatePromoCodeRequest true "优惠码信息"
// @Success      200 {object} CreateIDResponse
// @Failure      400 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/promo-codes [post]
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
	now := time.Now().UTC().Format(model.TimeLayout)
	var newID int64
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			"INSERT INTO promo_codes (code, discount_pct, discount_amt, max_uses, used_count, valid_from, valid_to, enabled, created_at, updated_at) VALUES (?,?,?,?,0,?,?,?,?,?)",
			req.Code, discountPct, discountAmt, maxUses, *req.ValidFrom, *req.ValidTo, enabled, now, now).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&newID).Error
	}); err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "promo_code_create", "code: "+req.Code, getClientIP(r))

	h.jsonOK(w, map[string]any{"id": newID})
}

// HandleUpdatePromoCode godoc
// @Summary      更新优惠码
// @ID           AdminUpdatePromoCode
// @Description  按 ID 更新优惠码字段
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        id   path int                   true "优惠码 ID"
// @Param        body body UpdatePromoCodeRequest true "要更新的字段"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/promo-codes/{id} [patch]
func (h *Handler) HandleUpdatePromoCode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req UpdatePromoCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	now := time.Now().UTC().Format(model.TimeLayout)
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

// HandleDeletePromoCode godoc
// @Summary      删除优惠码
// @ID           AdminDeletePromoCode
// @Description  按 ID 删除优惠码
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        id path int true "优惠码 ID"
// @Success      200 {object} StatusResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/promo-codes/{id} [delete]
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
