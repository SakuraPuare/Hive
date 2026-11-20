package handler

import (
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"hive/registry/internal/middleware"
	"hive/registry/internal/model"
)

// HandleSubscriptionVless returns a base64-encoded VLESS subscription.
// @Summary      获取 VLESS 订阅
// @ID           SubscriptionVless
// @Description  返回 base64 编码的 VLESS 订阅链接
// @Description  管理导出可用 ?token=<ADMIN_API_SECRET|API_SECRET|分组 token>；分组 token 只导出该分组且不计客户额度。
// @Tags         subscription
// @Produce      plain
// @Success      200 {string} string "VLESS subscription"
// @Failure      500 {object} ErrorResponse
// @Param        subscription query string true "客户订阅 Token（额度和有效期校验）"
// @Router       /subscription [get]
func (h *Handler) HandleSubscriptionVless(w http.ResponseWriter, r *http.Request) {
	if q := r.URL.Query().Get("token"); q != "" && !h.masterExportToken(q) {
		_, nodes, found, err := h.groupByExportCredential(q)
		if err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
		if !found {
			http.NotFound(w, r)
			return
		}
		h.serveGroupOperatorVless(w, r, nodes)
		return
	}
	if middleware.IsAutomationRequest(r) {
		h.serveAllNodesVless(w, r)
		return
	}
	h.serveScopedSubscription(w, r, nil, true)
}

// HandleSubscriptionClash returns a Clash/Mihomo YAML subscription.
// @Summary      获取 Clash 订阅
// @ID           SubscriptionClash
// @Description  返回 Clash/Mihomo YAML 格式订阅配置
// @Description  管理导出可用 ?token=<ADMIN_API_SECRET|API_SECRET|分组 token>；分组 token 只导出该分组且不计客户额度。
// @Tags         subscription
// @Produce      plain
// @Success      200 {string} string "Clash subscription"
// @Failure      500 {object} ErrorResponse
// @Param        subscription query string true "客户订阅 Token（额度和有效期校验）"
// @Router       /subscription/clash [get]
func (h *Handler) HandleSubscriptionClash(w http.ResponseWriter, r *http.Request) {
	if q := r.URL.Query().Get("token"); q != "" && !h.masterExportToken(q) {
		name, nodes, found, err := h.groupByExportCredential(q)
		if err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
		if !found {
			http.NotFound(w, r)
			return
		}
		h.serveGroupOperatorClash(w, r, name, nodes)
		return
	}
	if middleware.IsAutomationRequest(r) {
		h.serveAllNodesClash(w, r)
		return
	}
	h.serveScopedSubscription(w, r, nil, false)
}

// masterExportToken reports whether token is one of the automation secrets,
// i.e. it really is the all-nodes export rather than a group credential whose
// group disappeared between authentication and rendering.
func (h *Handler) masterExportToken(token string) bool {
	for _, c := range []string{h.Config.AdminAPISecret, h.Config.APISecret} {
		if c != "" && subtle.ConstantTimeCompare([]byte(token), []byte(c)) == 1 {
			return true
		}
	}
	return false
}

// serveAllNodesClash exports every node as a Clash/Mihomo config, using the
// node's own public Xray UUID.
//
// This is the operator/automation export, reachable only with ADMIN_API_SECRET
// through RequirePerm. It deliberately bypasses the per-customer scoping in
// serveScopedSubscription: mihomo/gateway sidecars are infrastructure, not
// paying customers, so they have no customer_subscriptions row to present.
// Exported UUIDs are the public node identities the Hive DB already stores;
// they are not a privilege escalation over the admin credential that fetched
// them, and this path grants no access to customer traffic records.
func (h *Handler) serveAllNodesClash(w http.ResponseWriter, r *http.Request) {
	direction, ok := normalizeDirection(r.URL.Query().Get("direction"))
	if !ok {
		h.jsonErr(w, http.StatusBadRequest, "direction must be overseas or domestic")
		return
	}
	nodes, err := h.queryAllNodes()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	nodes = filterNodesByDirection(nodes, direction)
	title, filename := "Hive nodes", "hive-nodes.yaml"
	if direction == DirectionDomestic {
		title, filename = "Hive nodes · 回国", "hive-nodes-cn.yaml"
	}
	opts := h.clashRenderOptions("")
	opts.Direction = direction
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	fmt.Fprint(w, buildFullClashYAML(title, nodes, opts))
}

// serveAllNodesVless exports every node as a base64 VLESS subscription.
// Same automation-only trust boundary as serveAllNodesClash.
func (h *Handler) serveAllNodesVless(w http.ResponseWriter, r *http.Request) {
	direction, ok := normalizeDirection(r.URL.Query().Get("direction"))
	if !ok {
		h.jsonErr(w, http.StatusBadRequest, "direction must be overseas or domestic")
		return
	}
	nodes, err := h.queryAllNodes()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	links := make([]string, 0, len(nodes))
	for _, n := range filterNodesByDirection(nodes, direction) {
		if link := vlessLink(n, n.XrayUUID, h.Config.XrayPath, h.Config.CFPreferredHost); link != "" {
			links = append(links, link)
		}
	}

	filename := "hive-nodes.txt"
	if direction == DirectionDomestic {
		filename = "hive-nodes-cn.txt"
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	fmt.Fprint(w, base64.StdEncoding.EncodeToString([]byte(strings.Join(links, "\n"))))
}

// vlessLink renders one VLESS-over-WS share link for a node. The @host part is
// the dial target: the Cloudflare 优选 host when configured, otherwise the
// node's own tunnel hostname. sni/host stay on the node's tunnel hostname so
// Cloudflare still routes the connection to the right tunnel. Returns "" when
// the node has no usable hostname or UUID.
func vlessLink(n model.Node, uuid, xrayPath, preferredHost string) string {
	host := stripScheme(n.CFURL)
	if host == "" || uuid == "" {
		return ""
	}
	params := url.Values{}
	params.Set("type", "ws")
	params.Set("security", "tls")
	params.Set("sni", host)
	params.Set("host", host)
	params.Set("path", fmt.Sprintf("/%s?ed=2560", xrayPath))
	return fmt.Sprintf("vless://%s@%s:443?%s#%s", uuid, dialHost(host, preferredHost), params.Encode(), url.PathEscape(buildNodeName(n)))
}
