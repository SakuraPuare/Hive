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
	if n.MAC == "" || n.OwnerCustomerID == nil || *n.OwnerCustomerID != cid {
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
			"WHERE n.owner_customer_id = ? ORDER BY n.hostname", cid,
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
		"UPDATE nodes SET owner_customer_id = ?, claimed_at = ? "+
			"WHERE claim_code_hash = ? AND claim_code_hash <> '' AND owner_customer_id IS NULL",
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
		"UPDATE nodes SET owner_customer_id = NULL, claimed_at = NULL WHERE mac = ? AND owner_customer_id = ?",
		mac, cid,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	store.WriteAuditLog(h.DB, customerActor(cid), "device_unbind", "mac="+mac, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}
