package handler

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── lifecycle loop ───────────────────────────────────────────────────────────

// StartLifecycleLoop runs subscription lifecycle tasks every 10 minutes.
func (h *Handler) StartLifecycleLoop(ctx context.Context) {
	select {
	case <-time.After(10 * time.Second):
	case <-ctx.Done():
		return
	}
	log.Println("lifecycle: starting subscription lifecycle loop (interval=10m)")

	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	h.runLifecycleTasks()
	for {
		select {
		case <-ctx.Done():
			log.Println("lifecycle: shutting down")
			return
		case <-ticker.C:
			h.runLifecycleTasks()
		}
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
		"UPDATE customer_subscriptions SET status = 'suspended', suspension_reason = 'traffic', updated_at = ? WHERE status = 'active' AND traffic_limit > 0 AND traffic_used >= traffic_limit",
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

// Subscription availability does not disable the account's renewal/support portal.
func (h *Handler) syncCustomerStatus(_ string) {}

// Expire each order through the same locked, idempotent refund transition.
func (h *Handler) cancelStaleOrders(_ string) {
	var ids []uint
	cutoff := time.Now().UTC().Add(-30 * time.Minute)
	if err := h.DB.Raw("SELECT id FROM orders WHERE status = 'pending' AND created_at < ?", cutoff).Scan(&ids).Error; err != nil {
		log.Printf("lifecycle: find stale orders: %v", err)
		return
	}
	for _, id := range ids {
		if _, err := h.updateOrderStatus(fmt.Sprint(id), "cancelled"); err != nil {
			log.Printf("lifecycle: cancel order %d: %v", id, err)
		}
	}
}

// resetMonthlyTraffic resets traffic_used on the 1st of each month.
func (h *Handler) resetMonthlyTraffic(now time.Time, _ string) {
	h.resetTrafficAt(now)
}

// ── admin manual operations ──────────────────────────────────────────────────

// HandleActivateSubscription 手动激活订阅
// @Summary      激活订阅
// @ID           AdminActivateSubscription
// @Description  手动将订阅状态设为 active
// @Tags         admin
// @Security     AdminSessionCookie
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
		"UPDATE customer_subscriptions SET status = 'active', suspension_reason = '', updated_at = ? WHERE id = ? AND status != 'active'",
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
// @Security     AdminSessionCookie
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
		"UPDATE customer_subscriptions SET status = 'suspended', suspension_reason = 'manual', updated_at = ? WHERE id = ? AND (status = 'active' OR (status = 'suspended' AND suspension_reason = 'traffic'))",
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
// @Security     AdminSessionCookie
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
// @Security     AdminSessionCookie
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
		if rbErr := tx.Rollback().Error; rbErr != nil {
			log.Printf("ban customer: rollback error: %v", rbErr)
		}
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	if err := tx.Exec(
		"UPDATE customer_subscriptions SET status = 'suspended', updated_at = ? WHERE customer_id = ? AND status = 'active'",
		nowStr, id,
	).Error; err != nil {
		if rbErr := tx.Rollback().Error; rbErr != nil {
			log.Printf("ban customer: rollback error: %v", rbErr)
		}
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
// @Security     AdminSessionCookie
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

// ── idempotent order activation ───────────────────────────────────

// ActivateSubscription validates the order owner and uses the idempotent payment transition.
func (h *Handler) ActivateSubscription(customerID, planID uint, orderID uint) error {
	var o model.Order
	if err := h.DB.Raw("SELECT * FROM orders WHERE id = ?", orderID).Scan(&o).Error; err != nil {
		return err
	}
	if o.ID == 0 || o.CustomerID != customerID || o.PlanID != planID {
		return fmt.Errorf("order does not match customer/plan")
	}
	_, err := h.updateOrderStatus(fmt.Sprint(orderID), "paid")
	return err
}
