package handler

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── 管理端：OTA Rollout CRUD + 分配 ─────────────────────────────────────────

type createRolloutRequest struct {
	Version  string   `json:"version"`
	URL      string   `json:"url"`
	SHA256   string   `json:"sha256"`
	Note     string   `json:"note"`
	NodeMACs []string `json:"node_macs,omitempty"`
}

type otaRolloutItem struct {
	model.OtaRollout
	Total      int `json:"total"`
	Pending    int `json:"pending"`
	Done       int `json:"done"`
	Failed     int `json:"failed"`
	Installing int `json:"installing"`
	RolledBack int `json:"rolled_back"`
}

type otaAckRequest struct {
	AssignmentToken string `json:"assignment_token"`
	Version         string `json:"version"`
	Status          string `json:"status"`
	Result          string `json:"result"`
}

// HandleAdminListRollouts godoc
// @Summary      OTA rollout 列表
// @ID           AdminListOtaRollouts
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {array} otaRolloutItem
// @Router       /admin/ota/rollouts [get]
func (h *Handler) HandleAdminListRollouts(w http.ResponseWriter, r *http.Request) {
	var rollouts []model.OtaRollout
	if err := h.DB.Raw(
		"SELECT id, version, url, sha256, note, created_by, created_at FROM ota_rollouts ORDER BY id DESC LIMIT 100",
	).Scan(&rollouts).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	items := make([]otaRolloutItem, 0, len(rollouts))
	for _, ro := range rollouts {
		item := otaRolloutItem{OtaRollout: ro}
		h.DB.Raw("SELECT COUNT(*) FROM ota_assignments WHERE rollout_id = ?", ro.ID).Scan(&item.Total)
		h.DB.Raw("SELECT COUNT(*) FROM ota_assignments WHERE rollout_id = ? AND status = 'pending'", ro.ID).Scan(&item.Pending)
		h.DB.Raw("SELECT COUNT(*) FROM ota_assignments WHERE rollout_id = ? AND status = 'done'", ro.ID).Scan(&item.Done)
		h.DB.Raw("SELECT COUNT(*) FROM ota_assignments WHERE rollout_id = ? AND status = 'failed'", ro.ID).Scan(&item.Failed)
		h.DB.Raw("SELECT COUNT(*) FROM ota_assignments WHERE rollout_id = ? AND status = 'installing'", ro.ID).Scan(&item.Installing)
		h.DB.Raw("SELECT COUNT(*) FROM ota_assignments WHERE rollout_id = ? AND status = 'rolled_back'", ro.ID).Scan(&item.RolledBack)
		items = append(items, item)
	}
	h.jsonOK(w, items)
}

// HandleAdminCreateRollout godoc
// @Summary      创建 OTA rollout（可选同时分配节点）
// @ID           AdminCreateOtaRollout
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Param        body body createRolloutRequest true "rollout"
// @Success      200 {object} map[string]any
// @Failure      400 {object} ErrorResponse
// @Router       /admin/ota/rollouts [post]
func (h *Handler) HandleAdminCreateRollout(w http.ResponseWriter, r *http.Request) {
	var body createRolloutRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.Version == "" || body.URL == "" || body.SHA256 == "" {
		h.jsonErr(w, http.StatusBadRequest, "version, url, sha256 required")
		return
	}
	if len(body.SHA256) != 64 {
		h.jsonErr(w, http.StatusBadRequest, "sha256 must be 64 hex chars")
		return
	}
	if _, err := hex.DecodeString(body.SHA256); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "sha256 must be 64 hex chars")
		return
	}
	body.SHA256 = strings.ToLower(body.SHA256)
	if err := h.validateOTASource(body.Version, body.URL, body.SHA256); err != nil {
		h.jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	now := time.Now().UTC().Format(model.TimeLayout)

	var rolloutID uint
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			"INSERT INTO ota_rollouts (version, url, sha256, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			body.Version, body.URL, strings.ToLower(body.SHA256), body.Note, actor, now,
		).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&rolloutID).Error
	}); err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	assigned := 0
	if len(body.NodeMACs) > 0 {
		assigned = h.assignNodesToRollout(rolloutID, body.NodeMACs, now)
	}

	store.WriteAuditLog(h.DB, actor, "ota_create_rollout",
		"id="+strconv.FormatUint(uint64(rolloutID), 10)+" version="+body.Version+" nodes="+strconv.Itoa(assigned),
		getClientIP(r))

	h.jsonOK(w, map[string]any{"id": rolloutID, "assigned": assigned})
}

// HandleAdminGetRollout godoc
// @Summary      OTA rollout 详情（含节点分配状态）
// @ID           AdminGetOtaRollout
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        id path int true "rollout id"
// @Success      200 {object} map[string]any
// @Failure      404 {object} ErrorResponse
// @Router       /admin/ota/rollouts/{id} [get]
func (h *Handler) HandleAdminGetRollout(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var ro model.OtaRollout
	if err := h.DB.Raw(
		"SELECT id, version, url, sha256, note, created_by, created_at FROM ota_rollouts WHERE id = ?", id,
	).Scan(&ro).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if ro.ID == 0 {
		h.jsonErr(w, http.StatusNotFound, "rollout not found")
		return
	}
	var assignments []model.OtaAssignment
	h.DB.Raw(
		"SELECT node_mac, rollout_id, status, result, assigned_at, acked_at FROM ota_assignments WHERE rollout_id = ? ORDER BY node_mac",
		id,
	).Scan(&assignments)

	h.jsonOK(w, map[string]any{"rollout": ro, "assignments": assignments})
}

