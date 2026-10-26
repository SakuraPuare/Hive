package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"hive/registry/internal/model"
)

// gatewaySecret derives a per-node controller secret using a server-only key.
func (h *Handler) gatewaySecret(mac string) string {
	hash := hmac.New(sha256.New, []byte(h.Config.AdminSessionSecret))
	hash.Write([]byte("hive-mihomo-secret:v2:" + strings.ToLower(mac)))
	return hex.EncodeToString(hash.Sum(nil))
}

// HandleNodeClashConfig godoc
// @Summary Gateway Mihomo config for a node
// @ID      NodeClashConfig
// @Description Returns the full Mihomo (Clash.Meta) YAML config for this node's
// @Description transparent-proxy gateway role. The upstream proxy pool is every
// @Description enabled exit node in the cluster EXCEPT this node itself (no
// @Description self-routing loop); the CN split-routing rule is flipped according
// @Description to the node's gateway_direction. Authenticated with this device's MAC-scoped token.
// @Tags nodes
// @Security BearerAuth
// @Produce plain
// @Param mac path string true "node MAC"
// @Success 200 {string} string "Mihomo YAML"
// @Failure 401 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /nodes/{mac}/clash-config [get]
func (h *Handler) HandleNodeClashConfig(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}

	mac := strings.ToLower(r.PathValue("mac"))
	if mac == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac required")
		return
	}

	// Self: gateway settings (direction / upstream mode / selected upstreams).
	var self model.Node
	if err := h.DB.Raw(
		"SELECT "+model.NodeColsPlain+" FROM nodes WHERE mac = ?", mac,
	).Scan(&self).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if self.MAC == "" {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}

	direction := self.GatewayDirection
	if direction == "" {
		direction = "domestic"
	}
	upstreamMode := self.GatewayUpstreamMode
	if upstreamMode == "" {
		upstreamMode = "auto"
	}
	var upstreamMACs []string
	if self.GatewayUpstreamNodes != "" {
		upstreamMACs = strings.Split(self.GatewayUpstreamNodes, ",")
	}

	// Candidate upstreams: all enabled, active exit nodes (self excluded inside builder).
	var all []model.Node
	if err := h.DB.Raw(
		"SELECT " + model.NodeColsPlain + " FROM nodes " +
			"WHERE enabled = 1 AND server_enabled = 1 AND owner_customer_id IS NULL AND status = 'active' AND cf_url <> '' AND xray_uuid <> '' " +
			"ORDER BY weight DESC, hostname",
	).Scan(&all).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	// 计费绑定：若本网关绑定了某客户订阅，且该订阅有效（未停用/未过期/未超量），
	// 则上游代理统一使用该订阅的 UUID —— 网关走上游 Hive 节点的流量落到 sub-<id>
	// 客户，由可信出口的计费接口计入该订阅。已绑定或属于客户的网关失效时必须拒绝转发。
	overrideUUID := ""
	blocked := true
	lease := subscriptionLeaseSeconds
	if self.BoundSubscriptionID != nil && *self.BoundSubscriptionID != 0 {
		blocked = true
		var srow struct {
			CustomerStatus string
			PlanID         uint
			Status         string
			XrayUUID       string
			TrafficUsed    int64
			TrafficLimit   int64
			ExpiresAt      time.Time
		}
		if err := h.DB.Raw(
			"SELECT cs.status, cs.xray_uuid, cs.traffic_used, cs.traffic_limit, cs.expires_at, cs.plan_id, c.status AS customer_status "+
				"FROM customer_subscriptions cs JOIN customers c ON c.id = cs.customer_id WHERE cs.id = ?", *self.BoundSubscriptionID,
		).Scan(&srow).Error; err != nil {
			log.Printf("gateway: query bound subscription %d for node %s: %v", *self.BoundSubscriptionID, mac, err)
		} else if srow.XrayUUID != "" {
			expStr := srow.ExpiresAt.UTC().Format(model.TimeLayout)
			if ok, _ := checkSubscriptionValid(srow.Status, srow.TrafficUsed, srow.TrafficLimit, expStr); ok && srow.CustomerStatus == "active" && self.Enabled && self.Status == "active" {
				remaining := int(time.Until(srow.ExpiresAt).Seconds())
				if remaining < lease {
					lease = max(1, remaining)
				}
				overrideUUID = srow.XrayUUID
				blocked = false
				var allowed []string
				if err := h.DB.Raw("SELECT DISTINCT ln.node_mac FROM line_nodes ln JOIN `lines` l ON l.id = ln.line_id AND l.enabled = 1 JOIN plan_lines pl ON pl.line_id = l.id WHERE pl.plan_id = ?", srow.PlanID).Scan(&allowed).Error; err != nil {
					blocked = true
				}
				permitted := make(map[string]bool)
				for _, mac := range allowed {
					permitted[mac] = true
				}
				filtered := make([]model.Node, 0)
				for _, n := range all {
					if permitted[n.MAC] {
						filtered = append(filtered, n)
					}
				}
				all = filtered
				if len(all) == 0 {
					blocked = true
				}
			}
			// 无效或查询失败时保持 blocked，不能回退节点级 UUID。
		}
	}

	if blocked {
		all = nil
		direction = "blocked"
	}
	yaml := buildGatewayClashYAML(
		fmt.Sprintf("gateway %s", self.Hostname),
		h.Config.XrayPath,
		h.gatewaySecret(mac),
		"/var/www/metacubexd",
		mac, direction, upstreamMode, upstreamMACs, all, overrideUUID,
	)

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Hive-Lease-Seconds", fmt.Sprint(lease))
	access := "active"
	if blocked {
		access = "blocked"
	}
	w.Header().Set("X-Hive-Access", access)
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(yaml))
}
