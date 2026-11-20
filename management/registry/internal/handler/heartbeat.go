package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
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

	var req model.HeartbeatRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.MAC = strings.ToLower(req.MAC)
	if !h.Auth.RequireDeviceAuth(w, r, req.MAC) {
		return
	}
	if req.MAC == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac required")
		return
	}
	// Service and address snapshots are auxiliary: an invalid one (e.g. an agent
	// that already knows a unit this registry has not whitelisted yet, or a node
	// clock ahead before NTP sync) is dropped and the previous sample kept, but
	// it must never cost the heartbeat itself and mark the node offline.
	var serviceJSON []byte
	if req.Services != nil {
		if states, ok := normalizeServiceStates(req.Services); ok {
			serviceJSON, _ = json.Marshal(states)
		} else {
			log.Printf("heartbeat: dropping invalid service snapshot for mac=%s", req.MAC)
		}
	}
	var addressJSON []byte
	if req.Addresses != nil {
		if snapshot, ok := normalizeDeviceAddresses(*req.Addresses); ok {
			addressJSON, _ = json.Marshal(snapshot)
		} else {
			log.Printf("heartbeat: dropping invalid address snapshot for mac=%s", req.MAC)
		}
	}

	now := time.Now().UTC().Format(model.TimeLayout)

	if err := h.DB.Model(&model.Node{}).Where("mac = ?", req.MAC).Update("last_seen", now).Error; err != nil {
		log.Printf("heartbeat: update last_seen for mac=%s: %v", req.MAC, err)
	}

	// 出口所在国家由 agent 上报（cloudflare trace 的 loc）；旧 agent 不发该字段，
	// 空值不能覆盖已有值，否则 auto 分流会在旧节点升级后被误判成"未知"。
	if country := normalizeCountry(req.Country); country != "" {
		if err := h.DB.Model(&model.Node{}).Where("mac = ?", req.MAC).Update("country", country).Error; err != nil {
			log.Printf("heartbeat: update country for mac=%s: %v", req.MAC, err)
		}
	}
	if serviceJSON != nil {
		if err := h.DB.Model(&model.Node{}).Where("mac = ?", req.MAC).Updates(map[string]any{
			"service_states":      string(serviceJSON),
			"services_sampled_at": time.Now().UTC().Format(time.RFC3339),
		}).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
	}
	if addressJSON != nil {
		if err := h.DB.Model(&model.Node{}).Where("mac = ?", req.MAC).Updates(map[string]any{
			"address_snapshot":     string(addressJSON),
			"addresses_sampled_at": time.Now().UTC().Format(time.RFC3339),
		}).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
	}

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
