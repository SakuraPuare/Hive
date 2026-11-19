package handler

import (
	"bytes"
	_ "embed"
	"strings"
	"text/template"

	"hive/registry/internal/model"
)

//go:embed gateway_clash.yaml.tmpl
var gatewayClashTemplate string

var gatewayClashTmpl = template.Must(template.New("gateway-clash").Parse(gatewayClashTemplate))

// gatewayClashData drives gateway_clash.yaml.tmpl — a node-side Mihomo config
// for the transparent-proxy gateway role (TPROXY, no TUN). Unlike the
// customer subscription config, this one runs ON a node: it exposes an
// external-controller for the LAN dashboard, excludes the node itself from the
// upstream pool (no self-routing loop), and flips the CN routing rule by the
// node's gateway_direction.
type gatewayClashData struct {
	Title             string
	XrayPath          string
	Secret            string // external-controller API secret
	DashboardPath     string // metacubexd static dir served via external-ui
	Proxies           []clashProxy
	ManualProxyNames  []string // names for the 手动选择 select group
	HasUpstream       bool     // false → no usable upstream, gateway falls back to DIRECT
	CNAction          string   // routing target for CN-geo traffic: 直连 or 代理
	OtherAction       string   // routing target for non-CN traffic: 直连 or 代理
	DomainProviders   []ruleProvider
	IPProviders       []ruleProvider
	LocalProcessNames []string // PROCESS-NAME force-DIRECT (anti-loop for node's own egress)
}

// localDirectProcesses are the node's own outbound daemons that must never be
// re-proxied by the local Mihomo — otherwise the exit-role Xray traffic would
// loop back into the gateway. Force-DIRECT at the top of the rule list.
var localDirectProcesses = []string{"curl", "xray", "cloudflared", "warp-svc", "easytier-core", "frpc", "tailscaled"}

// gatewayClashArgs groups the render inputs for buildGatewayClashYAML. A struct
// (not a long positional list) because several fields are optional/zero-valued.
type gatewayClashArgs struct {
	Title         string
	XrayPath      string
	Secret        string       // external-controller API secret
	DashboardPath string       // metacubexd static dir served via external-ui
	SelfMAC       string       // requesting node's MAC; excluded from the upstream pool
	Direction     string       // domestic / overseas / global / direct / blocked
	UpstreamMode  string       // auto | manual
	UpstreamMACs  []string     // manual-mode selection
	AllNodes      []model.Node // every enabled exit node (candidate upstreams)

	// OverrideUUID, when non-empty, replaces every upstream proxy's UUID with the
	// bound customer subscription's Xray identity (gateway egress is metered there).
	OverrideUUID string

	// LegacyUUIDs maps lowercase MAC → the node's own static Xray UUID. Nodes in
	// this map predate subscription sync and only accept that UUID; they cannot
	// meter, so the gateway uses it instead of OverrideUUID.
	LegacyUUIDs map[string]string

	// PreferredHost, when non-empty, is the Cloudflare 优选 host clients dial;
	// SNI and WebSocket Host stay on the node's own tunnel hostname.
	PreferredHost string
}

// buildGatewayClashYAML renders the node-side Mihomo gateway config.
//
// The self node is never an upstream (no self-routing loop), the upstream pool
// is auto (url-test over all) or manual (selected subset), and the CN routing
// rule flips by the node's gateway_direction. Without a usable upstream (unbound
// subscription, expired lease, direction/plan mismatch) the gateway degrades to
// DIRECT instead of REJECT so the downstream LAN keeps internet access.
func buildGatewayClashYAML(args gatewayClashArgs) string {
	if args.Direction == "blocked" {
		// 未授权的网关不允许携带任何上游凭证。handler 已把节点列表置空，这里再
		// 兜底一次：即便调用方传了节点，也不能把订阅 UUID 写进配置。
		args.AllNodes = nil
		args.UpstreamMACs = nil
	}
	manualSet := map[string]bool{}
	for _, m := range args.UpstreamMACs {
		m = strings.ToLower(strings.TrimSpace(m))
		if m != "" {
			manualSet[m] = true
		}
	}

	var proxies []clashProxy
	var manualNames []string
	for _, n := range args.AllNodes {
		if strings.EqualFold(n.MAC, args.SelfMAC) {
			continue // never route through ourselves
		}
		host := stripScheme(n.CFURL)
		if host == "" || args.OverrideUUID == "" {
			continue
		}
		// 旧镜像的出口节点只接受自身的静态 UUID（hive-xray-prepare 会清空订阅
		// clients），拿订阅 UUID 去连只会收到 invalid request user id。这类节点的
		// meters 也拿不到，因此直接用节点 UUID；升级后的节点首次 POST 计费后
		// subscription_sync 会被置 1，自动切回订阅 UUID（可计费）。
		uuid := args.OverrideUUID
		if legacy, ok := args.LegacyUUIDs[strings.ToLower(n.MAC)]; ok && legacy != "" {
			uuid = legacy
		}
		name := buildNodeName(n)
		proxies = append(proxies, clashProxy{
			Name:   yamlStr(name),
			Server: dialHost(host, args.PreferredHost),
			Host:   host,
			UUID:   uuid,
		})
		// manual mode: only the selected MACs populate the 手动选择 group;
		// auto mode: all candidates are eligible (url-test picks the fastest).
		if args.UpstreamMode != "manual" || manualSet[strings.ToLower(n.MAC)] {
			manualNames = append(manualNames, name)
		}
	}

	// Resolve routing actions per direction.
	cnAction, otherAction := "直连", "代理"
	switch args.Direction {
	case "overseas":
		// node sits outside the GFW: CN sites via a domestic upstream, rest direct
		cnAction, otherAction = "代理", "直连"
	case "global":
		cnAction, otherAction = "代理", "代理"
	case "direct":
		cnAction, otherAction = "直连", "直连"
	default: // domestic: CN direct, everything else proxied
		cnAction, otherAction = "直连", "代理"
	}

	// 没有可用上游（未绑定/订阅失效/线路方向不匹配）时退化为直连兜底：订阅只决定
	// "能不能走代理"，不能把下游 LAN/热点的网络一起掐断。节点侧也不再装 FORWARD
	// DROP，因此直连兜底对客户端立即可用。
	hasUpstream := len(proxies) > 0
	if !hasUpstream || args.Direction == "blocked" || args.OverrideUUID == "" {
		cnAction, otherAction = "直连", "直连"
	}

	data := gatewayClashData{
		Title:             args.Title,
		XrayPath:          args.XrayPath,
		Secret:            args.Secret,
		DashboardPath:     args.DashboardPath,
		Proxies:           proxies,
		ManualProxyNames:  manualNames,
		HasUpstream:       hasUpstream,
		CNAction:          cnAction,
		OtherAction:       otherAction,
		DomainProviders:   defaultDomainProviders,
		IPProviders:       defaultIPProviders,
		LocalProcessNames: localDirectProcesses,
	}

	var buf bytes.Buffer
	if err := gatewayClashTmpl.Execute(&buf, data); err != nil {
		return "# template error: " + err.Error()
	}
	return strings.ReplaceAll(buf.String(), "\n\n\n", "\n\n")
}
