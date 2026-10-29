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
// for the transparent-proxy gateway role (TUN + auto-redirect). Unlike the
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

	// PreferredHost, when non-empty, is the Cloudflare 优选 host clients dial;
	// SNI and WebSocket Host stay on the node's own tunnel hostname.
	PreferredHost string
}

// buildGatewayClashYAML renders the node-side Mihomo gateway config.
//
// The self node is never an upstream (no self-routing loop), the upstream pool
// is auto (url-test over all) or manual (selected subset), and the CN routing
// rule flips by the node's gateway_direction.
func buildGatewayClashYAML(args gatewayClashArgs) string {
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
		name := buildNodeName(n)
		proxies = append(proxies, clashProxy{
			Name:   yamlStr(name),
			Server: dialHost(host, args.PreferredHost),
			Host:   host,
			UUID:   args.OverrideUUID,
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

	hasUpstream := len(proxies) > 0
	if !hasUpstream {
		// no upstream available → don't reference 代理 group, fall back to direct
		cnAction, otherAction = "直连", "直连"
	}

	if args.Direction == "blocked" || args.OverrideUUID == "" {
		cnAction, otherAction = "REJECT", "REJECT"
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
