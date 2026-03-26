package handler

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── lifecycle loop ───────────────────────────────────────────────────────────

// StartLifecycleLoop runs subscription lifecycle tasks every 10 minutes.
func (h *Handler) StartLifecycleLoop() {
	time.Sleep(10 * time.Second)
	log.Println("lifecycle: starting subscription lifecycle loop (interval=10m)")

	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	h.runLifecycleTasks()
	for range ticker.C {
		h.runLifecycleTasks()
	}
}

func (h *Handler) runLifecycleTasks() {
	now := time.Now().UTC()
	nowStr := now.Format(model.TimeLayout)

	// 1. 过期检测
	h.expireSubscriptions(nowStr)

	// 2. 流量超限
	h.suspendOverTraffic(nowStr)

	// 3. 客户状态同步
	h.syncCustomerStatus(nowStr)

	// 4. 过期订单清理
	h.cancelStaleOrders(nowStr)

	// 5. 流量重置（每月1日）
	h.resetMonthlyTraffic(now, nowStr)
}

// expireSubscriptions marks active subscriptions past their expiry as expired.
func (h *Handler) expireSubscriptions(nowStr string) {
	result := h.DB.Exec(
		"UPDATE customer_subscriptions SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at < ?",
		nowStr, nowStr,
	)
	if result.Error != nil {
		log.Printf("lifecycle: expire subscriptions: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("lifecycle: expired %d subscriptions", result.RowsAffected)
		store.WriteAuditLog(h.DB, "system", "subscription_auto_expire",
			fmt.Sprintf("count: %d", result.RowsAffected), "")
	}
}

// suspendOverTraffic suspends active subscriptions that exceeded their traffic limit.
func (h *Handler) suspendOverTraffic(nowStr string) {
	result := h.DB.Exec(
		"UPDATE customer_subscriptions SET status = 'suspended', updated_at = ? WHERE status = 'active' AND traffic_limit > 0 AND traffic_used >= traffic_limit",
		nowStr,
	)
	if result.Error != nil {
		log.Printf("lifecycle: suspend over-traffic: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("lifecycle: suspended %d subscriptions (traffic exceeded)", result.RowsAffected)
		store.WriteAuditLog(h.DB, "system", "subscription_auto_suspend_traffic",
			fmt.Sprintf("count: %d", result.RowsAffected), "")
	}
}

// syncCustomerStatus suspends customers whose subscriptions are all expired/suspended.
func (h *Handler) syncCustomerStatus(nowStr string) {
	result := h.DB.Exec(`
		UPDATE customers c SET c.status = 'suspended', c.updated_at = ?
		WHERE c.status = 'active'
		  AND EXISTS (SELECT 1 FROM customer_subscriptions cs WHERE cs.customer_id = c.id)
		  AND NOT EXISTS (
			SELECT 1 FROM customer_subscriptions cs
			WHERE cs.customer_id = c.id AND cs.status NOT IN ('expired', 'suspended')
		  )`,
		nowStr,
	)
	if result.Error != nil {
		log.Printf("lifecycle: sync customer status: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("lifecycle: suspended %d customers (no active subscriptions)", result.RowsAffected)
		store.WriteAuditLog(h.DB, "system", "customer_auto_suspend",
			fmt.Sprintf("count: %d", result.RowsAffected), "")
	}
}

// cancelStaleOrders cancels pending orders older than 30 minutes.
func (h *Handler) cancelStaleOrders(nowStr string) {
	cutoff := time.Now().UTC().Add(-30 * time.Minute).Format(model.TimeLayout)
	result := h.DB.Exec(
		"UPDATE orders SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND created_at < ?",
		nowStr, cutoff,
	)
	if result.Error != nil {
		log.Printf("lifecycle: cancel stale orders: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("lifecycle: cancelled %d stale orders", result.RowsAffected)
		store.WriteAuditLog(h.DB, "system", "order_auto_cancel",
			fmt.Sprintf("count: %d", result.RowsAffected), "")
	}
}

// resetMonthlyTraffic resets traffic_used on the 1st of each month.
func (h *Handler) resetMonthlyTraffic(now time.Time, nowStr string) {
	if now.Day() != 1 {
		return
	}

	// Use traffic_reset_at to avoid duplicate resets within the same month.
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format(model.TimeLayout)
	result := h.DB.Exec(
		"UPDATE customer_subscriptions SET traffic_used = 0, traffic_reset_at = ?, updated_at = ? WHERE status = 'active' AND (traffic_reset_at IS NULL OR traffic_reset_at < ?)",
		nowStr, nowStr, monthStart,
	)
	if result.Error != nil {
		log.Printf("lifecycle: reset monthly traffic: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("lifecycle: reset traffic for %d subscriptions", result.RowsAffected)
		store.WriteAuditLog(h.DB, "system", "subscription_traffic_reset",
			fmt.Sprintf("count: %d month: %s", result.RowsAffected, now.Format("2006-01")), "")
	}
}

// ── admin manual operations ──────────────────────────────────────────────────

// HandleActivateSubscription 手动激活订阅
// @Summary      激活订阅
// @ID           AdminActivateSubscription
// @Description  手动将订阅状态设为 active
// @Tags         admin
// @Security     AdminSession
// @Produce      json
// @Param        id path int true "订阅 ID"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/subscriptions/{id}/activate [post]
func (h *Handler) HandleActivateSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nowStr := time.Now().UTC().Format(model.TimeLayout)

	result := h.DB.Exec(
		"UPDATE customer_subscriptions SET status = 'active', updated_at = ? WHERE id = ? AND status != 'active'",
		nowStr, id,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "subscription not found or already active")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "subscription_manual_activate", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleSuspendSubscription 手动暂停订阅
// @Summary      暂停订阅
// @ID           AdminSuspendSubscription
// @Description  手动将订阅状态设为 suspended
// @Tags         admin
// @Security     AdminSession
// @Produce      json
// @Param        id path int true "订阅 ID"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/subscriptions/{id}/suspend [post]
func (h *Handler) HandleSuspendSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nowStr := time.Now().UTC().Format(model.TimeLayout)

	result := h.DB.Exec(
		"UPDATE customer_subscriptions SET status = 'suspended', updated_at = ? WHERE id = ? AND status = 'active'",
		nowStr, id,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "subscription not found or not active")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "subscription_manual_suspend", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleExpireSubscription 手动过期订阅
// @Summary      过期订阅
// @ID           AdminExpireSubscription
// @Description  手动将订阅状态设为 expired
// @Tags         admin
// @Security     AdminSession
// @Produce      json
// @Param        id path int true "订阅 ID"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/subscriptions/{id}/expire [post]
func (h *Handler) HandleExpireSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nowStr := time.Now().UTC().Format(model.TimeLayout)

	result := h.DB.Exec(
		"UPDATE customer_subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status != 'expired'",
		nowStr, id,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "subscription not found or already expired")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "subscription_manual_expire", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleBanCustomer godoc
// @Summary      封禁客户
// @ID           AdminBanCustomer
// @Description  封禁客户并暂停其所有活跃订阅
// @Tags         admin
// @Security     CookieAuth
// @Produce      json
// @Param        id path int true "客户 ID"
// @Success      200 {object} StatusResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/customers/{id}/ban [post]
func (h *Handler) HandleBanCustomer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nowStr := time.Now().UTC().Format(model.TimeLayout)

	tx := h.DB.Begin()
	if err := tx.Exec(
		"UPDATE customers SET status = 'banned', updated_at = ? WHERE id = ? AND status != 'banned'",
		nowStr, id,
	).Error; err != nil {
		tx.Rollback()
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	if err := tx.Exec(
		"UPDATE customer_subscriptions SET status = 'suspended', updated_at = ? WHERE customer_id = ? AND status = 'active'",
		nowStr, id,
	).Error; err != nil {
		tx.Rollback()
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	if err := tx.Commit().Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_ban", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleUnbanCustomer godoc
// @Summary      解封客户
// @ID           AdminUnbanCustomer
// @Description  将已封禁的客户状态恢复为活跃
// @Tags         admin
// @Security     CookieAuth
// @Produce      json
// @Param        id path int true "客户 ID"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/customers/{id}/unban [post]
func (h *Handler) HandleUnbanCustomer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nowStr := time.Now().UTC().Format(model.TimeLayout)

	result := h.DB.Exec(
		"UPDATE customers SET status = 'active', updated_at = ? WHERE id = ? AND status = 'banned'",
		nowStr, id,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "customer not found or not banned")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_unban", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// ── renewal logic (called from payment.go) ───────────────────────────────────

// ActivateSubscription activates or renews a subscription after successful payment.
// If the customer already has an active subscription on the same plan, extend it.
// Otherwise, create a new subscription.
func (h *Handler) ActivateSubscription(customerID, planID uint, orderID uint) error {
	var plan struct {
		TrafficLimit int64
		DeviceLimit  int
		DurationDays int
	}
	if err := h.DB.Raw("SELECT traffic_limit, device_limit, duration_days FROM plans WHERE id = ?", planID).Scan(&plan).Error; err != nil {
		return fmt.Errorf("query plan: %w", err)
	}
	if plan.DurationDays == 0 && plan.TrafficLimit == 0 && plan.DeviceLimit == 0 {
		return fmt.Errorf("plan %d not found", planID)
	}

	now := time.Now().UTC()
	nowStr := now.Format(model.TimeLayout)

	// Check for existing active subscription on the same plan.
	var existingID uint
	var existingExpires string
	var existingTrafficLimit int64
	h.DB.Raw(
		"SELECT id, expires_at, traffic_limit FROM customer_subscriptions WHERE customer_id = ? AND plan_id = ? AND status = 'active' LIMIT 1",
		customerID, planID,
	).Row().Scan(&existingID, &existingExpires, &existingTrafficLimit)

	tx := h.DB.Begin()

	if existingID > 0 {
		// Extend existing subscription.
		expTime, _ := time.Parse(model.TimeLayout, existingExpires)
		if expTime.Before(now) {
			expTime = now
		}
		newExpires := expTime.AddDate(0, 0, plan.DurationDays).Format(model.TimeLayout)
		newTrafficLimit := existingTrafficLimit + plan.TrafficLimit

		if err := tx.Exec(
			"UPDATE customer_subscriptions SET expires_at = ?, traffic_limit = ?, updated_at = ? WHERE id = ?",
			newExpires, newTrafficLimit, nowStr, existingID,
		).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("extend subscription: %w", err)
		}

		store.WriteAuditLog(h.DB, "system", "subscription_renew",
			fmt.Sprintf("subscription_id: %d customer_id: %d plan_id: %d order_id: %d new_expires: %s",
				existingID, customerID, planID, orderID, newExpires), "")
	} else {
		// Create new subscription.
		token, err := generateToken()
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("generate token: %w", err)
		}
		expiresAt := now.AddDate(0, 0, plan.DurationDays).Format(model.TimeLayout)

		if err := tx.Exec(
			"INSERT INTO customer_subscriptions (customer_id, plan_id, token, traffic_used, traffic_limit, device_limit, started_at, expires_at, status, created_at, updated_at) "+
				"VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?)",
			customerID, planID, token, plan.TrafficLimit, plan.DeviceLimit, nowStr, expiresAt, nowStr, nowStr,
		).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("create subscription: %w", err)
		}

		store.WriteAuditLog(h.DB, "system", "subscription_activate",
			fmt.Sprintf("customer_id: %d plan_id: %d order_id: %d", customerID, planID, orderID), "")
	}

	// Ensure customer is active.
	if err := tx.Exec(
		"UPDATE customers SET status = 'active', updated_at = ? WHERE id = ? AND status = 'suspended'",
		nowStr, customerID,
	).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("activate customer: %w", err)
	}

	// Mark order as paid.
	if err := tx.Exec(
		"UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?",
		nowStr, nowStr, orderID,
	).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("update order: %w", err)
	}

	return tx.Commit().Error
}

// ── helper ───────────────────────────────────────────────────────────────────

func parseUintParam(r *http.Request, name string) (uint, error) {
	v, err := strconv.ParseUint(r.PathValue(name), 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(v), nil
}
