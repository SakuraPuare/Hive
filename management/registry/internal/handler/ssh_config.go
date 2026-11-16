package handler

import "net/http"

// AdminSSHConfigResponse carries the fleet-wide SSH settings the panel needs to
// render connection commands. Only the FRP host is server-side knowledge; the
// per-node address and port come from the node row. The FRP auth token is never
// returned.
type AdminSSHConfigResponse struct {
	FRPServerAddr string `json:"frp_server_addr"`
}

// HandleAdminSSHConfig godoc
// @Summary      管理端 SSH 连接配置
// @ID           AdminSSHConfig
// @Description  返回生成 SSH 命令所需的全局信息（当前只有 FRP 服务器地址）。未配置时返回空串。
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {object} AdminSSHConfigResponse
// @Router       /admin/ssh-config [get]
func (h *Handler) HandleAdminSSHConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	h.jsonOK(w, AdminSSHConfigResponse{FRPServerAddr: h.Config.FRPServerAddr})
}
