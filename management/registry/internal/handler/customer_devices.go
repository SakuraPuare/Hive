package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// customerActor formats a customer id as an audit-log actor string.
func customerActor(cid uint) string { return "customer:" + strconv.FormatUint(uint64(cid), 10) }

// ownedNode loads a node by MAC and verifies it belongs to the given customer.
// Returns (node, true) when owned; writes 404 and returns (_, false) otherwise.
// Uses a generic 404 (not 403) so a customer can't probe which MACs exist.
func (h *Handler) ownedNode(w http.ResponseWriter, mac string, cid uint) (model.Node, bool) {
	var n model.Node
	if err := h.DB.Raw(
		"SELECT "+model.NodeCols+" FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac WHERE n.mac = ?", mac,
	).Scan(&n).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return n, false
	}
	if n.MAC == "" || n.ServerEnabled || n.OwnerCustomerID == nil || *n.OwnerCustomerID != cid {
		h.jsonErr(w, http.StatusNotFound, "device not found")
		return n, false
	}
	return n, true
}

// HandlePortalListDevices godoc
// @Summary      列出我的设备
// @ID           PortalListDevices
// @Description  返回当前登录客户名下认领的所有设备
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Success      200 {array}  model.Node
// @Failure      500 {object} ErrorResponse
// @Router       /portal/devices [get]
func (h *Handler) HandlePortalListDevices(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	nodes := make([]model.Node, 0)
	if err := h.DB.Raw(
		"SELECT "+model.NodeCols+" FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac "+
			"WHERE n.owner_customer_id = ? AND n.server_enabled = 0 ORDER BY n.hostname", cid,
	).Scan(&nodes).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, nodes)
}

// HandlePortalGetDevice godoc
// @Summary      获取我的单台设备详情
// @ID           PortalGetDevice
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} model.Node
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac} [get]
func (h *Handler) HandlePortalGetDevice(w http.ResponseWriter, r *http.Request) {
	n, ok := h.ownedNode(w, r.PathValue("mac"), customerID(r))
	if !ok {
		return
	}
	h.jsonOK(w, n)
}

// PortalClaimRequest is the body for POST /portal/devices/claim.
type PortalClaimRequest struct {
	Code string `json:"code" example:"K7QF-2M9X"`
}

