package handler

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"hive/registry/internal/middleware"
)

// HandleSubscriptionVless returns a base64-encoded VLESS subscription.
// @Summary      获取 VLESS 订阅
// @ID           SubscriptionVless
// @Description  返回 base64 编码的 VLESS 订阅链接
// @Tags         subscription
// @Produce      plain
// @Success      200 {string} string "VLESS subscription"
// @Failure      500 {object} ErrorResponse
// @Router       /subscription [get]
func (h *Handler) HandleSubscriptionVless(w http.ResponseWriter, r *http.Request) {
	nodes, err := h.queryAllNodes()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	var links []string
	for _, n := range nodes {
		host := stripScheme(n.CFURL)
		if host == "" || n.XrayUUID == "" {
			continue
		}
		name := buildNodeName(n)
		params := url.Values{}
		params.Set("type", "ws")
		params.Set("security", "tls")
		params.Set("sni", host)
		params.Set("path", fmt.Sprintf("/%s?ed=2560", h.Config.XrayPath))
		link := fmt.Sprintf("vless://%s@%s:443?%s#%s",
			n.XrayUUID, host, params.Encode(), url.PathEscape(name))
		links = append(links, link)
	}

	content := base64.StdEncoding.EncodeToString([]byte(strings.Join(links, "\n")))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=hive-subscription.txt")
	fmt.Fprint(w, content)
}

// HandleSubscriptionClash returns a Clash/Mihomo YAML subscription.
// @Summary      获取 Clash 订阅
// @ID           SubscriptionClash
// @Description  返回 Clash/Mihomo YAML 格式订阅配置
// @Tags         subscription
// @Produce      plain
// @Success      200 {string} string "Clash subscription"
// @Failure      500 {object} ErrorResponse
// @Router       /subscription/clash [get]
func (h *Handler) HandleSubscriptionClash(w http.ResponseWriter, r *http.Request) {
	middleware.SubscriptionRequestsTotal.WithLabelValues("clash").Inc()

	nodes, err := h.queryAllNodes()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	yaml := buildFullClashYAML("Clash/Mihomo subscription", nodes, h.Config.XrayPath)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=hive-clash.yaml")
	fmt.Fprint(w, yaml)
}
