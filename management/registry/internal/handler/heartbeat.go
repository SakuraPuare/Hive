package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"hive/registry/internal/model"
)

// HandleHeartbeat godoc
// @Summary Node heartbeat
// @ID      NodeHeartbeat
// @Tags nodes
// @Security BearerAuth
// @Accept json
// @Produce json
// @Param body body model.HeartbeatRequest true "heartbeat data"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /nodes/heartbeat [post]
func (h *Handler) HandleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}

	var req model.HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.MAC == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac required")
		return
	}

	now := time.Now().UTC().Format(model.TimeLayout)

	h.DB.Model(&model.Node{}).Where("mac = ?", req.MAC).Update("last_seen", now)

	if err := h.DB.Exec(`
		INSERT INTO node_status_checks (mac, status, latency_ms, cpu_pct, mem_pct, disk_pct, uptime_sec, checked_at)
		VALUES (?, 'online', NULL, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			status='online', cpu_pct=VALUES(cpu_pct), mem_pct=VALUES(mem_pct),
			disk_pct=VALUES(disk_pct), uptime_sec=VALUES(uptime_sec), checked_at=VALUES(checked_at)
	`, req.MAC, req.CPUPct, req.MemPct, req.DiskPct, req.UptimeSec, now).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, map[string]string{"status": "ok"})
}