// HandlePortalClaimDevice godoc
// @Summary      认领设备
// @ID           PortalClaimDevice
// @Description  客户输入设备认领码（MOTD/贴纸上显示）把设备绑定到自己名下。一次性：已被认领的设备无法再认领。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Accept       json
// @Param        body body PortalClaimRequest true "认领码"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      409 {object} ErrorResponse
// @Router       /portal/devices/claim [post]
func (h *Handler) HandlePortalClaimDevice(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	var body PortalClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.Code == "" {
		h.jsonErr(w, http.StatusBadRequest, "code required")
		return
	}

	now := time.Now().UTC().Format(model.TimeLayout)
	// 原子条件更新：只在 hash 匹配且尚未被认领时绑定。RowsAffected 是竞态安全的
	// 单一判定点——防止两人同时认领同一设备、以及重复认领。
	res := h.DB.Exec(
		"UPDATE nodes SET owner_customer_id = ?, claimed_at = ?, bound_subscription_id = NULL, owner_exit_enabled = 1 "+
			"WHERE claim_code_hash = ? AND claim_code_hash <> '' AND owner_customer_id IS NULL AND server_enabled = 0",
		cid, now, hashClaimCode(body.Code),
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		// 不区分"码错"与"已被认领"，避免成为探测预言机
		h.jsonErr(w, http.StatusConflict, "认领码无效或设备已被认领")
		return
	}

	// 审计：记录认领动作（复用管理员审计表，actor 记为 customer:<id>）
	store.WriteAuditLog(h.DB, customerActor(cid), "device_claim",
		"code_hash="+hashClaimCode(body.Code)[:12], getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// PortalBindSubscriptionRequest is the body for PUT /portal/devices/{mac}/subscription.
type PortalBindSubscriptionRequest struct {
	SubscriptionID uint `json:"subscription_id" example:"42"`
}

// HandlePortalBindDeviceSubscription godoc
// @Summary      给网关设备下发订阅配置
// @ID           PortalBindDeviceSubscription
// @Description  客户把自己名下有效的订阅绑定到自己的网关设备。设备在下一次 hive-clash-sync 周期拉取该订阅的 Mihomo 配置。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Accept       json
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Param        body body PortalBindSubscriptionRequest true "订阅 ID"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      409 {object} ErrorResponse
// @Router       /portal/devices/{mac}/subscription [put]
func (h *Handler) HandlePortalBindDeviceSubscription(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	n, ok := h.ownedNode(w, mac, cid)
	if !ok {
		return
	}
	if !n.GatewayEnabled {
		h.jsonErr(w, http.StatusBadRequest, "device is not a gateway")
		return
	}

	var req PortalBindSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.SubscriptionID == 0 {
		h.jsonErr(w, http.StatusBadRequest, "subscription_id required")
		return
	}

	var sub struct {
		ID           uint
		Status       string
		TrafficUsed  int64
		TrafficLimit int64
		ExpiresAt    time.Time
	}
	if err := h.DB.Raw(
		"SELECT id, status, traffic_used, traffic_limit, expires_at FROM customer_subscriptions WHERE id = ? AND customer_id = ?",
		req.SubscriptionID, cid,
	).Scan(&sub).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if sub.ID == 0 {
		// 不区分"订阅不存在"和"属于别人"，避免客户探测订阅 ID。
		h.jsonErr(w, http.StatusNotFound, "subscription not found")
		return
	}
	expiresAt := sub.ExpiresAt.UTC().Format(model.TimeLayout)
	if valid, reason := checkSubscriptionValid(sub.Status, sub.TrafficUsed, sub.TrafficLimit, expiresAt); !valid {
		h.jsonErr(w, http.StatusConflict, reason)
		return
	}

	res := h.DB.Exec(
		"UPDATE nodes SET bound_subscription_id = ? "+
			"WHERE mac = ? AND owner_customer_id = ? AND server_enabled = 0 AND gateway_enabled = 1",
		req.SubscriptionID, mac, cid,
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}

	store.WriteAuditLog(h.DB, customerActor(cid), "device_bind_subscription",
		"mac="+mac+" subscription="+strconv.FormatUint(uint64(req.SubscriptionID), 10), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandlePortalUnbindDeviceSubscription godoc
// @Summary      解绑网关设备的订阅配置
// @ID           PortalUnbindDeviceSubscription
// @Description  客户解除网关设备与订阅的绑定；设备下一次同步后进入未绑定（fail-closed）配置。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/subscription [delete]
func (h *Handler) HandlePortalUnbindDeviceSubscription(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, cid); !ok {
		return
	}
	if err := h.DB.Exec(
		"UPDATE nodes SET bound_subscription_id = NULL WHERE mac = ? AND owner_customer_id = ? AND server_enabled = 0",
		mac, cid,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	store.WriteAuditLog(h.DB, customerActor(cid), "device_unbind_subscription", "mac="+mac, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// PortalDeviceGatewayRequest is the body for PUT /portal/devices/{mac}/gateway.
type PortalDeviceGatewayRequest struct {
	GatewayDirection string `json:"gateway_direction" example:"auto"`
}

// HandlePortalSetDeviceGateway godoc
// @Summary      设置我的网关设备的分流方向
// @ID           PortalSetDeviceGateway
// @Description  auto 会按节点上报的国家自动判定：在大陆 → 出海（CN 直连、其余代理）；不在大陆 → 回国（CN 走回国节点、其余直连）。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Accept       json
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Param        body body PortalDeviceGatewayRequest true "分流方向"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/gateway [put]
func (h *Handler) HandlePortalSetDeviceGateway(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	node, ok := h.ownedNode(w, mac, cid)
	if !ok {
		return
	}
	if !node.GatewayEnabled {
		h.jsonErr(w, http.StatusBadRequest, "device is not a gateway")
		return
	}
	var req PortalDeviceGatewayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	dir, valid := normalizeGatewayDirection(req.GatewayDirection)
	if !valid {
		h.jsonErr(w, http.StatusBadRequest, "gateway_direction must be auto, domestic, overseas, global or direct")
		return
	}
	// 方向与已绑定订阅的线路必须能配出一台上游：境内网关要境外节点、境外网关要
	// 回国节点。配不出来时切换方向等于让网关 fail-closed（客户端断网），先拦下并
	// 说明要先换订阅，而不是让用户在面板上把设备点成砖。
	if node.BoundSubscriptionID != nil && *node.BoundSubscriptionID != 0 && !h.gatewayDirectionHasUpstream(node, directionForNode(dir, effectiveNodeCountry(node))) {
		h.jsonErr(w, http.StatusConflict, "当前订阅的线路里没有该分流方向可用的上游节点，请先改绑对应方向的订阅")
		return
	}
	if err := h.DB.Exec(
		"UPDATE nodes SET gateway_direction = ? WHERE mac = ? AND owner_customer_id = ?",
		dir, mac, cid,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	store.WriteAuditLog(h.DB, customerActor(cid), "device_gateway_direction",
		"mac="+mac+" direction="+dir, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok", "gateway_direction": dir})
}

// PortalDeviceExitRequest is the body for PUT /portal/devices/{mac}/exit.
type PortalDeviceExitRequest struct {
	Enabled *bool `json:"enabled" example:"false"`
}

// HandlePortalSetDeviceExit godoc
// @Summary      设置我的设备是否作为 Xray 出口
// @ID           PortalSetDeviceExit
// @Description  设备所有者关闭后，该设备立即从订阅与网关上游候选中移除；管理员开关仍然优先。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Accept       json
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Param        body body PortalDeviceExitRequest true "出口开关"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/exit [put]
func (h *Handler) HandlePortalSetDeviceExit(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, cid); !ok {
		return
	}
	var req PortalDeviceExitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Enabled == nil {
		h.jsonErr(w, http.StatusBadRequest, "enabled is required")
		return
	}
	if err := h.DB.Exec(
		"UPDATE nodes SET owner_exit_enabled = ? WHERE mac = ? AND owner_customer_id = ? AND server_enabled = 0",
		*req.Enabled, mac, cid,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	store.WriteAuditLog(h.DB, customerActor(cid), "device_exit_toggle",
		"mac="+mac+" enabled="+strconv.FormatBool(*req.Enabled), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandlePortalUnbindDevice godoc
// @Summary      解绑我的设备
// @ID           PortalUnbindDevice
// @Description  客户把设备从自己名下解绑；解绑后设备恢复未认领状态，认领码重新生效。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/unbind [post]
func (h *Handler) HandlePortalUnbindDevice(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, cid); !ok {
		return
	}
	if err := h.DB.Exec(
		"UPDATE nodes SET owner_customer_id = NULL, claimed_at = NULL, bound_subscription_id = NULL, owner_exit_enabled = 1 WHERE mac = ? AND owner_customer_id = ?",
		mac, cid,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	store.WriteAuditLog(h.DB, customerActor(cid), "device_unbind", "mac="+mac, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// directionForNode resolves the stored mode to a concrete direction, using the
// node's effective country for "auto".
func directionForNode(mode, country string) string {
	return resolveGatewayDirection(mode, country)
}

// effectiveNodeCountry is the country auto should use: the operator override
// when set, otherwise the heartbeat-reported value.
func effectiveNodeCountry(n model.Node) string {
	if c := normalizeCountry(n.CountryOverride); c != "" {
		return c
	}
	return normalizeCountry(n.Country)
}

// gatewayDirectionHasUpstream reports whether the node's bound subscription
// yields at least one eligible upstream in the complementary direction, the
// same predicate the gateway renderer applies.
func (h *Handler) gatewayDirectionHasUpstream(node model.Node, direction string) bool {
	planID := uint(0)
	if err := h.DB.Raw("SELECT plan_id FROM customer_subscriptions WHERE id = ?", *node.BoundSubscriptionID).Scan(&planID).Error; err != nil || planID == 0 {
		return false
	}
	upstream := gatewayUpstreamDirection(direction, nodeDirection(node))
	var count int64
	if err := h.DB.Raw(
		"SELECT COUNT(*) FROM nodes n "+
			"JOIN line_nodes ln ON ln.node_mac = n.mac "+
			"JOIN `lines` l ON l.id = ln.line_id AND l.enabled = 1 "+
			"JOIN plan_lines pl ON pl.line_id = l.id AND pl.plan_id = ? "+
			"WHERE n.mac <> ? AND n.enabled = 1 AND n.exit_enabled = 1 AND n.owner_exit_enabled = 1 "+
			"AND n.status = 'active' AND n.cf_url <> '' AND n.xray_uuid <> '' AND n.exit_direction = ?",
		planID, node.MAC, upstream,
	).Scan(&count).Error; err != nil {
		return false
	}
	return count > 0
}
