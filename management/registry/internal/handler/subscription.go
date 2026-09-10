package handler

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"hive/registry/internal/middleware"
)

// detectFlag determines the client type from the "flag" query param or User-Agent.
// Returns a lowercase string used to match against known client identifiers.
func detectFlag(r *http.Request) string {
	flag := r.URL.Query().Get("flag")
	if flag == "" {
		flag = r.Header.Get("User-Agent")
	}
	return strings.ToLower(flag)
}

// isClashClient returns true if the flag indicates a Clash-family client.
func isClashClient(flag string) bool {
	for _, kw := range []string{"meta", "mihomo", "stash", "verge", "nyanpasu", "clash"} {
		if strings.Contains(flag, kw) {
			return true
		}
	}
	return false
}

// HandleSubscription returns a subscription config, auto-detecting the output
// format from the "flag" query parameter or User-Agent header (v2board style).
//
// Clash-family clients get a Mihomo YAML config; everything else gets base64
// encoded VLESS links.
//
// @Summary      获取订阅（自动适配格式）
// @ID           Subscription
// @Description  根据 flag 参数或 User-Agent 自动返回 Clash YAML 或 base64 VLESS
// @Tags         subscription
// @Produce      plain
// @Param        flag query string false "客户端标识（如 meta, clash, shadowrocket）"
// @Success      200 {string} string "subscription config"
// @Failure      500 {object} ErrorResponse
// @Router       /subscription [get]
func (h *Handler) HandleSubscription(w http.ResponseWriter, r *http.Request) {
	middleware.SubscriptionRequestsTotal.WithLabelValues("unified").Inc()

	nodes, err := h.queryAllNodes()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	flag := detectFlag(r)

	if isClashClient(flag) {
		yaml := buildFullClashYAML("Hive", nodes, h.Config.XrayPath, "")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''Hive")
		w.Header().Set("Profile-Update-Interval", "24")
		fmt.Fprint(w, yaml)
		return
	}

	// Default: base64 VLESS links (compatible with V2RayN, Shadowrocket, etc.)
	var links []string
	for _, n := range nodes {
		host := stripScheme(n.CFURL)
		if host == "" || n.XrayUUID == "" {
			continue
		}
		name := buildNodeName(n)
		params := url.Values{}
		params.Set("type", "ws")
		params.Set("host", host)
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
