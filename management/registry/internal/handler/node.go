package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"hive/registry/internal/middleware"
	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// HandleRegister handles POST /nodes/register
func (h *Handler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}

	var body struct {
		MAC      string `json:"mac"`
		MAC6     string `json:"mac6"`
		Hostname string `json:"hostname"`
		CFURL    string `json:"cf_url"`
		TunnelID string `json:"tunnel_id"`
		XrayUUID string `json:"xray_uuid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.MAC == "" || body.Hostname == "" || body.CFURL == "" || body.XrayUUID == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac, hostname, cf_url, xray_uuid required")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	var existing model.Node
	h.DB.Where("mac = ?", body.MAC).First(&existing)

	if existing.MAC != "" {
		h.DB.Model(&model.Node{}).Where("mac = ?", body.MAC).Updates(map[string]any{
			"mac6":      body.MAC6,
			"hostname":  body.Hostname,
			"cf_url":    body.CFURL,
			"tunnel_id": body.TunnelID,
			"xray_uuid": body.XrayUUID,
			"last_seen": now,
		})
		h.jsonOK(w, map[string]any{
			"status":        "updated",
			"hostname":      body.Hostname,
			"registered_at": existing.RegisteredAt,
		})
	} else {
		h.DB.Exec(
			"INSERT INTO nodes (mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, xray_uuid, registered_at, last_seen) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
			body.MAC, body.MAC6, body.Hostname, body.CFURL, body.TunnelID, body.XrayUUID, now, now,
		)
		middleware.RefreshNodeGauge(h.DB)
		h.jsonOK(w, map[string]any{
			"status":        "registered",
			"hostname":      body.Hostname,
			"registered_at": now,
		})
	}
}

// HandleListNodes handles GET /nodes
func (h *Handler) HandleListNodes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := "SELECT " + model.NodeCols + " FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac"
	var args []any
	var conditions []string

	if v := q.Get("status"); v != "" {
		conditions = append(conditions, "n.status = ?")
		args = append(args, v)
	}
	if v := q.Get("enabled"); v != "" {
		conditions = append(conditions, "n.enabled = ?")
		args = append(args, v)
	}
	if v := q.Get("country"); v != "" {
		conditions = append(conditions, "n.country = ?")
		args = append(args, v)
	}
	if v := q.Get("region"); v != "" {
		conditions = append(conditions, "n.region = ?")
		args = append(args, v)
	}
	if v := q.Get("search"); v != "" {
		conditions = append(conditions, "(n.hostname LIKE ? OR n.location LIKE ? OR n.note LIKE ? OR n.mac LIKE ?)")
		like := "%" + v + "%"
		args = append(args, like, like, like, like)
	}
	if v := q.Get("tags"); v != "" {
		for _, tag := range strings.Split(v, ",") {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				conditions = append(conditions, "n.tags LIKE ?")
				args = append(args, "%"+tag+"%")
			}
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY n.hostname"

	var nodes []model.Node
	if err := h.DB.Raw(query, args...).Scan(&nodes).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if nodes == nil {
		nodes = []model.Node{}
	}
	h.jsonOK(w, nodes)
}

// HandleGetNode handles GET /nodes/{mac}
func (h *Handler) HandleGetNode(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	var node model.Node
	if err := h.DB.Raw("SELECT "+model.NodeCols+" FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac WHERE n.mac = ?", mac).Scan(&node).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if node.MAC == "" {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	h.jsonOK(w, node)
}

// HandleUpdateNode handles PATCH /nodes/{mac}
func (h *Handler) HandleUpdateNode(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")

	var existing model.Node
	h.DB.Where("mac = ?", mac).First(&existing)
	if existing.MAC == "" {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	allowed := map[string]bool{
		"location": true, "note": true, "tailscale_ip": true, "easytier_ip": true,
		"frp_port": true, "enabled": true, "status": true, "weight": true,
		"region": true, "country": true, "city": true, "tags": true, "offline_reason": true,
	}
	updates := make(map[string]any)
	for k, v := range body {
		if allowed[k] {
			updates[k] = v
		}
	}
	if len(updates) == 0 {
		h.jsonErr(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	if err := h.DB.Model(&model.Node{}).Where("mac = ?", mac).Updates(updates).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "node_update", fmt.Sprintf("mac=%s fields=%v", mac, updates), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleDeleteNode handles DELETE /nodes/{mac}
func (h *Handler) HandleDeleteNode(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	result := h.DB.Where("mac = ?", mac).Delete(&model.Node{})
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	middleware.RefreshNodeGauge(h.DB)

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "node_delete", "mac="+mac, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}
