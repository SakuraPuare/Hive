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

type clashData struct {
	Title           string
	XrayPath        string
	Proxies         []clashProxy
	ServiceGroups   []serviceGroup
	RegionGroups    []regionGroup
	DomainProviders []ruleProvider
	IPProviders     []ruleProvider
}

type clashProxy struct {
	Name   string
	Server string
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
	{"Google", "默认"},
	{"Telegram", "默认"},
	{"Twitter", "默认"},
	{"YouTube", "默认"},
	{"NETFLIX", "默认"},
	{"Spotify", "默认"},
	{"Github", "默认"},
	{"哔哩哔哩", "默认"},
	{"巴哈姆特", "默认"},
}

var defaultRegionGroups = []regionGroup{
	{"香港", `"(?i)港|hk|hongkong|hong kong"`},
	{"台湾", `"(?i)台|tw|taiwan"`},
	{"日本", `"(?i)日|jp|japan"`},
	{"新加坡", `"(?i)新|sg|singapore"`},
	{"美国", `"(?i)美|us|unitedstates|united states"`},
	{"其它地区", `"(?i)^(?!.*(?:港|hk|hongkong|台|tw|taiwan|日|jp|japan|新|sg|singapore|美|us|unitedstates|直连))"`},
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

// buildFullClashYAML generates a complete Clash/Mihomo YAML subscription config.
func buildFullClashYAML(title string, nodes []model.Node, xrayPath string) string {
	var proxies []clashProxy
	for _, n := range nodes {
		host := stripScheme(n.CFURL)
		if host == "" || n.XrayUUID == "" {
			continue
		}
		proxies = append(proxies, clashProxy{
			Name:   yamlStr(buildNodeName(n)),
			Server: host,
			UUID:   n.XrayUUID,
		})
	}

	data := clashData{
		Title:           title,
		XrayPath:        xrayPath,
		Proxies:         proxies,
		ServiceGroups:   defaultServiceGroups,
		RegionGroups:    defaultRegionGroups,
		DomainProviders: defaultDomainProviders,
		IPProviders:     defaultIPProviders,
	}

	var buf bytes.Buffer
	if err := clashTmpl.Execute(&buf, data); err != nil {
		return "# template error: " + err.Error()
	}

	// collapse excessive blank lines
	result := strings.ReplaceAll(buf.String(), "\n\n\n", "\n\n")
	return result
}
