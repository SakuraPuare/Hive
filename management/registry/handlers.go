package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// ── 认证 ─────────────────────────────────────────────────────────────────────

var apiSecret = getenv("API_SECRET", "")

// requireAuth 校验 Authorization: Bearer <token> 或 ?token= 查询参数。
// 未配置 API_SECRET 时放行所有请求。
func requireAuth(w http.ResponseWriter, r *http.Request) bool {
	if apiSecret == "" {
		return true
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" || token == r.Header.Get("Authorization") {
		token = r.URL.Query().Get("token")
	}
	if token != apiSecret {
		jsonErr(w, http.StatusUnauthorized, "unauthorized: invalid or missing Bearer token")
		return false
	}
	return true
}

// ── 请求结构体 ────────────────────────────────────────────────────────────────

type RegisterRequest struct {
	MAC         string `json:"mac"`
	MAC6        string `json:"mac6"`
	Hostname    string `json:"hostname"`
	CFURL       string `json:"cf_url"`
	TunnelID    string `json:"tunnel_id"`
	TailscaleIP string `json:"tailscale_ip"`
	EasytierIP  string `json:"easytier_ip"`
	FRPPort     int    `json:"frp_port"`
	XrayUUID    string `json:"xray_uuid"`
}

type UpdateRequest struct {
	Location    *string `json:"location"`
	Note        *string `json:"note"`
	TailscaleIP *string `json:"tailscale_ip"`
}

// ── 节点注册 ──────────────────────────────────────────────────────────────────

