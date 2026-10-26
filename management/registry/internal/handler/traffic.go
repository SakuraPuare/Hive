package handler

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── traffic collection loop ──────────────────────────────────────────────────

// StartTrafficLoop runs every 5 minutes to collect xray traffic from Prometheus
// and update customer_subscriptions.traffic_used. It also handles monthly resets.
func (h *Handler) StartTrafficLoop(ctx context.Context) {
	select {
	case <-time.After(10 * time.Second):
	case <-ctx.Done():
		return
	}
	log.Printf("traffic: starting traffic collection loop (interval=5m)")

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	h.collectTraffic()
	for {
		select {
		case <-ctx.Done():
			log.Println("traffic: shutting down")
			return
		case <-ticker.C:
			h.collectTraffic()
		}
	}
}

func (h *Handler) collectTraffic() {
	h.resetTrafficIfNeeded()
	h.updateTrafficFromPrometheus()
}

// updateTrafficFromPrometheus queries Prometheus for per-user xray traffic and
// writes increments into customer_subscriptions.traffic_used.
//
// Each subscription is provisioned on nodes as a distinct VLESS client whose Xray
// email is "sub-<id>" (see HandleNodeXrayUsers). xray-exporter exposes per-user
// counters labelled target="<email>", so we can attribute traffic to the exact
// subscription — no more equal-split approximation across a plan's subscribers.
func (h *Handler) updateTrafficFromPrometheus() {
	if h.Config.PrometheusURL == "" {
		return
	}

	// Sum up+down increase over the last 5 minutes, keyed by the user email label.
	emailTraffic := h.promQueryInstantByLabel(
		`increase(xray_traffic_uplink_bytes_total{dimension="user"}[5m]) `+
			`+ increase(xray_traffic_downlink_bytes_total{dimension="user"}[5m])`,
		"target", false,
	)
	if len(emailTraffic) == 0 {
		return
	}

	now := time.Now().UTC().Format(model.TimeLayout)
	updated := 0

	for email, bytesF := range emailTraffic {
		// We only bill subscription users, whose email is "sub-<id>".
		// Anything else (e.g. the node's own "node-*" public client) is ignored.
		idStr, ok := strings.CutPrefix(email, "sub-")
		if !ok {
			continue
		}
		subID, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil || subID == 0 {
			continue
		}
		delta := int64(bytesF)
		if delta <= 0 {
			continue
		}

		if err := h.DB.Exec(
			"UPDATE customer_subscriptions SET traffic_used = traffic_used + ?, updated_at = ? WHERE id = ?",
			delta, now, subID,
		).Error; err != nil {
			log.Printf("traffic: update sub %d: %v", subID, err)
			continue
		}
		updated++
	}

	if updated > 0 {
		log.Printf("traffic: updated %d subscriptions", updated)
	}
}

// ── traffic reset ────────────────────────────────────────────────────────────

// Both maintenance loops share one atomic reset. Automatic quota suspension
// must not prevent the next monthly allowance, or undo an administrator's pause.
func (h *Handler) resetTrafficIfNeeded() { h.resetTrafficAt(time.Now().UTC()) }

func (h *Handler) resetTrafficAt(now time.Time) {
	now = now.UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	result := h.DB.Exec(`UPDATE customer_subscriptions SET
        status = CASE WHEN status = 'suspended' AND suspension_reason = 'traffic'
            THEN CASE WHEN expires_at > ? THEN 'active' ELSE 'expired' END ELSE status END,
        suspension_reason = CASE WHEN suspension_reason = 'traffic' THEN '' ELSE suspension_reason END,
        traffic_used = 0, traffic_reset_at = ?, updated_at = ?
        WHERE (status = 'active' OR (status = 'suspended' AND suspension_reason = 'traffic'))
        AND COALESCE(traffic_reset_at, started_at) < ?`, now, now, now, monthStart)
	if result.Error != nil {
		log.Printf("traffic: monthly reset: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		store.WriteAuditLog(h.DB, "system", "subscription_traffic_reset", fmt.Sprintf("count: %d month: %s", result.RowsAffected, now.Format("2006-01")), "")
	}
}

// ── subscription validity check ──────────────────────────────────────────────

// checkSubscriptionValid checks whether a subscription can serve configs.
// Returns (true, "") if valid, or (false, reason) if not.
func checkSubscriptionValid(status string, trafficUsed, trafficLimit int64, expiresAt string) (bool, string) {
	if status != "active" {
		return false, "订阅已停用"
	}

	expTime, err := time.Parse(model.TimeLayout, expiresAt)
	if err == nil && time.Now().UTC().After(expTime) {
		return false, "订阅已过期"
	}

	if trafficLimit > 0 && trafficUsed >= trafficLimit {
		return false, "流量已用尽"
	}

	return true, ""
}

// ── admin endpoints ──────────────────────────────────────────────────────────

// ── swagger types ────────────────────────────────────────────────────────────

// TrafficSummaryResponse is the response body for GET /admin/traffic/summary.
type TrafficSummaryResponse struct {
	TotalUsed      int64 `json:"total_used" example:"1073741824"`
	ActiveCount    int64 `json:"active_count" example:"42"`
	OverLimitCount int64 `json:"over_limit_count" example:"3"`
}

// ── admin handlers ──────────────────────────────────────────────────────────

// HandleTrafficSummary 获取流量汇总
// @Summary      获取流量汇总
// @ID           AdminTrafficSummary
// @Description  返回活跃订阅的流量使用总量、活跃数和超限数
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {object} TrafficSummaryResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/traffic/summary [get]
func (h *Handler) HandleTrafficSummary(w http.ResponseWriter, r *http.Request) {
	var result TrafficSummaryResponse

	if err := h.DB.Raw("SELECT COALESCE(SUM(traffic_used), 0) FROM customer_subscriptions WHERE status = 'active'").Scan(&result.TotalUsed).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if err := h.DB.Raw("SELECT COUNT(*) FROM customer_subscriptions WHERE status = 'active'").Scan(&result.ActiveCount).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if err := h.DB.Raw("SELECT COUNT(*) FROM customer_subscriptions WHERE status = 'active' AND traffic_limit > 0 AND traffic_used >= traffic_limit").Scan(&result.OverLimitCount).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, result)
}

// HandleResetSubscriptionTraffic 重置订阅流量
// @Summary      重置订阅流量
// @ID           AdminResetSubscriptionTraffic
// @Description  将指定订阅的 traffic_used 重置为 0
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        id path int true "订阅 ID"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/subscriptions/{id}/reset-traffic [post]
func (h *Handler) HandleResetSubscriptionTraffic(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	now := time.Now().UTC().Format(model.TimeLayout)
	res := h.DB.Exec(
		"UPDATE customer_subscriptions SET traffic_used = 0, traffic_reset_at = ?, updated_at = ? WHERE id = ?",
		now, now, id,
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "subscription not found")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "subscription_traffic_reset", fmt.Sprintf("id=%s", id), getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}
