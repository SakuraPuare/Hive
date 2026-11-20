package handler

import (
	"encoding/json"
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
	MAC       string              `json:"mac"`
	Endpoints []DashboardEndpoint `json:"endpoints"`
	Secret    string              `json:"secret"`
	SampledAt *string             `json:"sampled_at"`
	Egress    model.DeviceEgress  `json:"egress"`
}

type DashboardEndpoint struct {
	Network   string `json:"network"`
	Interface string `json:"interface"`
	Address   string `json:"address"`
	URL       string `json:"url"`
}

// dashboardEndpoints never treats HTTPS egress observations as controller addresses.
// A nil snapshot is legacy/unknown; an observed empty snapshot has no physical candidates.
func dashboardEndpoints(n model.Node, sample *model.DeviceAddressSnapshot) []DashboardEndpoint {
	endpoints := make([]DashboardEndpoint, 0, 8)
	seen := make(map[string]bool)
	add := func(network, iface, raw string) {
		ip, valid := validObservedIP(strings.TrimSpace(raw))
		if !valid {
			return
		}
		address := ip.String()
		key := network + "/" + address
		if seen[key] {
			return
		}
		seen[key] = true
		endpoints = append(endpoints, DashboardEndpoint{
			Network: network, Interface: iface, Address: address,
			URL: "http://" + net.JoinHostPort(address, "9090") + "/ui/",
		})
	}
	add("easytier", "", n.EasytierIP)
	add("tailscale", "", n.TailscaleIP)
	add("mesh", "", n.MeshIP)
	if sample == nil {
		add("lan-fallback", "", "10.42.2.1")
		add("hotspot5g-fallback", "", "10.42.1.1")
		add("hotspot2g-fallback", "", "10.42.0.1")
		return endpoints
	}
	for _, entry := range sample.LAN {
		network := entry.Role
		if network == "" {
			network = "physical"
		}
		switch entry.Address {
		case "10.42.1.1":
			network = "hotspot5g"
		case "10.42.0.1":
			network = "hotspot2g"
		}
		add(network, entry.Interface, entry.Address)
	}
	return endpoints
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
// @Failure      500 {object} ErrorResponse
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
	var row struct {
		AddressSnapshot    *string
		AddressesSampledAt *string
	}
	if err := h.DB.Table("nodes").Select("address_snapshot, addresses_sampled_at").Where("mac = ?", n.MAC).Take(&row).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	result := DashboardResponse{MAC: n.MAC, Secret: h.gatewaySecret(n.MAC)}
	var snapshot *model.DeviceAddressSnapshot
	if row.AddressSnapshot != nil || row.AddressesSampledAt != nil {
		if row.AddressSnapshot == nil || row.AddressesSampledAt == nil {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored address snapshot")
			return
		}
		var sample model.DeviceAddressSnapshot
		if err := json.Unmarshal([]byte(*row.AddressSnapshot), &sample); err != nil || strings.TrimSpace(*row.AddressSnapshot) == "null" {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored address snapshot")
			return
		}
		normalized, valid := normalizeDeviceAddresses(sample)
		if !valid {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored address snapshot")
			return
		}
		if _, err := time.Parse(time.RFC3339, *row.AddressesSampledAt); err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored address snapshot")
			return
		}
		snapshot = &normalized
		result.Egress, result.SampledAt = normalized.Egress, row.AddressesSampledAt
	}
	result.Endpoints = dashboardEndpoints(n, snapshot)
	h.jsonOK(w, result)
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
