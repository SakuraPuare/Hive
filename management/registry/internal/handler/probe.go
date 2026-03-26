package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"hive/registry/internal/model"
)

// ── types ─────────────────────────────────────────────────────────────────────

type promQueryResult struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string  `json:"metric"`
			Value  [2]json.RawMessage `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

// ── probe loop ────────────────────────────────────────────────────────────────

func (h *Handler) StartProbeLoop() {
	time.Sleep(5 * time.Second)
	log.Printf("probe: starting Prometheus probe loop (url=%s, interval=60s)", h.Config.PrometheusURL)

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	h.runProbe()
	for range ticker.C {
		h.runProbe()
	}
}

func (h *Handler) runProbe() {
	hostnameToMAC := make(map[string]string)
	var nodes []struct {
		MAC      string
		Hostname string
	}
	h.DB.Model(&model.Node{}).Select("mac, hostname").Find(&nodes)
	for _, n := range nodes {
		hostnameToMAC[n.Hostname] = n.MAC
	}

	if len(hostnameToMAC) == 0 {
		return
	}

	upMap := h.promQueryInstant(`up{job="hives"}`)
	cpuMap := h.promQueryInstant(`100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle",job="hives"}[2m])) * 100)`)
	memMap := h.promQueryInstant(`100 * (1 - node_memory_MemAvailable_bytes{job="hives"} / node_memory_MemTotal_bytes{job="hives"})`)
	diskMap := h.promQueryInstant(`100 * (1 - node_filesystem_avail_bytes{job="hives",mountpoint="/"} / node_filesystem_size_bytes{job="hives",mountpoint="/"})`)
	uptimeMap := h.promQueryInstant(`node_time_seconds{job="hives"} - node_boot_time_seconds{job="hives"}`)
	latencyMap := h.promQueryInstant(`scrape_duration_seconds{job="hives"}`)

	now := time.Now().UTC().Format(model.TimeLayout)
	updated := 0

	for hostname, mac := range hostnameToMAC {
		status := "unknown"
		var latencyMs *int
		var cpuPct, memPct, diskPct *float64
		var uptimeSec *int64

		if v, ok := upMap[hostname]; ok {
			if v == 1 {
				status = "online"
			} else {
				status = "offline"
			}
		}

		if v, ok := cpuMap[hostname]; ok {
			rounded := math.Round(v*10) / 10
			cpuPct = &rounded
		}
		if v, ok := memMap[hostname]; ok {
			rounded := math.Round(v*10) / 10
			memPct = &rounded
		}
		if v, ok := diskMap[hostname]; ok {
			rounded := math.Round(v*10) / 10
			diskPct = &rounded
		}
		if v, ok := uptimeMap[hostname]; ok {
			sec := int64(v)
			uptimeSec = &sec
		}
		if v, ok := latencyMap[hostname]; ok {
			ms := int(v * 1000)
			latencyMs = &ms
		}

		if err := h.DB.Exec(`
			INSERT INTO node_status_checks (mac, status, latency_ms, cpu_pct, mem_pct, disk_pct, uptime_sec, checked_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				status     = VALUES(status),
				latency_ms = VALUES(latency_ms),
				cpu_pct    = VALUES(cpu_pct),
				mem_pct    = VALUES(mem_pct),
				disk_pct   = VALUES(disk_pct),
				uptime_sec = VALUES(uptime_sec),
				checked_at = VALUES(checked_at)
		`, mac, status, latencyMs, cpuPct, memPct, diskPct, uptimeSec, now).Error; err != nil {
			log.Printf("probe: upsert %s (%s): %v", hostname, mac, err)
			continue
		}
		updated++
	}

	log.Printf("probe: updated %d/%d nodes", updated, len(hostnameToMAC))
}

func (h *Handler) promQueryInstant(query string) map[string]float64 {
	result := make(map[string]float64)

	u := fmt.Sprintf("%s/api/v1/query?query=%s", h.Config.PrometheusURL, url.QueryEscape(query))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		log.Printf("probe: prometheus query failed: %v", err)
		return result
	}
	defer resp.Body.Close()

	var pr promQueryResult
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		log.Printf("probe: decode prometheus response: %v", err)
		return result
	}

	if pr.Status != "success" {
		log.Printf("probe: prometheus query status: %s", pr.Status)
		return result
	}

	for _, r := range pr.Data.Result {
		instance := r.Metric["instance"]
		if idx := strings.LastIndex(instance, ":"); idx > 0 {
			instance = instance[:idx]
		}
		if len(r.Value) < 2 {
			continue
		}
		var valStr string
		if err := json.Unmarshal(r.Value[1], &valStr); err != nil {
			continue
		}
		var val float64
		if _, err := fmt.Sscanf(valStr, "%f", &val); err != nil {
			continue
		}
		if math.IsNaN(val) || math.IsInf(val, 0) {
			continue
		}
		result[instance] = val
	}

	return result
}

// HandleNodeStatus godoc
// @Summary      获取节点状态列表
// @ID           AdminNodeStatus
// @Description  返回所有节点的最新探测状态（CPU、内存、磁盘、延迟等）
// @Tags         admin
// @Security     AdminSession
// @Produce      json
// @Success      200 {array}  model.NodeStatusCheck
// @Failure      500 {object} ErrorResponse
// @Router       /admin/node-status [get]
func (h *Handler) HandleNodeStatus(w http.ResponseWriter, r *http.Request) {
	var checks []model.NodeStatusCheck
	err := h.DB.Raw(`
		SELECT n.mac, n.hostname, n.location,
		       COALESCE(nsc.status, 'unknown') AS status,
		       nsc.latency_ms, nsc.cpu_pct, nsc.mem_pct, nsc.disk_pct, nsc.uptime_sec,
		       COALESCE(nsc.checked_at, '') AS checked_at
		FROM nodes n
		LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac
		ORDER BY n.hostname
	`).Scan(&checks).Error
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, checks)
}
