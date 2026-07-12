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
	Secret            string // external-controller API secret (derived from MAC)
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
var localDirectProcesses = []string{"xray", "cloudflared", "warp-svc", "easytier-core", "frpc", "tailscaled"}

// buildGatewayClashYAML renders the node-side Mihomo gateway config.
//
//	selfMAC    — the requesting node's MAC; excluded from the upstream pool.
//	allNodes   — every enabled exit node in the cluster (candidate upstreams).
//	direction  — domestic / overseas / global / direct (see model.Node).
//	upstreamMode / upstreamMACs — auto (url-test over all) or manual (selected subset).
//	overrideUUID — when non-empty, every upstream proxy uses this UUID instead of
//	  the node's own xray_uuid (billing: gateway bound to a customer subscription,
//	  its egress traffic lands on sub-<id> and is metered against that subscription).
func buildGatewayClashYAML(title, xrayPath, secret, dashboardPath, selfMAC, direction, upstreamMode string, upstreamMACs []string, allNodes []model.Node, overrideUUID string) string {
	manualSet := map[string]bool{}
	for _, m := range upstreamMACs {
		m = strings.ToLower(strings.TrimSpace(m))
		if m != "" {
			manualSet[m] = true
		}
	}

	var proxies []clashProxy
	var manualNames []string
	for _, n := range allNodes {
		if strings.EqualFold(n.MAC, selfMAC) {
			continue // never route through ourselves
		}
		host := stripScheme(n.CFURL)
		if host == "" || n.XrayUUID == "" {
			continue
		}
		uuid := n.XrayUUID
		if overrideUUID != "" {
			uuid = overrideUUID // billing: route egress through the bound subscription's UUID
		}
		name := buildNodeName(n)
		proxies = append(proxies, clashProxy{
			Name:   yamlStr(name),
			Server: host,
			UUID:   uuid,
		})
		// manual mode: only the selected MACs populate the 手动选择 group;
		// auto mode: all candidates are eligible (url-test picks the fastest).
		if upstreamMode != "manual" || manualSet[strings.ToLower(n.MAC)] {
			manualNames = append(manualNames, name)
		}
	}

	// Resolve routing actions per direction.
	cnAction, otherAction := "直连", "代理"
	switch direction {
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

	data := gatewayClashData{
		Title:             title,
		XrayPath:          xrayPath,
		Secret:            secret,
		DashboardPath:     dashboardPath,
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
