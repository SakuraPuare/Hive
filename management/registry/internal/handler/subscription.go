package handler

import "net/http"

// HandleSubscriptionVless returns a base64-encoded VLESS subscription.
// @Summary      获取 VLESS 订阅
// @ID           SubscriptionVless
// @Description  返回 base64 编码的 VLESS 订阅链接
// @Tags         subscription
// @Produce      plain
// @Success      200 {string} string "VLESS subscription"
// @Failure      500 {object} ErrorResponse
// @Param        subscription query string true "客户订阅 Token（额度和有效期校验）"
// @Router       /subscription [get]
func (h *Handler) HandleSubscriptionVless(w http.ResponseWriter, r *http.Request) {
	h.serveScopedSubscription(w, r, nil, true)
}

// HandleSubscriptionClash returns a Clash/Mihomo YAML subscription.
// @Summary      获取 Clash 订阅
// @ID           SubscriptionClash
// @Description  返回 Clash/Mihomo YAML 格式订阅配置
// @Tags         subscription
// @Produce      plain
// @Success      200 {string} string "Clash subscription"
// @Failure      500 {object} ErrorResponse
// @Param        subscription query string true "客户订阅 Token（额度和有效期校验）"
// @Router       /subscription/clash [get]
func (h *Handler) HandleSubscriptionClash(w http.ResponseWriter, r *http.Request) {
	h.serveScopedSubscription(w, r, nil, false)
}
