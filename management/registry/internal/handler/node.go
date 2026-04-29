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

// HandleRegister godoc
// @Summary Register a node
// @ID      NodeRegister
// @Description Register a new node or update an existing one by MAC address
// @Tags nodes
// @Security BearerAuth
// @Accept json
// @Produce json
// @Param body body NodeRegisterRequest true "node info"
// @Success 200 {object} NodeRegisterResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Router /nodes/register [post]
func (h *Handler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}

	var body struct {
		MAC          string `json:"mac"`
		MAC6         string `json:"mac6"`
		Hostname     string `json:"hostname"`
		CFURL        string `json:"cf_url"`
		TunnelID     string `json:"tunnel_id"`
		XrayUUID     string `json:"xray_uuid"`
		MeshTunnelID string `json:"mesh_tunnel_id"`
		MeshIP       string `json:"mesh_ip"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.MAC == "" || body.Hostname == "" || body.CFURL == "" || body.XrayUUID == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac, hostname, cf_url, xray_uuid required")
		return
	}

	now := time.Now().UTC().Format(model.TimeLayout)

	var existing model.Node
	if err := h.DB.Where("mac = ?", body.MAC).First(&existing).Error; err != nil && err.Error() != "record not found" {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	if existing.MAC != "" {
		if err := h.DB.Model(&model.Node{}).Where("mac = ?", body.MAC).Updates(map[string]any{
			"mac6":           body.MAC6,
			"hostname":       body.Hostname,
			"cf_url":         body.CFURL,
			"tunnel_id":      body.TunnelID,
			"xray_uuid":      body.XrayUUID,
			"mesh_tunnel_id": body.MeshTunnelID,
			"mesh_ip":        body.MeshIP,
			"last_seen":      now,
		}).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
		h.jsonOK(w, map[string]any{
			"status":        "updated",
			"hostname":      body.Hostname,
			"registered_at": existing.RegisteredAt,
		})
	} else {
		if err := h.DB.Exec(
			"INSERT INTO nodes (mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, xray_uuid, mesh_tunnel_id, mesh_ip, registered_at, last_seen) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
			body.MAC, body.MAC6, body.Hostname, body.CFURL, body.TunnelID, body.XrayUUID, body.MeshTunnelID, body.MeshIP, now, now,
		).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
		middleware.RefreshNodeGauge(h.DB)
		h.jsonOK(w, map[string]any{
			"status":        "registered",
			"hostname":      body.Hostname,
			"registered_at": now,
		})
	}
}

// HandleListNodes godoc
// @Summary List nodes
// @ID      NodesList
// @Description List all nodes with optional filters
// @Tags admin
// @Security AdminSessionCookie
// @Produce json
// @Param status query string false "filter by status"
// @Param enabled query string false "filter by enabled (0 or 1)"
// @Param region query string false "filter by region"
// @Param search query string false "search hostname, location, note, or mac"
// @Success 200 {array} model.Node
// @Failure 500 {object} ErrorResponse
// @Router /nodes [get]
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
	if v := q.Get("region"); v != "" {
		conditions = append(conditions, "n.region = ?")
		args = append(args, v)
	}
	if v := q.Get("search"); v != "" {
		conditions = append(conditions, "(n.hostname LIKE ? OR n.location LIKE ? OR n.note LIKE ? OR n.mac LIKE ?)")
		like := "%" + v + "%"
		args = append(args, like, like, like, like)
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

// HandleGetNode godoc
// @Summary Get a node
// @ID      NodeGet
// @Description Get a single node by MAC address
// @Tags admin
// @Security AdminSessionCookie
// @Produce json
// @Param mac path string true "node MAC address"
// @Success 200 {object} model.Node
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /nodes/{mac} [get]
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

// HandleUpdateNode godoc
// @Summary Update a node
// @ID      NodeUpdate
// @Description Update allowed fields of a node by MAC address
// @Tags admin
// @Security AdminSessionCookie
// @Accept json
// @Produce json
// @Param mac path string true "node MAC address"
// @Param body body NodeUpdateRequest true "fields to update"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /nodes/{mac} [patch]
func (h *Handler) HandleUpdateNode(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")

	var existing model.Node
	if err := h.DB.Where("mac = ?", mac).First(&existing).Error; err != nil {
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
		"region": true, "mesh_tunnel_id": true, "mesh_ip": true,
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

// HandleDeleteNode godoc
// @Summary Delete a node
// @ID      NodeDelete
// @Description Delete a node by MAC address
// @Tags admin
// @Security AdminSessionCookie
// @Produce json
// @Param mac path string true "node MAC address"
// @Success 200 {object} StatusResponse
// @Failure 404 {object} ErrorResponse
// @Router /nodes/{mac} [delete]
func (h *Handler) HandleDeleteNode(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	result := h.DB.Where("mac = ?", mac).Delete(&model.Node{})
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	middleware.RefreshNodeGauge(h.DB)

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "node_delete", "mac="+mac, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}
