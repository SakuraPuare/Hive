package handler

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// commandActions is the whitelist of remote actions a device will execute.
// The node-side agent (hive-command-agent) maps each to a concrete systemctl/
// reboot call; anything outside this set is rejected at enqueue time so an
// attacker who reaches the enqueue endpoint can't run arbitrary strings.
var commandActions = map[string]bool{
	"reboot":          true,
	"restart-xray":    true, // systemctl restart xray
	"restart-mihomo":  true, // systemctl restart hive-mihomo (gateway role)
	"resync":          true, // re-pull configs: hive-xray-sync + hive-clash-sync
	"service-control": true, // params = {"service","operation"}; both are allowlisted below
	"hotspot-config":  true, // params = Wi-Fi AP fields; validated below
}

var serviceControlServices = map[string]bool{
	"xray": true, "xray-exporter": true, "cloudflared": true, "frpc": true, "easytier": true,
	"hive-mihomo": true, "hive-hotspot": true, "hive-gateway": true,
	"hive-firewall": true, "hive-fail2ban": true, "nginx": true,
	"tailscaled": true, "warp-svc": true, "hive-xray-sync.timer": true,
	"hive-clash-sync.timer": true, "hive-command-agent.timer": true,
	"hive-updater.timer": true,
}

var serviceControlOperations = map[string]bool{
	"start": true, "stop": true, "restart": true, "status": true,
}

var (
	hotspotTextPattern    = regexp.MustCompile(`^[ -~]+$`)
	hotspotCountryPattern = regexp.MustCompile(`^[A-Za-z]{2}$`)
	hotspotChannels       = map[string]bool{
		"36": true, "40": true, "44": true, "48": true, "52": true, "56": true, "60": true, "64": true,
		"100": true, "104": true, "108": true, "112": true, "116": true, "120": true, "124": true,
		"128": true, "132": true, "136": true, "140": true, "144": true, "149": true, "153": true,
		"157": true, "161": true, "165": true,
	}
)

type hotspotConfigParams struct {
	SSID2G     string `json:"ssid2g"`
	SSID5G     string `json:"ssid5g"`
	PSK        string `json:"psk"`
	Country    string `json:"country"`
	Channel5G  string `json:"channel5g"`
	Width5G    string `json:"width5g"`
	PreferBand string `json:"preferBand"`
}

func validHotspotText(v string, min, max int) bool {
	return v == "" || (len(v) >= min && len(v) <= max && hotspotTextPattern.MatchString(v))
}

func validateHotspotConfig(raw string) bool {
	var p hotspotConfigParams
	if json.Unmarshal([]byte(raw), &p) != nil {
		return false
	}
	if !validHotspotText(p.SSID2G, 1, 32) || !validHotspotText(p.SSID5G, 1, 32) ||
		!validHotspotText(p.PSK, 8, 63) ||
		(p.Country != "" && !hotspotCountryPattern.MatchString(p.Country)) ||
		(p.Channel5G != "" && !hotspotChannels[p.Channel5G]) ||
		(p.Width5G != "" && p.Width5G != "20" && p.Width5G != "40" && p.Width5G != "80") ||
		(p.PreferBand != "" && p.PreferBand != "5" && p.PreferBand != "2.4") {
		return false
	}
	return true
}

// commandTTL bounds how long a pending command stays claimable. Past this the
// node-pull endpoint lazily marks it 'expired' instead of handing it out, so a
// device that was offline for a long time doesn't suddenly reboot on next boot.
const commandTTL = 10 * time.Minute

// commandRecentLimit caps how many rows the list endpoints return (newest first).
const commandRecentLimit = 50

// enqueueCommandRequest is the body for both the customer and admin enqueue endpoints.
type enqueueCommandRequest struct {
	Action string `json:"action" example:"restart-xray"`
	Params string `json:"params,omitempty" example:""`
}

// ackCommandRequest is the body a node posts back after executing a command.
type ackCommandRequest struct {
	Status string `json:"status" example:"done"` // done | failed
	Result string `json:"result" example:"ok"`   // stdout/err snippet or error text
}

