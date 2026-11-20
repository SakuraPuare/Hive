package handler

import "net/http"

// AdminClaimCodeResponse is the operator view of a device claim code.
// The claim itself still validates against claim_code_hash; claim_code is
// plaintext kept only so an administrator can hand it to a customer.
type AdminClaimCodeResponse struct {
	MAC       string `json:"mac" example:"aabbccddeeff"`
	ClaimCode string `json:"claim_code" example:"K7QF-2M9X"`
	Claimable bool   `json:"claimable" example:"true"`
}

// HandleAdminGetClaimCode godoc
// @Summary      查看设备认领码
// @ID           AdminGetDeviceClaimCode
// @Description  返回管理员可见的认领码明文。仅迁移后首次入网/重注册的设备有明文；
// @Description  迁移前入网的历史设备只存哈希，返回空串。认领仍校验 claim_code_hash。
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} AdminClaimCodeResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/nodes/{mac}/claim-code [get]
func (h *Handler) HandleAdminGetClaimCode(w http.ResponseWriter, r *http.Request) {
	mac := r.PathValue("mac")
	var row struct {
		MAC             string
		ClaimCode       string
		OwnerCustomerID *uint
		ServerEnabled   bool
	}
	if err := h.DB.Raw(
		"SELECT mac, claim_code, owner_customer_id, server_enabled FROM nodes WHERE mac = ?", mac,
	).Scan(&row).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if row.MAC == "" {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}
	h.jsonOK(w, AdminClaimCodeResponse{
		MAC:       row.MAC,
		ClaimCode: row.ClaimCode,
		Claimable: row.OwnerCustomerID == nil && !row.ServerEnabled,
	})
}
