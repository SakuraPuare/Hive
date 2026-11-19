package handler

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"

	"hive/registry/internal/model"

	"gorm.io/gorm"
)

// PortalDeviceSubscriptionAccessResponse contains only the private share token.
// Owner credentials deliberately do not belong to model.Node or ordinary JSON.
type PortalDeviceSubscriptionAccessResponse struct {
	Token string `json:"token"`
}

// HandlePortalDeviceSubscriptionAccess godoc
// @Summary      获取我的设备免费订阅入口
// @ID           PortalDeviceSubscriptionAccess
// @Description  独立于付费套餐和额度；每台自有设备一个私密 token。仅设备当前主人可获取。
// @Tags         portal
// @Security     CustomerSessionCookie
// @Produce      json
// @Param        mac path string true "设备 MAC"
// @Success      200 {object} PortalDeviceSubscriptionAccessResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /portal/devices/{mac}/subscription-access [get]
func (h *Handler) HandlePortalDeviceSubscriptionAccess(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	cid, mac := customerID(r), r.PathValue("mac")
	if _, ok := h.ownedNode(w, mac, cid); !ok {
		return
	}
	var access PortalDeviceSubscriptionAccessResponse
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		// Ownership updates lock this same row. Recheck inside the lock so an
		// unbind/transfer cannot mint credentials for the previous owner.
		var row struct {
			MAC   string
			Token string
			UUID  string
		}
		if err := tx.Raw("SELECT n.mac, COALESCE(n.owner_access_token, '') AS token, COALESCE(n.owner_xray_uuid, '') AS uuid "+
			"FROM nodes n JOIN customers c ON c.id = n.owner_customer_id AND c.status = 'active' "+
			"WHERE n.mac = ? AND n.owner_customer_id = ? AND n.server_enabled = 0 FOR UPDATE", mac, cid).Scan(&row).Error; err != nil {
			return err
		}
		if row.MAC == "" {
			return gorm.ErrRecordNotFound
		}
		if row.Token == "" || row.UUID == "" {
			var err error
			row.Token, err = generateToken()
			if err != nil {
				return err
			}
			row.UUID, err = generateUUID()
			if err != nil {
				return err
			}
			if err := tx.Exec("UPDATE nodes SET owner_access_token = ?, owner_xray_uuid = ? WHERE mac = ?", row.Token, row.UUID, mac).Error; err != nil {
				return err
			}
		}
		access.Token = row.Token
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		h.jsonErr(w, http.StatusNotFound, "device not found")
		return
	}
	if err != nil {
		// Never include a SQL error here: it could contain the private token.
		h.jsonErr(w, http.StatusInternalServerError, "could not initialize device subscription")
		return
	}
	h.jsonOK(w, access)
}

// HandleOwnerSubscriptionClash godoc
// @Summary      获取自有设备免费 Clash 订阅
// @ID           OwnerSubscriptionClash
// @Description  仅当前有效归属的单台设备；按设备出口方向分流，不依赖付费套餐。出口关闭时返回无凭据直连配置。
// @Tags         subscription
// @Produce      plain
// @Param        token path string true "设备私密 token"
// @Success      200 {string} string "Clash subscription"
// @Failure      404 {string} string "Not Found"
// @Router       /d/{token} [get]
func (h *Handler) HandleOwnerSubscriptionClash(w http.ResponseWriter, r *http.Request) {
	h.serveOwnerSubscription(w, r, false)
}

// HandleOwnerSubscriptionVless godoc
// @Summary      获取自有设备免费 VLESS 订阅
// @ID           OwnerSubscriptionVless
// @Description  返回单台自有设备的 base64 VLESS 链接；出口关闭时仅返回无凭据说明。
// @Tags         subscription
// @Produce      plain
// @Param        token path string true "设备私密 token"
// @Success      200 {string} string "VLESS subscription"
// @Failure      404 {string} string "Not Found"
// @Router       /d/{token}/vless [get]
func (h *Handler) HandleOwnerSubscriptionVless(w http.ResponseWriter, r *http.Request) {
	h.serveOwnerSubscription(w, r, true)
}

func (h *Handler) serveOwnerSubscription(w http.ResponseWriter, r *http.Request, vless bool) {
	w.Header().Set("Cache-Control", "no-store")
	token := r.PathValue("token")
	if len(token) != 64 {
		http.NotFound(w, r)
		return
	}
	var row struct {
		model.Node
		OwnerXrayUUID string
	}
	if err := h.DB.Raw("SELECT "+model.NodeCols+", n.owner_xray_uuid FROM nodes n "+
		"LEFT JOIN node_status_checks nsc ON nsc.mac = n.mac "+
		"JOIN customers c ON c.id = n.owner_customer_id AND c.status = 'active' "+
		"WHERE n.owner_access_token = ? AND n.server_enabled = 0 AND n.owner_xray_uuid <> ''", token).Scan(&row).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "could not load device subscription")
		return
	}
	if row.MAC == "" || row.OwnerCustomerID == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if !row.Enabled || row.Status != "active" || !row.ExitEnabled || !row.OwnerExitEnabled || stripScheme(row.CFURL) == "" {
		const reason = "设备出口当前不可用，使用直连"
		if vless {
			fmt.Fprint(w, base64.StdEncoding.EncodeToString([]byte("# "+reason)))
		} else {
			fmt.Fprint(w, buildDirectSubscriptionYAML(reason))
		}
		return
	}
	if vless {
		fmt.Fprint(w, base64.StdEncoding.EncodeToString([]byte(vlessLink(row.Node, row.OwnerXrayUUID, h.Config.XrayPath, h.Config.CFPreferredHost))))
		return
	}
	opts := h.clashRenderOptions(row.OwnerXrayUUID)
	opts.Direction = nodeDirection(row.Node)
	fmt.Fprint(w, buildFullClashYAML("我的设备 · "+row.Hostname, []model.Node{row.Node}, opts))
}