// enqueueCommand validates the action and inserts one pending row for mac,
// attributed to actor. Returns the new id, or an HTTP error written to w.
func (h *Handler) enqueueCommand(w http.ResponseWriter, mac, actor string, body enqueueCommandRequest, ip string) (uint64, bool) {
	if !commandActions[body.Action] {
		h.jsonErr(w, http.StatusBadRequest, "unsupported action")
		return 0, false
	}
	if len(body.Params) > 512 {
		h.jsonErr(w, http.StatusBadRequest, "params too long")
		return 0, false
	}
	if body.Action == "service-control" {
		var params struct {
			Service   string `json:"service"`
			Operation string `json:"operation"`
		}
		if err := json.Unmarshal([]byte(body.Params), &params); err != nil ||
			!serviceControlServices[params.Service] || !serviceControlOperations[params.Operation] {
			h.jsonErr(w, http.StatusBadRequest, "invalid service control params")
			return 0, false
		}
	}
	if body.Action == "hotspot-config" && !validateHotspotConfig(body.Params) {
		h.jsonErr(w, http.StatusBadRequest, "invalid hotspot config params")
		return 0, false
	}
	now := time.Now().UTC().Format(model.TimeLayout)
	res := h.DB.Exec(
		"INSERT INTO node_commands (node_mac, action, params, status, created_by, created_at) "+
			"VALUES (?, ?, ?, 'pending', ?, ?)",
		mac, body.Action, body.Params, actor, now,
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return 0, false
	}
	var id uint64
	h.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&id)
	store.WriteAuditLog(h.DB, actor, "device_command_enqueue", "mac="+mac+" action="+body.Action, ip)
	return id, true
}

// listCommands returns the newest commands for mac (both endpoints share it).
func (h *Handler) listCommands(w http.ResponseWriter, mac string) {
	items := make([]model.DeviceCommand, 0)
	if err := h.DB.Raw(
		"SELECT id, node_mac, action, params, status, result, created_by, created_at, sent_at, acked_at "+
			"FROM node_commands WHERE node_mac = ? ORDER BY id DESC LIMIT ?", mac, commandRecentLimit,
	).Scan(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, items)
}

// ── 客户门户 ──────────────────────────────────────────────────────────────────

// HandlePortalEnqueueCommand godoc
// @Summary      给我的设备下发命令
// @ID           PortalEnqueueDeviceCommand
// @Description  客户对自己名下设备下发白名单命令（重启、配置同步、热点配置或 allowlisted service-control）。节点下次心跳周期拉取执行并回传结果。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Accept       json
// @Param        mac  path string                true "设备 MAC"
// @Param        body body enqueueCommandRequest true "命令"
// @Success      200 {object} map[string]uint64
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/commands [post]
func (h *Handler) HandlePortalEnqueueCommand(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, cid); !ok {
		return
	}
	var body enqueueCommandRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	id, ok := h.enqueueCommand(w, mac, customerActor(cid), body, getClientIP(r))
	if !ok {
		return
	}
	h.jsonOK(w, map[string]uint64{"id": id})
}

// HandlePortalListCommands godoc
// @Summary      我的设备命令历史
// @ID           PortalListDeviceCommands
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {array}  model.DeviceCommand
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/commands [get]
func (h *Handler) HandlePortalListCommands(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	mac := r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, cid); !ok {
		return
	}
	h.listCommands(w, mac)
}

// ── 管理端 ────────────────────────────────────────────────────────────────────

