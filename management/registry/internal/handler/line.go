package handler

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"hive/registry/internal/middleware"
	"hive/registry/internal/model"
	"hive/registry/internal/store"

	"gorm.io/gorm"
)

type CreateLineRequest struct {
	Name         string `json:"name"`
	Region       string `json:"region"`
	DisplayOrder *int   `json:"display_order"`
	Note         string `json:"note"`
}

type UpdateLineRequest struct {
	Name         *string `json:"name"`
	Region       *string `json:"region"`
	DisplayOrder *int    `json:"display_order"`
	Enabled      *bool   `json:"enabled"`
	Note         *string `json:"note"`
}

type SetLineNodesRequest struct {
	Nodes []string `json:"nodes"`
}

// HandleListLines handles GET /admin/lines
func (h *Handler) HandleListLines(w http.ResponseWriter, r *http.Request) {
	var lines []model.Line
	err := h.DB.Raw(
		"SELECT l.*, (SELECT COUNT(*) FROM line_nodes ln WHERE ln.line_id = l.id) AS node_count " +
			"FROM `lines` l ORDER BY l.display_order, l.id",
	).Scan(&lines).Error
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, lines)
}

// HandleCreateLine handles POST /admin/lines
func (h *Handler) HandleCreateLine(w http.ResponseWriter, r *http.Request) {
	var req CreateLineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" {
		h.jsonErr(w, http.StatusBadRequest, "name required")
		return
	}

	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "token: "+err.Error())
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	l := model.Line{
		Name:      req.Name,
		Region:    req.Region,
		Note:      req.Note,
		Token:     token,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if req.DisplayOrder != nil {
		l.DisplayOrder = *req.DisplayOrder
	}
	if err := h.DB.Create(&l).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "line_create", "name: "+req.Name, getClientIP(r))
	h.jsonOK(w, map[string]any{"id": l.ID, "token": token})
}

// HandleUpdateLine handles PATCH /admin/lines/{id}
func (h *Handler) HandleUpdateLine(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	var req UpdateLineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	updates := map[string]any{
		"updated_at": time.Now().UTC().Format("2006-01-02 15:04:05"),
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Region != nil {
		updates["region"] = *req.Region
	}
	if req.DisplayOrder != nil {
		updates["display_order"] = *req.DisplayOrder
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.Note != nil {
		updates["note"] = *req.Note
	}

	result := h.DB.Model(&model.Line{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "line not found")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "line_update", fmt.Sprintf("id=%d", id), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleDeleteLine handles DELETE /admin/lines/{id}
func (h *Handler) HandleDeleteLine(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	result := h.DB.Delete(&model.Line{}, id)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "line not found")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "line_delete", fmt.Sprintf("id=%d", id), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleGetLineNodes handles GET /admin/lines/{id}/nodes
func (h *Handler) HandleGetLineNodes(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	var macs []string
	h.DB.Model(&model.LineNode{}).Where("line_id = ?", id).Pluck("node_mac", &macs)
	h.jsonOK(w, macs)
}

// HandleSetLineNodes handles PUT /admin/lines/{id}/nodes
func (h *Handler) HandleSetLineNodes(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	var req SetLineNodesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	var l model.Line
	if err := h.DB.First(&l, id).Error; err == gorm.ErrRecordNotFound {
		h.jsonErr(w, http.StatusNotFound, "line not found")
		return
	}

	err = h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("line_id = ?", id).Delete(&model.LineNode{}).Error; err != nil {
			return err
		}
		for _, mac := range req.Nodes {
			if err := tx.Create(&model.LineNode{LineID: uint(id), NodeMAC: mac}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.Line{}).Where("id = ?", id).
			Update("updated_at", time.Now().UTC().Format("2006-01-02 15:04:05")).Error
	})
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "line_set_nodes",
		fmt.Sprintf("line_id=%d count=%d", id, len(req.Nodes)), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleResetLineToken handles POST /admin/lines/{id}/reset-token
func (h *Handler) HandleResetLineToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "token: "+err.Error())
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	result := h.DB.Model(&model.Line{}).Where("id = ?", id).Updates(map[string]any{
		"token":      token,
		"updated_at": now,
	})
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "line not found")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "line_reset_token", fmt.Sprintf("line_id=%d", id), getClientIP(r))
	h.jsonOK(w, ResetTokenResponse{Token: token})
}

// queryLineNodes looks up a line by token and returns its name and nodes.
func (h *Handler) queryLineNodes(token string) (lineName string, nodes []model.Node, err error) {
	var l model.Line
	if err = h.DB.Where("token = ?", token).First(&l).Error; err != nil {
		return "", nil, err
	}

	var macs []string
	h.DB.Model(&model.LineNode{}).Where("line_id = ?", l.ID).Pluck("node_mac", &macs)

	nodes, err = h.queryNodesByMACs(macs)
	return l.Name, nodes, err
}

// HandlePublicLineVless handles GET /l/{token}
func (h *Handler) HandlePublicLineVless(w http.ResponseWriter, r *http.Request) {
	middleware.SubscriptionRequestsTotal.WithLabelValues("public_line_vless").Inc()

	token := r.PathValue("token")
	if len(token) != 64 {
		http.NotFound(w, r)
		return
	}

	lineName, nodes, err := h.queryLineNodes(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	var links []string
	for _, n := range nodes {
		host := stripScheme(n.CFURL)
		if host == "" || n.XrayUUID == "" {
			continue
		}
		name := buildNodeName(n)
		params := url.Values{}
		params.Set("type", "ws")
		params.Set("security", "tls")
		params.Set("sni", host)
		params.Set("path", fmt.Sprintf("/%s?ed=2560", h.Config.XrayPath))
		link := fmt.Sprintf("vless://%s@%s:443?%s#%s",
			n.XrayUUID, host, params.Encode(), url.PathEscape(name))
		links = append(links, link)
	}

	content := base64.StdEncoding.EncodeToString([]byte(strings.Join(links, "\n")))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="hive-%s.txt"`, lineName))
	fmt.Fprint(w, content)
}

// HandlePublicLineClash handles GET /l/{token}/clash
func (h *Handler) HandlePublicLineClash(w http.ResponseWriter, r *http.Request) {
	middleware.SubscriptionRequestsTotal.WithLabelValues("public_line_clash").Inc()

	token := r.PathValue("token")
	if len(token) != 64 {
		http.NotFound(w, r)
		return
	}

	lineName, nodes, err := h.queryLineNodes(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	yaml := h.buildGroupClashYAML(lineName, nodes)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="hive-%s.yaml"`, lineName))
	fmt.Fprint(w, yaml)
}