type assignRequest struct {
	NodeMACs []string `json:"node_macs"`
}

// HandleAdminAssignOta godoc
// @Summary      给节点分配 OTA 版本
// @ID           AdminAssignOta
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Param        id   path int           true "rollout id"
// @Param        body body assignRequest true "节点列表"
// @Success      200 {object} map[string]int
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /admin/ota/rollouts/{id}/assign [post]
func (h *Handler) HandleAdminAssignOta(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var cnt int64
	h.DB.Raw("SELECT COUNT(*) FROM ota_rollouts WHERE id = ?", id).Scan(&cnt)
	if cnt == 0 {
		h.jsonErr(w, http.StatusNotFound, "rollout not found")
		return
	}
	var body assignRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(body.NodeMACs) == 0 {
		h.jsonErr(w, http.StatusBadRequest, "node_macs required")
		return
	}
	now := time.Now().UTC().Format(model.TimeLayout)
	assigned := h.assignNodesToRollout(uint(id), body.NodeMACs, now)

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "ota_assign",
		"rollout="+strconv.FormatUint(id, 10)+" nodes="+strconv.Itoa(assigned),
		getClientIP(r))

	h.jsonOK(w, map[string]int{"assigned": assigned})
}

func (h *Handler) assignNodesToRollout(rolloutID uint, macs []string, now string) int {
	assigned := 0
	for _, mac := range macs {
		mac = normalizeOtaMAC(mac)
		if mac == "" {
			continue
		}
		assignmentToken, err := generateToken()
		if err != nil {
			continue
		}
		// 每次分配生成独立标识，旧回执不能覆盖新任务。
		res := h.DB.Exec(
			"REPLACE INTO ota_assignments (node_mac, rollout_id, status, result, assigned_at, assignment_token) VALUES (?, ?, 'pending', '', ?, ?)",
			mac, rolloutID, now, assignmentToken,
		)
		if res.Error == nil && res.RowsAffected > 0 {
			assigned++
		}
	}
	return assigned
}

func normalizeOtaMAC(mac string) string {
	mac = strings.ToLower(strings.NewReplacer(":", "", "-", "").Replace(strings.TrimSpace(mac)))
	if len(mac) != 12 {
		return ""
	}
	if _, err := hex.DecodeString(mac); err != nil {
		return ""
	}
	return mac
}

// ── 节点侧：轮询 OTA 版本 + 回传结果 ───────────────────────────────────────

// HandleNodeOtaVersion godoc
// @Summary      节点查询待安装 OTA 版本
// @ID           NodeOtaVersion
// @Description  hive-updater.timer 定时调用，返回当前分配给本节点的 pending OTA bundle 信息。无分配或已完成时返回空 version。
// @Tags         nodes
// @Security     BearerAuth
// @Produce      json
// @Param        mac path string true "node MAC"
// @Success      200 {object} map[string]string
// @Router       /nodes/{mac}/ota-version [get]
func (h *Handler) HandleNodeOtaVersion(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	mac := normalizeOtaMAC(r.PathValue("mac"))
	if mac == "" {
		h.jsonErr(w, http.StatusBadRequest, "invalid node mac")
		return
	}

	type row struct {
		AssignmentToken string
		Version         string
		URL             string
		SHA256          string
	}
	var res row
	h.DB.Raw(`
		SELECT r.version, r.url, r.sha256, a.assignment_token
		FROM ota_assignments a
		JOIN ota_rollouts r ON r.id = a.rollout_id
		WHERE a.node_mac = ? AND a.status IN ('pending', 'installing')
	`, mac).Scan(&res)
	if strings.HasPrefix(res.URL, otaArtifactPrefix) {
		res.URL = "/nodes/" + mac + "/ota-bundle/" + res.SHA256
	}

	h.jsonOK(w, map[string]string{
		"version":          res.Version,
		"assignment_token": res.AssignmentToken,
		"url":              res.URL,
		"sha256":           res.SHA256,
	})
}

// HandleNodeOtaAck godoc
// @Summary      节点回传 OTA 安装结果
// @ID           NodeOtaAck
// @Description  上报 installing、done、failed 或 rolled_back；仅当前分配任务可更新，终态不可覆盖。
// @Tags         nodes
// @Security     BearerAuth
// @Accept       json
// @Param        mac  path string true "node MAC"
// @Param        body body otaAckRequest true "结果"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Router       /nodes/{mac}/ota-ack [post]
func (h *Handler) HandleNodeOtaAck(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	mac := normalizeOtaMAC(r.PathValue("mac"))
	if mac == "" {
		h.jsonErr(w, http.StatusBadRequest, "invalid node mac")
		return
	}

	var body otaAckRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.AssignmentToken == "" || body.Version == "" || (body.Status != "done" && body.Status != "failed" && body.Status != "installing" && body.Status != "rolled_back") {
		h.jsonErr(w, 400, "assignment_token, version and valid OTA status required")
		return
	}
	status := body.Status
	result := body.Result
	if len(result) > 1024 {
		result = result[:1024]
	}
	now := time.Now().UTC().Format(model.TimeLayout)

	query := `UPDATE ota_assignments a JOIN ota_rollouts r ON r.id = a.rollout_id
        SET a.status = ?, a.result = ?, a.acked_at = ? WHERE a.node_mac = ?
        AND a.status IN ('pending', 'installing') AND a.assignment_token = ? AND r.version = ?`
	args := []any{status, result, now, mac, body.AssignmentToken, body.Version}
	if err := h.DB.Exec(query, args...).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, map[string]string{"status": "ok"})
}