// HandleAdminEnqueueCommand godoc
// @Summary      给设备下发命令（管理员）
// @ID           AdminEnqueueDeviceCommand
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Param        mac  path string                true "设备 MAC"
// @Param        body body enqueueCommandRequest true "命令"
// @Success      200 {object} map[string]uint64
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /admin/nodes/{mac}/commands [post]
func (h *Handler) HandleAdminEnqueueCommand(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	var cnt int64
	if err := h.DB.Raw("SELECT COUNT(*) FROM nodes WHERE mac = ?", mac).Scan(&cnt).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if cnt == 0 {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	var body enqueueCommandRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	enqueue := func(w http.ResponseWriter, r *http.Request) {
		actor, _, _ := h.Auth.ParseSession(r)
		id, ok := h.enqueueCommand(w, mac, actor, body, getClientIP(r))
		if ok {
			h.jsonOK(w, map[string]uint64{"id": id})
		}
	}
	enqueue(w, r)
}

// HandleAdminListCommands godoc
// @Summary      设备命令历史（管理员）
// @ID           AdminListDeviceCommands
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {array}  model.DeviceCommand
// @Router       /admin/nodes/{mac}/commands [get]
func (h *Handler) HandleAdminListCommands(w http.ResponseWriter, r *http.Request) {
	h.listCommands(w, r.PathValue("mac"))
}

// ── 节点侧（设备鉴权 Bearer API_SECRET）──────────────────────────────────────

// HandleNodePullCommands godoc
// @Summary      节点拉取待执行命令
// @ID           NodePullCommands
// @Description  节点定时轮询本机 MAC 的 pending 命令。返回前把它们置为 sent 并记录 sent_at；超过 TTL 的 pending 惰性标记 expired、不再下发。设备鉴权（Bearer API_SECRET）。
// @Tags         nodes
// @Security     BearerAuth
// @Produce      json
// @Param        mac path string true "node MAC"
// @Success      200 {array}  model.DeviceCommand
// @Failure      401 {object} ErrorResponse
// @Router       /nodes/{mac}/commands [get]
func (h *Handler) HandleNodePullCommands(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	mac := r.PathValue("mac")
	now := time.Now().UTC()
	nowStr := now.Format(model.TimeLayout)

	// 惰性过期：TTL 之前仍 pending 的命令置 expired，避免离线设备上线后执行陈旧命令。
	cutoff := now.Add(-commandTTL).Format(model.TimeLayout)
	if err := h.DB.Exec(
		"UPDATE node_commands SET status = 'expired' WHERE node_mac = ? AND status = 'pending' AND created_at < ?",
		mac, cutoff,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	// 领取：pending → sent，记 sent_at。先 UPDATE 再 SELECT sent 的这批，保证幂等
	// （同一命令只会被领一次）。单节点串行轮询，无需额外行锁。
	if err := h.DB.Exec(
		"UPDATE node_commands SET status = 'sent', sent_at = ? WHERE node_mac = ? AND status = 'pending'",
		nowStr, mac,
	).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	items := make([]model.DeviceCommand, 0)
	if err := h.DB.Raw(
		"SELECT id, node_mac, action, params, status, result, created_by, created_at, sent_at, acked_at "+
			"FROM node_commands WHERE node_mac = ? AND status = 'sent' ORDER BY id ASC", mac,
	).Scan(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, items)
}

// HandleNodeAckCommand godoc
// @Summary      节点回传命令执行结果
// @ID           NodeAckCommand
// @Description  节点执行完命令后回传 done/failed 与结果文本。仅能 ACK 本机 MAC 且处于 sent 的命令。设备鉴权（Bearer API_SECRET）。
// @Tags         nodes
// @Security     BearerAuth
// @Accept       json
// @Param        mac path string            true "node MAC"
// @Param        id  path int               true "command id"
// @Param        body body ackCommandRequest true "执行结果"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      401 {object} ErrorResponse
// @Router       /nodes/{mac}/commands/{id}/ack [post]
func (h *Handler) HandleNodeAckCommand(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	mac := r.PathValue("mac")
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body ackCommandRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	status := "done"
	if body.Status == "failed" {
		status = "failed"
	}
	result := body.Result
	if len(result) > 1024 {
		result = result[:1024]
	}
	now := time.Now().UTC().Format(model.TimeLayout)
	// 只接受对本机 sent 命令的 ACK（防跨设备/重复 ACK 改写终态）。
	res := h.DB.Exec(
		"UPDATE node_commands SET status = ?, result = ?, acked_at = ? WHERE id = ? AND node_mac = ? AND status = 'sent'",
		status, result, now, id, mac,
	)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		h.jsonErr(w, http.StatusBadRequest, "command not found or not in sent state")
		return
	}
	h.jsonOK(w, map[string]string{"status": "ok"})
}
