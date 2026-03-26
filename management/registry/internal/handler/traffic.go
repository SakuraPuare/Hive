package handler

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── traffic collection loop ──────────────────────────────────────────────────

// StartTrafficLoop runs every 5 minutes to collect xray traffic from Prometheus
// and update customer_subscriptions.traffic_used. It also handles monthly resets.
func (h *Handler) StartTrafficLoop() {
	time.Sleep(10 * time.Second)
	log.Printf("traffic: starting traffic collection loop (interval=5m)")

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	h.collectTraffic()
	for range ticker.C {
		h.collectTraffic()
	}
}

func (h *Handler) collectTraffic() {
	h.resetTrafficIfNeeded()
	h.updateTrafficFromPrometheus()
}

// updateTrafficFromPrometheus queries Prometheus for xray traffic and writes
// increments into customer_subscriptions.traffic_used.
func (h *Handler) updateTrafficFromPrometheus() {
	if h.Config.PrometheusURL == "" {
		return
	}

	// Query total xray traffic (up + down) increase over the last 5 minutes, keyed by instance.
	trafficMap := h.promQueryInstant(
		`increase(xray_traffic_total{direction="up"}[5m]) + increase(xray_traffic_total{direction="down"}[5m])`,
	)
	if len(trafficMap) == 0 {
		return
	}

	// Build hostname -> total bytes map (sum across all instances on same host).
	hostTraffic := make(map[string]int64)
	for instance, val := range trafficMap {
		if val <= 0 {
			continue
		}
		hostTraffic[instance] += int64(val)
	}
	if len(hostTraffic) == 0 {
		return
	}

	// Map hostname -> node MAC.
	var nodes []struct {
		MAC      string
		Hostname string
	}
	h.DB.Raw("SELECT mac, hostname FROM nodes").Scan(&nodes)
	hostnameToMAC := make(map[string]string, len(nodes))
	for _, n := range nodes {
		hostnameToMAC[n.Hostname] = n.MAC
	}

	// Map node MAC -> total traffic bytes from this cycle.
	macTraffic := make(map[string]int64)
	for hostname, bytes := range hostTraffic {
		if mac, ok := hostnameToMAC[hostname]; ok {
			macTraffic[mac] += bytes
		}
	}
	if len(macTraffic) == 0 {
		return
	}

	// For each active subscription, sum traffic from its plan's nodes and add to traffic_used.
	type subInfo struct {
		ID     uint
		PlanID uint
	}
	var subs []subInfo
	h.DB.Raw("SELECT id, plan_id FROM customer_subscriptions WHERE status = 'active'").Scan(&subs)

	if len(subs) == 0 {
		return
	}

	// Build plan -> set of node MACs.
	type planLine struct {
		PlanID  uint
		NodeMAC string
	}
	var pls []planLine
	h.DB.Raw("SELECT pl.plan_id, ln.node_mac FROM plan_lines pl " +
		"JOIN line_nodes ln ON ln.line_id = pl.line_id " +
		"JOIN `lines` l ON l.id = pl.line_id AND l.enabled = 1").Scan(&pls)

	planNodes := make(map[uint]map[string]bool)
	for _, pl := range pls {
		if planNodes[pl.PlanID] == nil {
			planNodes[pl.PlanID] = make(map[string]bool)
		}
		planNodes[pl.PlanID][pl.NodeMAC] = true
	}

	now := time.Now().UTC().Format(model.TimeLayout)
	updated := 0

	for _, sub := range subs {
		nodeMacs := planNodes[sub.PlanID]
		if len(nodeMacs) == 0 {
			continue
		}

		// Sum traffic from all nodes in this subscription's plan.
		var delta int64
		for mac := range nodeMacs {
			delta += macTraffic[mac]
		}
		if delta <= 0 {
			continue
		}

		// NOTE: Since xray uses node-level UUIDs, we can't distinguish per-user traffic.
		// We divide the node traffic equally among all active subscriptions sharing that plan.
		// This is a rough approximation until per-user metering is available.
		var planSubCount int64
		h.DB.Raw("SELECT COUNT(*) FROM customer_subscriptions WHERE plan_id = ? AND status = 'active'", sub.PlanID).Scan(&planSubCount)
		if planSubCount > 1 {
			delta = delta / planSubCount
		}

		if err := h.DB.Exec(
			"UPDATE customer_subscriptions SET traffic_used = traffic_used + ?, updated_at = ? WHERE id = ?",
			delta, now, sub.ID,
		).Error; err != nil {
			log.Printf("traffic: update sub %d: %v", sub.ID, err)
			continue
		}
		updated++
	}

	if updated > 0 {
		log.Printf("traffic: updated %d subscriptions", updated)
	}
}

// ── traffic reset ────────────────────────────────────────────────────────────

// resetTrafficIfNeeded checks each active subscription and resets traffic_used
// if a calendar month boundary has passed since the last reset.
func (h *Handler) resetTrafficIfNeeded() {
	type subReset struct {
		ID             uint
		TrafficResetAt *time.Time
		StartedAt      time.Time
	}
	var subs []subReset
	h.DB.Raw("SELECT id, traffic_reset_at, started_at FROM customer_subscriptions WHERE status = 'active'").Scan(&subs)

	now := time.Now().UTC()
	nowStr := now.Format(model.TimeLayout)

	for _, sub := range subs {
		var lastReset time.Time
		if sub.TrafficResetAt != nil && !sub.TrafficResetAt.IsZero() {
			lastReset = sub.TrafficResetAt.UTC()
		} else {
			lastReset = sub.StartedAt.UTC()
		}

		if lastReset.IsZero() {
			continue
		}

		// Reset if we've crossed into a new month since last reset.
		if now.Year() > lastReset.Year() || (now.Year() == lastReset.Year() && now.Month() > lastReset.Month()) {
			if err := h.DB.Exec(
				"UPDATE customer_subscriptions SET traffic_used = 0, traffic_reset_at = ?, updated_at = ? WHERE id = ?",
				nowStr, nowStr, sub.ID,
			).Error; err != nil {
				log.Printf("traffic: reset sub %d: %v", sub.ID, err)
				continue
			}
			log.Printf("traffic: reset traffic for subscription %d", sub.ID)
		}
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
// @Security     AdminSession
// @Produce      json
// @Success      200 {object} TrafficSummaryResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/traffic/summary [get]
func (h *Handler) HandleTrafficSummary(w http.ResponseWriter, r *http.Request) {
	var result TrafficSummaryResponse

	h.DB.Raw("SELECT COALESCE(SUM(traffic_used), 0) FROM customer_subscriptions WHERE status = 'active'").Scan(&result.TotalUsed)
	h.DB.Raw("SELECT COUNT(*) FROM customer_subscriptions WHERE status = 'active'").Scan(&result.ActiveCount)
	h.DB.Raw("SELECT COUNT(*) FROM customer_subscriptions WHERE status = 'active' AND traffic_limit > 0 AND traffic_used >= traffic_limit").Scan(&result.OverLimitCount)

	h.jsonOK(w, result)
}

// HandleResetSubscriptionTraffic 重置订阅流量
// @Summary      重置订阅流量
// @ID           AdminResetSubscriptionTraffic
// @Description  将指定订阅的 traffic_used 重置为 0
// @Tags         admin
// @Security     AdminSession
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
