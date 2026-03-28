package handler

import (
	"fmt"
	"log"
	"net/http"
	"strings"
)

// PrometheusTarget is the Prometheus file_sd target format.
type PrometheusTarget struct {
	Targets []string          `json:"targets"`
	Labels  map[string]string `json:"labels"`
}

// prometheusNodeRow is the DB row used to build PrometheusTarget entries.
type prometheusNodeRow struct {
	Hostname    string
	TailscaleIP string
	EasytierIP  string
	CFURL       string
	Location    string
	MAC6        string
}

// HandleHealth godoc
// @Summary      健康检查
// @ID           Health
// @Description  检查服务和数据库连接是否正常
// @Tags         system
// @Produce      json
// @Success      200 {object} StatusResponse
// @Failure      503 {object} ErrorResponse
// @Router       /health [get]
func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	sqlDB, err := h.DB.DB()
	if err != nil {
		h.jsonErr(w, http.StatusServiceUnavailable, "db unavailable: "+err.Error())
		return
	}
	if err := sqlDB.Ping(); err != nil {
		h.jsonErr(w, http.StatusServiceUnavailable, "db unavailable: "+err.Error())
		return
	}
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandlePrometheusTargets godoc
// @Summary      获取 Prometheus 抓取目标
// @ID           PrometheusTargets
// @Description  返回 file_sd 格式的节点列表，供 Prometheus 服务发现使用
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {array}  PrometheusTarget
// @Failure      500 {object} ErrorResponse
// @Router       /prometheus-targets [get]
func (h *Handler) HandlePrometheusTargets(w http.ResponseWriter, r *http.Request) {
	var rows []prometheusNodeRow
	err := h.DB.Raw(`
		SELECT hostname, tailscale_ip, easytier_ip, cf_url, location, mac6
		FROM nodes
		WHERE tailscale_ip != 'pending' AND tailscale_ip != ''
		ORDER BY hostname
	`).Scan(&rows).Error
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	targets := make([]PrometheusTarget, 0, len(rows))
	for _, row := range rows {
		targets = append(targets, PrometheusTarget{
			Targets: []string{row.Hostname + ":9100"},
			Labels: map[string]string{
				"hostname": row.Hostname,
				"cf_url":   row.CFURL,
				"location": row.Location,
				"mac6":     row.MAC6,
			},
		})
	}
	h.jsonOK(w, targets)
}

// labelNodeRow is the DB row used to build label cards.
type labelNodeRow struct {
	MAC6         string
	CFURL        string
	Location     string
	RegisteredAt string
}

// HandleLabels godoc
// @Summary      打印节点标签页面
// @ID           LabelsPrint
// @Description  返回可打印的节点标签 HTML 页面
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      html
// @Success      200 {string} string "HTML page"
// @Failure      500 {object} ErrorResponse
// @Router       /labels [get]
func (h *Handler) HandleLabels(w http.ResponseWriter, r *http.Request) {
	var rows []labelNodeRow
	err := h.DB.Raw(
		"SELECT mac6, cf_url, location, registered_at FROM nodes ORDER BY registered_at",
	).Scan(&rows).Error
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	cards := strings.Builder{}
	for i, row := range rows {
		location := row.Location
		if location == "" {
			location = "—"
		}
		date := ""
		if len(row.RegisteredAt) >= 10 {
			date = row.RegisteredAt[:10]
		}
		fmt.Fprintf(&cards, `
		<div class="card">
			<div class="num">#%03d</div>
			<div class="id">%s</div>
			<div class="url">%s</div>
			<div class="loc">%s</div>
			<div class="ts">%s</div>
		</div>`, i+1, row.MAC6, row.CFURL, location, date)
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

// HandleRoot godoc
// @Summary      首页
// @ID           Dashboard
// @Description  返回 Hive Registry 首页 HTML
// @Tags         dashboard
// @Produce      html
// @Success      200 {string} string "HTML page"
// @Router       / [get]
func (h *Handler) HandleRoot(w http.ResponseWriter, r *http.Request) {
	var total, online int64
	if err := h.DB.Raw("SELECT COUNT(*) FROM nodes").Scan(&total).Error; err != nil {
		log.Printf("root: count nodes: %v", err)
	}
	if err := h.DB.Raw("SELECT COUNT(*) FROM nodes WHERE tailscale_ip != 'pending' AND tailscale_ip != ''").Scan(&online).Error; err != nil {
		log.Printf("root: count online nodes: %v", err)
	}

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
</style></head><body>
<h2>Hive Registry</h2>
<div class="stat">Nodes: <b>%d</b> total, <b>%d</b> online</div>
<hr>
<a href="/api/nodes">All Nodes (JSON)</a>
<a href="/api/subscription">VLESS Subscription</a>
<a href="/api/subscription/clash">Clash Subscription</a>
<a href="/api/prometheus-targets">Prometheus Targets</a>
<a href="/api/labels">Print Labels</a>
<a href="/health">Health</a>
</body></html>`, total, online)
}

func (h *Handler) HandleNodeStatusRoute(w http.ResponseWriter, r *http.Request) {
	h.HandleNodeStatus(w, r)
}