// POST /api/nodes/register
// 幂等：重复调用只更新业务字段，保留 location / note / registered_at
func handleRegister(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.MAC == "" || req.Hostname == "" || req.XrayUUID == "" {
		jsonErr(w, http.StatusBadRequest, "required: mac, hostname, xray_uuid")
		return
	}
	if req.TailscaleIP == "" {
		req.TailscaleIP = "pending"
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// INSERT ... ON DUPLICATE KEY UPDATE（MySQL 8.0.20+ / MySQL 9 row-alias 语法）：
	//   - location, note, registered_at 不覆盖（保留管理员标注和首次注册时间）
	//   - 其余字段随节点上报更新
	_, err := db.Exec(`
		INSERT INTO nodes
			(mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip,
			 easytier_ip, frp_port, xray_uuid, location, note, registered_at, last_seen)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?) AS nr
		ON DUPLICATE KEY UPDATE
			mac6         = nr.mac6,
			hostname     = nr.hostname,
			cf_url       = nr.cf_url,
			tunnel_id    = nr.tunnel_id,
			tailscale_ip = nr.tailscale_ip,
			easytier_ip  = nr.easytier_ip,
			frp_port     = nr.frp_port,
			xray_uuid    = nr.xray_uuid,
			last_seen    = nr.last_seen
	`, req.MAC, req.MAC6, req.Hostname, req.CFURL, req.TunnelID,
		req.TailscaleIP, req.EasytierIP, req.FRPPort, req.XrayUUID,
		now, now)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	var registeredAt string
	_ = db.QueryRow("SELECT registered_at FROM nodes WHERE mac=?", req.MAC).Scan(&registeredAt)

	jsonOK(w, map[string]string{
		"status":        "ok",
		"hostname":      req.Hostname,
		"registered_at": registeredAt,
	})

	// 异步放开 FRP 端口（非致命，不影响注册响应）
	if req.FRPPort > 0 {
		go func(port int, hostname string) {
			comment := fmt.Sprintf("FRP: %s", hostname)
			out, err := exec.Command("ufw", "allow", fmt.Sprintf("%d/tcp", port), "comment", comment).CombinedOutput()
			if err != nil {
				log.Printf("ufw allow %d/tcp failed: %v: %s", port, err, out)
			} else {
				log.Printf("ufw allowed %d/tcp for %s", port, hostname)
			}
		}(req.FRPPort, req.Hostname)
	}
}

// ── 节点查询 ──────────────────────────────────────────────────────────────────

// GET /api/nodes
func handleListNodes(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	rows, err := db.Query("SELECT " + nodeCols + " FROM nodes ORDER BY registered_at")
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()

	nodes := make([]Node, 0)
	for rows.Next() {
		n, err := scanNode(rows)
		if err != nil {
			jsonErr(w, http.StatusInternalServerError, "scan: "+err.Error())
			return
		}
		nodes = append(nodes, n)
	}
	jsonOK(w, nodes)
}

// GET /api/nodes/{mac}
func handleGetNode(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mac := r.PathValue("mac")
	row := db.QueryRow("SELECT "+nodeCols+" FROM nodes WHERE mac=?", mac)
	n, err := scanNodeRow(row)
	if err == sql.ErrNoRows {
		jsonErr(w, http.StatusNotFound, "node not found: "+mac)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	jsonOK(w, n)
}

// ── 节点管理 ──────────────────────────────────────────────────────────────────

// PATCH /api/nodes/{mac}  (需要认证)
// 允许更新 location、note、tailscale_ip
func handleUpdateNode(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mac := r.PathValue("mac")

	var req UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	setClauses := []string{}
	args := []any{}
	if req.Location != nil {
		setClauses = append(setClauses, "location=?")
		args = append(args, *req.Location)
	}
	if req.Note != nil {
		setClauses = append(setClauses, "note=?")
		args = append(args, *req.Note)
	}
	if req.TailscaleIP != nil {
		setClauses = append(setClauses, "tailscale_ip=?")
		args = append(args, *req.TailscaleIP)
	}
	if len(setClauses) == 0 {
		jsonErr(w, http.StatusBadRequest, "no updatable fields provided")
		return
	}
	args = append(args, mac)

	result, err := db.Exec(
		"UPDATE nodes SET "+strings.Join(setClauses, ", ")+", last_seen=NOW() WHERE mac=?",
		args...,
	)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		jsonErr(w, http.StatusNotFound, "node not found: "+mac)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

// DELETE /api/nodes/{mac}  (需要认证)
func handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mac := r.PathValue("mac")

	// 删除前先查端口，用于后续关闭防火墙规则
	var frpPort int
	var hostname string
	_ = db.QueryRow("SELECT frp_port, hostname FROM nodes WHERE mac=?", mac).Scan(&frpPort, &hostname)

	result, err := db.Exec("DELETE FROM nodes WHERE mac=?", mac)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		jsonErr(w, http.StatusNotFound, "node not found: "+mac)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})

	// 异步关闭 FRP 端口
	if frpPort > 0 {
		go func(port int, h string) {
			out, err := exec.Command("ufw", "delete", "allow", fmt.Sprintf("%d/tcp", port)).CombinedOutput()
			if err != nil {
				log.Printf("ufw delete %d/tcp failed: %v: %s", port, err, out)
			} else {
				log.Printf("ufw removed %d/tcp for %s", port, h)
			}
		}(frpPort, hostname)
	}
}

// ── Prometheus ────────────────────────────────────────────────────────────────

// GET /prometheus-targets  →  Prometheus file_sd 格式
// cron 每分钟调用（直连 Go 服务，无需经过 nginx）：
//   curl -sf http://127.0.0.1:8080/prometheus-targets > /etc/prometheus/targets/nodes.json
func handlePrometheusTargets(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	rows, err := db.Query(`
		SELECT hostname, tailscale_ip, easytier_ip, cf_url, location, mac6
		FROM nodes
		WHERE tailscale_ip != 'pending' AND tailscale_ip != ''
		ORDER BY hostname
	`)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()

	type promTarget struct {
		Targets []string          `json:"targets"`
		Labels  map[string]string `json:"labels"`
	}
	targets := make([]promTarget, 0)
	for rows.Next() {
		var hostname, tsIP, etIP, cfURL, location, mac6 string
		if err := rows.Scan(&hostname, &tsIP, &etIP, &cfURL, &location, &mac6); err != nil {
			continue
		}
		targets = append(targets, promTarget{
			Targets: []string{tsIP + ":9100"},
			Labels: map[string]string{
				"hostname": hostname, // 由 prometheus.yml relabel 重命名为 instance
				"cf_url":   cfURL,
				"location": location,
				"mac6":     mac6,
			},
		})
	}
	jsonOK(w, targets)
}

