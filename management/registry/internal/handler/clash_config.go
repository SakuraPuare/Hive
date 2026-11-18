package handler

import (
	"bytes"
	_ "embed"
	"strings"
	"text/template"

	"hive/registry/internal/model"
)

//go:embed clash.yaml.tmpl
var clashTemplate string

var clashTmpl = template.Must(template.New("clash").Parse(clashTemplate))

// 节点出口方向：一个节点只服务一类客户端订阅，因为两类订阅的分流规则相反。
//
//	overseas：节点在墙外，进"出海"订阅（国内用户翻墙，CN 直连、其余走代理）；
//	domestic：节点在墙内，进"回国"订阅（海外用户回国，CN 走代理、其余直连）。
const (
	DirectionOverseas = "overseas"
	DirectionDomestic = "domestic"
)

// normalizeDirection validates a request value. Empty selects the default 出海
// direction so existing subscription links keep working unchanged.
func normalizeDirection(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", DirectionOverseas:
		return DirectionOverseas, true
	case DirectionDomestic:
		return DirectionDomestic, true
	}
	return "", false
}

// normalizeGatewayDirection canonicalises a node's gateway split-routing mode.
// The gateway renderer and the upstream-pool query both switch on this value;
// if it is not canonical (older panel/API writes such as "Overseas" or a value
// with trailing whitespace) both fall back independently, which used to emit a
// config that routed CN traffic direct while sending everything else through
// domestic nodes. Canonicalise once and default to domestic.
func normalizeGatewayDirection(raw string) (string, bool) {
	switch v := strings.ToLower(strings.TrimSpace(raw)); v {
	case DirectionDomestic, DirectionOverseas, "global", "direct":
		return v, true
	}
	return "", false
}

// gatewayDirectionOrDefault normalizes a stored value and defaults to domestic,
// which is the safe split for a gateway that never declared a direction.
func gatewayDirectionOrDefault(raw string) string {
	if v, ok := normalizeGatewayDirection(raw); ok {
		return v
	}
	return DirectionDomestic
}

// nodeDirection normalizes a node's stored direction. Rows predating migration
// 33 (or written by an older agent) carry an empty value and default to overseas.
func nodeDirection(n model.Node) string {
	if strings.EqualFold(strings.TrimSpace(n.ExitDirection), DirectionDomestic) {
		return DirectionDomestic
	}
	return DirectionOverseas
}

// filterNodesByDirection keeps only nodes serving the requested subscription.
func filterNodesByDirection(nodes []model.Node, direction string) []model.Node {
	out := make([]model.Node, 0, len(nodes))
	for _, n := range nodes {
		if nodeDirection(n) == direction {
			out = append(out, n)
		}
	}
	return out
}

type clashData struct {
	Title           string
	Direction       string
	XrayPath        string
	Proxies         []clashProxy
	ServiceGroups   []serviceGroup
	RegionGroups    []regionGroup
	DomainProviders []ruleProvider
	IPProviders     []ruleProvider
}

// clashProxy is one VLESS-over-WS upstream. Server is the TCP destination the
// client dials (a Cloudflare 优选 address when one is configured); Host is the
// node's own tunnel hostname, used for TLS SNI and the WebSocket Host header so
// Cloudflare can still resolve which tunnel the request belongs to.
type clashProxy struct {
	Name   string
	Server string
	Host   string
	UUID   string
}

type serviceGroup struct {
	Name  string
	First string
}

type regionGroup struct {
	Name   string
	Filter string
}

type ruleProvider struct {
	Key  string
	File string
}

var defaultServiceGroups = []serviceGroup{
	{"Google", "境外"},
	{"Telegram", "境外"},
	{"Twitter", "境外"},
	{"YouTube", "境外"},
	{"NETFLIX", "境外"},
	{"Spotify", "境外"},
	{"Github", "境外"},
	{"哔哩哔哩", "境内"},
	{"巴哈姆特", "境外"},
	{"其他", "境外"},
}

var defaultRegionGroups = []regionGroup{
	{"大陆", `"(?i)中国|cn|china"`},
	{"香港", `"(?i)港|hk|hongkong|hong kong"`},
	{"台湾", `"(?i)台|tw|taiwan"`},
	{"日本", `"(?i)日|jp|japan"`},
	{"新加坡", `"(?i)新|sg|singapore"`},
	{"美国", `"(?i)美|us|unitedstates|united states"`},
	{"巴西", `"(?i)巴西|br|brazil"`},
	{"其它地区", `"(?i)^(?!.*(?:中国|cn|china|港|hk|hongkong|台|tw|taiwan|日|jp|japan|新|sg|singapore|美|us|unitedstates|巴西|br|brazil|直连))"`},
}

