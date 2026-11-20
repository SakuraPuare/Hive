package handler

import (
	"encoding/json"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"hive/registry/internal/model"
)

var fakeIPRange = netip.MustParsePrefix("198.18.0.0/15")

func validObservedIP(raw string) (netip.Addr, bool) {
	if len(raw) > 45 {
		return netip.Addr{}, false
	}
	ip, err := netip.ParseAddr(raw)
	return ip, err == nil && ip.Zone() == "" && !ip.Is4In6() && ip.IsGlobalUnicast() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !fakeIPRange.Contains(ip)
}

func normalizeDeviceAddresses(sample model.DeviceAddressSnapshot) (model.DeviceAddressSnapshot, bool) {
	if len(sample.LAN) > 32 {
		return sample, false
	}
	lan := make([]model.LANAddress, 0, len(sample.LAN))
	seen := make(map[model.LANAddress]bool, len(sample.LAN))
	for _, entry := range sample.LAN {
		if entry.Role != "" && entry.Role != "wan" && entry.Role != "lan" {
			return sample, false
		}
		if entry.Interface == "" || len(entry.Interface) > 15 || strings.IndexFunc(entry.Interface, func(r rune) bool {
			return !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '-' && r != '_' && r != '.'
		}) >= 0 {
			return sample, false
		}
		ip, ok := validObservedIP(entry.Address)
		if !ok || entry.PrefixLength < 0 || entry.PrefixLength > ip.BitLen() {
			return sample, false
		}
		entry.Address = ip.String()
		if seen[entry] {
			return sample, false
		}
		seen[entry] = true
		lan = append(lan, entry)
	}
	for family, raw := range []string{sample.Egress.IPv4, sample.Egress.IPv6} {
		if raw == "" {
			continue
		}
		ip, ok := validObservedIP(raw)
		if !ok || ip.IsPrivate() || (family == 0) != ip.Is4() {
			return sample, false
		}
		if family == 0 {
			sample.Egress.IPv4 = ip.String()
		} else {
			sample.Egress.IPv6 = ip.String()
		}
	}
	hasEgress := sample.Egress.IPv4 != "" || sample.Egress.IPv6 != ""
	if hasEgress != (sample.Egress.SampledAt != nil) {
		return sample, false
	}
	if sample.Egress.SampledAt != nil {
		if len(*sample.Egress.SampledAt) > 32 {
			return sample, false
		}
		stamp, err := time.Parse(time.RFC3339, *sample.Egress.SampledAt)
		if err != nil || stamp.After(time.Now()) {
			return sample, false
		}
		utc := stamp.UTC().Format(time.RFC3339)
		sample.Egress.SampledAt = &utc
	}
	sample.LAN = lan
	return sample, true
}

func knownAddress(value string) string {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "pending") {
		return ""
	}
	return value
}

// HandlePortalDeviceAddresses godoc
// @Summary 我的设备网络地址快照
// @ID PortalDeviceAddresses
// @Description LAN为物理接口地址；sampled_at为registry接收时间。egress为节点HTTPS请求所见出口，不保证直连WAN；缓存约一小时，失败保留原样本时间。旧节点无样本为null及空数组。
// @Tags portal
// @Security CustomerSessionCookie
// @Produce json
// @Param mac path string true "设备 MAC"
// @Success 200 {object} model.DeviceAddressesResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /portal/devices/{mac}/addresses [get]
func (h *Handler) HandlePortalDeviceAddresses(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	node, ok := h.ownedNode(w, mac, customerID(r))
	if !ok {
		return
	}
	var row struct {
		AddressSnapshot    *string
		AddressesSampledAt *string
	}
	if err := h.DB.Table("nodes").Select("address_snapshot, addresses_sampled_at").Where("mac = ?", mac).Take(&row).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	result := model.DeviceAddressesResponse{
		Hostname: node.Hostname,
		MAC:      node.MAC,
		LastSeen: node.LastSeen,
		LAN:      []model.LANAddress{},
		CFURL:    knownAddress(node.CFURL),
	}
	if row.AddressSnapshot != nil && row.AddressesSampledAt != nil {
		var sample model.DeviceAddressSnapshot
		if err := json.Unmarshal([]byte(*row.AddressSnapshot), &sample); err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored address snapshot")
			return
		}
		normalized, valid := normalizeDeviceAddresses(sample)
		if !valid {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored address snapshot")
			return
		}
		result.LAN, result.Egress, result.SampledAt = normalized.LAN, normalized.Egress, row.AddressesSampledAt
	}
	h.jsonOK(w, result)
}
