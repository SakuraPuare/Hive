package handler

import (
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"hive/registry/internal/model"
)

// 客户门户里的网关可视化（Mihomo / MetaCubeXD）。
//
// 面板本身跑在节点的 :9090（external-controller），带 per-node secret。客户浏览器
// 通常既不在节点 LAN、也不在 mesh 里，所以门户不能只丢一个内网 URL：这里提供两条路
//  1. GET /portal/devices/{mac}/dashboard —— 面板地址候选 + secret（客户在节点
//     WiFi/EasyTier/Tailscale 内时直接打开）；
//  2. GET /portal/devices/{mac}/mihomo/{version|connections} —— 由 registry 代理到
//     节点的 9090，客户在任何地方都能在门户里看到实时速率/会话数。
//
// 节点地址优先 easytier_ip（集群内 easytier pod 能到 172.20.0.0/16），退到
// tailscale_ip。节点防火墙只对管理网段/内网段放行 9090（setup-firewall.sh）。
var mihomoProxyPaths = map[string]bool{
	"version":     true,
	"connections": true,
}

// nodeManagementAddr 返回可用于访问节点 :9090 的 IPv4 地址，没有则空串。
func nodeManagementAddr(n model.Node) string {
	for _, candidate := range []string{n.EasytierIP, n.TailscaleIP} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || candidate == "pending" {
			continue
		}
		ip := net.ParseIP(candidate)
		if ip == nil || ip.To4() == nil {
			continue
		}
		return ip.String()
	}
	return ""
}

// DashboardResponse is the portal's view of a gateway node's Mihomo panel.
type DashboardResponse struct {
	MAC    string   `json:"mac"`
	URLs   []string `json:"urls"`   // 直接打开面板的候选地址（需在节点 LAN/mesh 内）
	Secret string   `json:"secret"` // 面板 API 密钥（per-node，HMAC(server key, mac)）
}

// HandlePortalDeviceDashboard godoc
// @Summary      我的设备的 Mihomo 面板地址
// @ID           PortalDeviceDashboard
// @Description  返回网关节点 Mihomo 面板的候选地址与 per-node secret。客户在节点
// @Description  WiFi（10.42.x）、EasyTier（172.20.x）或 Tailscale（100.64.x）内时可直接打开。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} DashboardResponse
// @Failure      404 {object} ErrorResponse
// @Router       /portal/devices/{mac}/dashboard [get]
func (h *Handler) HandlePortalDeviceDashboard(w http.ResponseWriter, r *http.Request) {
	n, ok := h.ownedNode(w, r.PathValue("mac"), customerID(r))
	if !ok {
		return
	}
	if !n.GatewayEnabled {
		h.jsonErr(w, http.StatusNotFound, "device has no gateway dashboard")
		return
	}
	urls := make([]string, 0, 5)
	for _, ip := range []string{nodeManagementAddr(n)} {
		if ip != "" {
			urls = append(urls, "http://"+ip+":9090/ui")
		}
	}
	// 客户连的是节点自己的 WiFi/LAN 时用得到这些固定网关地址（GATEWAY.md 的约定）。
	urls = append(urls,
		"http://10.42.2.1:9090/ui", // 有线 LAN
		"http://10.42.1.1:9090/ui", // 5G 热点
		"http://10.42.0.1:9090/ui", // 2.4G 热点
	)
	h.jsonOK(w, DashboardResponse{MAC: n.MAC, URLs: urls, Secret: h.gatewaySecret(n.MAC)})
}

// HandlePortalDeviceMihomo godoc
// @Summary      代理节点 Mihomo API（只读）
// @ID           PortalDeviceMihomo
// @Description  把门户会话换成节点侧 per-node secret，向节点 :9090 取只读数据。
// @Description  用于门户里展示实时速率与活跃会话，客户无需在节点的 LAN/mesh 内。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac  path string true "设备 MAC"
// @Param        path path string true "version|connections"
// @Success      200 {object} map[string]any
// @Failure      404 {object} ErrorResponse
// @Failure      502 {object} ErrorResponse
// @Failure      503 {object} ErrorResponse
// @Router       /portal/devices/{mac}/mihomo/{path} [get]
func (h *Handler) HandlePortalDeviceMihomo(w http.ResponseWriter, r *http.Request) {
	n, ok := h.ownedNode(w, r.PathValue("mac"), customerID(r))
	if !ok {
		return
	}
	if !n.GatewayEnabled {
		h.jsonErr(w, http.StatusNotFound, "device has no gateway dashboard")
		return
	}
	rel := r.PathValue("path")
	if !mihomoProxyPaths[rel] {
		h.jsonErr(w, http.StatusNotFound, "unsupported mihomo endpoint")
		return
	}
	addr := nodeManagementAddr(n)
	if addr == "" {
		h.jsonErr(w, http.StatusServiceUnavailable, "device has no management address yet")
		return
	}

	url := "http://" + net.JoinHostPort(addr, "9090") + "/" + rel
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "request: "+err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.gatewaySecret(n.MAC))
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// 节点的 mesh 地址不可达（节点离线/EasyTier 断链）——给前端一个可判定的 503。
		h.jsonErr(w, http.StatusServiceUnavailable, "device unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		h.jsonErr(w, http.StatusBadGateway, "read: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}