var defaultDomainProviders = []ruleProvider{
	{"private_domain", "private"},
	{"cn_domain", "cn"},
	{"github_domain", "github"},
	{"twitter_domain", "twitter"},
	{"youtube_domain", "youtube"},
	{"google_domain", "google"},
	{"telegram_domain", "telegram"},
	{"netflix_domain", "netflix"},
	{"bilibili_domain", "bilibili"},
	{"bahamut_domain", "bahamut"},
	{"spotify_domain", "spotify"},
	{"geolocation-!cn", "geolocation-!cn"},
}

var defaultIPProviders = []ruleProvider{
	{"private_ip", "private"},
	{"cn_ip", "cn"},
	{"google_ip", "google"},
	{"netflix_ip", "netflix"},
	{"twitter_ip", "twitter"},
	{"telegram_ip", "telegram"},
}

// 回国订阅只要"国内服务走回国节点、其余直连"，因此只下发 CN 相关的规则集。
var domesticServiceGroups = []serviceGroup{
	{"哔哩哔哩", "回国"},
}

var domesticRegionGroups = []regionGroup{
	// 回国配置里的代理全部是境内节点，所以"大陆"分组直接包含全部代理。
	{"大陆", `"(?i).*"`},
}

var domesticDomainProviders = []ruleProvider{
	{"private_domain", "private"},
	{"cn_domain", "cn"},
	{"bilibili_domain", "bilibili"},
}

var domesticIPProviders = []ruleProvider{
	{"private_ip", "private"},
	{"cn_ip", "cn"},
}

// clashOptions carries the per-request knobs for a generated client config.
type clashOptions struct {
	XrayPath      string
	OverrideUUID  string // non-empty → every proxy uses this UUID (per-subscription billing identity)
	PreferredHost string // non-empty → dial this Cloudflare 优选 host instead of the node host
	Direction     string // overseas (default) / domestic; selects the rule set
}

// buildFullClashYAML generates a complete Clash/Mihomo YAML subscription config.
// If opts.OverrideUUID is non-empty, all proxies use that UUID instead of the
// node's own XrayUUID — used for per-subscription (per-customer) configs so
// traffic is attributed to the subscription's Xray client identity.
func buildFullClashYAML(title string, nodes []model.Node, opts clashOptions) string {
	direction := opts.Direction
	if direction != DirectionDomestic {
		direction = DirectionOverseas
	}

	var proxies []clashProxy
	for _, n := range nodes {
		host := stripScheme(n.CFURL)
		uuid := n.XrayUUID
		if opts.OverrideUUID != "" {
			uuid = opts.OverrideUUID
		}
		if host == "" || uuid == "" {
			continue
		}
		proxies = append(proxies, clashProxy{
			Name:   yamlStr(buildNodeName(n)),
			Server: dialHost(host, opts.PreferredHost),
			Host:   host,
			UUID:   uuid,
		})
	}

	serviceGroups := defaultServiceGroups
	regionGroups := defaultRegionGroups
	domainProviders := defaultDomainProviders
	ipProviders := defaultIPProviders
	if direction == DirectionDomestic {
		serviceGroups = domesticServiceGroups
		regionGroups = domesticRegionGroups
		domainProviders = domesticDomainProviders
		ipProviders = domesticIPProviders
	}

	data := clashData{
		Title:           title,
		Direction:       direction,
		XrayPath:        opts.XrayPath,
		Proxies:         proxies,
		ServiceGroups:   serviceGroups,
		RegionGroups:    regionGroups,
		DomainProviders: domainProviders,
		IPProviders:     ipProviders,
	}

	var buf bytes.Buffer
	if err := clashTmpl.Execute(&buf, data); err != nil {
		return "# template error: " + err.Error()
	}

	// collapse excessive blank lines
	result := strings.ReplaceAll(buf.String(), "\n\n\n", "\n\n")
	if direction == DirectionDomestic && len(proxies) == 0 {
		result = "# 本套餐暂无可用的回国节点；以下配置不会代理任何流量。\n" + result
	}
	return result
}
