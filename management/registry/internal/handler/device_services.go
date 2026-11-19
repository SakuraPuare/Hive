package handler

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"hive/registry/internal/model"
)

// normalizeServiceStates shares the command whitelist and fills unreported
// units with unknown, so partial or older samples cannot imply healthy units.
func normalizeServiceStates(states []model.ServiceStatus) ([]model.ServiceStatus, bool) {
	if len(states) > len(serviceControlServices) {
		return nil, false
	}
	byName := make(map[string]model.ServiceStatus, len(states))
	for _, state := range states {
		if !serviceControlServices[state.Name] {
			return nil, false
		}
		if _, exists := byName[state.Name]; exists {
			return nil, false
		}
		for _, value := range []string{state.ActiveState, state.SubState, state.LoadState} {
			if value == "" || len(value) > 32 || strings.IndexFunc(value, func(r rune) bool {
				return !(r >= 'a' && r <= 'z') && r != '-'
			}) >= 0 {
				return nil, false
			}
		}
		if state.LoadState == "not-found" {
			state.ActiveState, state.SubState = "not-found", "not-found"
		}
		byName[state.Name] = state
	}
	names := make([]string, 0, len(serviceControlServices))
	for name := range serviceControlServices {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]model.ServiceStatus, 0, len(names))
	for _, name := range names {
		state, ok := byName[name]
		if !ok {
			state = model.ServiceStatus{Name: name, ActiveState: "unknown", SubState: "unknown", LoadState: "unknown"}
		}
		result = append(result, state)
	}
	return result, true
}

// HandlePortalDeviceServices godoc
// @Summary      我的设备最新服务状态快照
// @ID           PortalDeviceServices
// @Description  状态随节点约60秒心跳更新；sampled_at为registry接收时间，旧节点无样本为null及unknown。读取不会下发命令。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} model.DeviceServicesResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /portal/devices/{mac}/services [get]
func (h *Handler) HandlePortalDeviceServices(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, customerID(r)); !ok {
		return
	}
	var row struct {
		ServiceStates     *string
		ServicesSampledAt *string
	}
	if err := h.DB.Table("nodes").Select("service_states, services_sampled_at").Where("mac = ?", mac).Take(&row).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	states, _ := normalizeServiceStates(nil)
	response := model.DeviceServicesResponse{Services: states}
	if row.ServiceStates != nil && row.ServicesSampledAt != nil {
		var stored []model.ServiceStatus
		if err := json.Unmarshal([]byte(*row.ServiceStates), &stored); err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored service snapshot")
			return
		}
		if normalized, ok := normalizeServiceStates(stored); ok {
			response.Services = normalized
			response.SampledAt = row.ServicesSampledAt
		} else {
			h.jsonErr(w, http.StatusInternalServerError, "invalid stored service snapshot")
			return
		}
	}
	h.jsonOK(w, response)
}