// ── 健康检查 ──────────────────────────────────────────────────────────────────

// GET /health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	if err := db.Ping(); err != nil {
		jsonErr(w, http.StatusServiceUnavailable, "db unavailable: "+err.Error())
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

// ── 标签打印页 ────────────────────────────────────────────────────────────────

// GET /api/labels  →  A4 可打印 HTML，每行 4 个
func handleLabels(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	rows, err := db.Query(
		"SELECT mac6, cf_url, location, registered_at FROM nodes ORDER BY registered_at",
	)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()

	cards := strings.Builder{}
	i := 0
	for rows.Next() {
		i++
		var mac6, cfURL, location, regAt string
		rows.Scan(&mac6, &cfURL, &location, &regAt)
		if location == "" {
			location = "—"
		}
		date := ""
		if len(regAt) >= 10 {
			date = regAt[:10]
		}
		fmt.Fprintf(&cards, `
		<div class="card">
			<div class="num">#%03d</div>
			<div class="id">%s</div>
			<div class="url">%s</div>
			<div class="loc">%s</div>
			<div class="ts">%s</div>
		</div>`, i, mac6, cfURL, location, date)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Hive Node Labels</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Courier New',monospace;background:#fff}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:12px}
  .card{border:1.5px solid #222;padding:8px;text-align:center;page-break-inside:avoid;min-height:90px}
  .num{font-size:26px;font-weight:bold;color:#111}
  .id{font-size:15px;color:#444;letter-spacing:2px;margin:2px 0}
  .url{font-size:9px;color:#555;word-break:break-all;margin:3px 0}
  .loc{font-size:11px;color:#333;font-style:italic}
  .ts{font-size:8px;color:#999;margin-top:2px}
  @media print{.grid{gap:4px;padding:8px}.card{border:1px solid black}}
</style>
</head><body>
<div class="grid">%s</div>
</body></html>`, cards.String())
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// GET /
func handleIndex(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	var total, online int
	db.QueryRow("SELECT COUNT(*) FROM nodes").Scan(&total)
	db.QueryRow("SELECT COUNT(*) FROM nodes WHERE tailscale_ip != 'pending' AND tailscale_ip != ''").Scan(&online)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hive Registry</title>
<style>
  body{font-family:monospace;padding:24px;background:#111;color:#e0e0e0}
  h2{color:#7ecfff;margin-bottom:12px}
  .stat{font-size:20px;margin-bottom:16px}
  .stat b{color:#7fff7e}
  a{color:#ffcf7e;margin-right:16px;text-decoration:none}
  a:hover{text-decoration:underline}
  hr{border-color:#333;margin:16px 0}
</style>
</head><body>
<h2>Hive Node Registry</h2>
<div class="stat">Total: <b>%d</b> &nbsp;|&nbsp; Tailscale online: <b>%d</b></div>
<hr>
<a href="/api/nodes">All Nodes (JSON)</a>
<a href="/api/subscription">VLESS Subscription</a>
<a href="/api/subscription/clash">Clash Subscription</a>
<a href="/api/prometheus-targets">Prometheus Targets</a>
<a href="/api/labels">Print Labels</a>
<a href="/health">Health</a>
</body></html>`, total, online)
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

func scanNode(rows *sql.Rows) (Node, error) {
	var n Node
	return n, rows.Scan(
		&n.MAC, &n.MAC6, &n.Hostname, &n.CFURL, &n.TunnelID,
		&n.TailscaleIP, &n.EasytierIP, &n.FRPPort, &n.XrayUUID,
		&n.Location, &n.Note, &n.RegisteredAt, &n.LastSeen,
	)
}

func scanNodeRow(row *sql.Row) (Node, error) {
	var n Node
	return n, row.Scan(
		&n.MAC, &n.MAC6, &n.Hostname, &n.CFURL, &n.TunnelID,
		&n.TailscaleIP, &n.EasytierIP, &n.FRPPort, &n.XrayUUID,
		&n.Location, &n.Note, &n.RegisteredAt, &n.LastSeen,
	)
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, "{\"error\":%q}\n", msg)
}
