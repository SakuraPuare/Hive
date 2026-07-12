package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// AssignDeviceRequest is the body for POST /admin/nodes/{mac}/assign.
type AssignDeviceRequest struct {
	CustomerID uint `json:"customer_id" example:"42"`
}

// HandleAdminAssignDevice godoc
// @Summary      分配设备给客户
// @ID           AdminAssignDevice
// @Description  管理员把设备（节点）归属到指定客户名下。会设置 owner_customer_id 与 claimed_at。
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Param        mac path string true "设备 MAC"
// @Param        body body AssignDeviceRequest true "目标客户"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /admin/nodes/{mac}/assign [post]
func (h *Handler) HandleAdminAssignDevice(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	var body AssignDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.CustomerID == 0 {
		h.jsonErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	// 目标客户须存在
	var cnt int64
	if err := h.DB.Raw("SELECT COUNT(*) FROM customers WHERE id = ?", body.CustomerID).Scan(&cnt).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if cnt == 0 {
		h.jsonErr(w, http.StatusBadRequest, "customer not found")
		return
	}
	now := time.Now().UTC().Format(model.TimeLayout)
	res := h.DB.Exec(
		"UPDATE nodes SET owner_customer_id = ?, claimed_at = ? WHERE mac = ?",
		body.CustomerID, now, mac,
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "device_assign", "mac="+mac+" customer_id="+strconv.FormatUint(uint64(body.CustomerID), 10), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleAdminUnassignDevice godoc
// @Summary      解除设备归属
// @ID           AdminUnassignDevice
// @Description  管理员解除设备归属，恢复未认领状态（认领码重新生效）。
// @Tags         admin
// @Security     AdminSessionCookie
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} StatusResponse
// @Failure      404 {object} ErrorResponse
// @Router       /admin/nodes/{mac}/unassign [post]
func (h *Handler) HandleAdminUnassignDevice(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	res := h.DB.Exec(
		"UPDATE nodes SET owner_customer_id = NULL, claimed_at = NULL WHERE mac = ?", mac,
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "device_unassign", "mac="+mac, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}
