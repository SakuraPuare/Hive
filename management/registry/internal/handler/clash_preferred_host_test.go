package handler

import (
	"net/url"
	"strings"
	"testing"

	"hive/registry/internal/model"
)

// testNodeHost is the throwaway tunnel host used by the renderer tests.
const testNodeHost = "hive-test01.tunnel.example.com"

// preferredHostTestNode uses the same throwaway tunnel host and UUID the rest of
// the handler tests use — real node identities must never enter this repo.
func preferredHostTestNode() model.Node {
	return model.Node{
		MAC:      "aabbccddeeff",
		Hostname: "hive-test01",
		CFURL:    "https://" + testNodeHost,
		XrayUUID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		Location: "JP",
		Note:     "test",
	}
}

// The 优选 endpoint must only replace the dial target: Cloudflare picks the
// tunnel from TLS SNI and the WebSocket Host header, so those must keep the
// node's own hostname. Swapping them too would silently break every node while
// still producing valid-looking YAML.
func TestBuildFullClashYAMLPreferredHost(t *testing.T) {
	const nodeHost = testNodeHost

	cases := []struct {
		name       string
		preferred  string
		wantServer string
	}{
		{"preferred set", "cf.example.com", "cf.example.com"},
		{"preferred set with scheme", "https://cf.example.com/", "cf.example.com"},
		{"preferred empty", "", nodeHost},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := buildFullClashYAML("test", []model.Node{preferredHostTestNode()}, clashOptions{
				XrayPath:      "ray",
				PreferredHost: tc.preferred,
			})
			for _, want := range []string{
				"\n    server: " + tc.wantServer + "\n",
				"\n    servername: " + nodeHost + "\n",
				"\n        Host: " + nodeHost + "\n",
				"\n      path: /ray\n",
			} {
				if !strings.Contains(out, want) {
					t.Fatalf("missing %q in:\n%s", want, out)
				}
			}
		})
	}
}

func TestVlessLinkPreferredHost(t *testing.T) {
	node := preferredHostTestNode()

	link := vlessLink(node, node.XrayUUID, "ray", "cf.example.com")
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	if u.User.Username() != node.XrayUUID {
		t.Fatalf("uuid = %q", u.User.Username())
	}
	if u.Host != "cf.example.com:443" {
		t.Fatalf("dial host = %q, want cf.example.com:443", u.Host)
	}
	q := u.Query()
	if q.Get("sni") != testNodeHost || q.Get("host") != testNodeHost {
		t.Fatalf("sni/host = %q/%q", q.Get("sni"), q.Get("host"))
	}
	if q.Get("path") != "/ray?ed=2560" {
		t.Fatalf("path = %q", q.Get("path"))
	}

	direct := vlessLink(node, node.XrayUUID, "ray", "")
	du, err := url.Parse(direct)
	if err != nil {
		t.Fatalf("parse direct link: %v", err)
	}
	if du.Host != testNodeHost+":443" {
		t.Fatalf("dial host without preferred = %q", du.Host)
	}

	// Unusable nodes are skipped rather than emitted as a broken entry.
	if got := vlessLink(model.Node{Hostname: "x"}, "uuid", "ray", "cf.example.com"); got != "" {
		t.Fatalf("link without cf_url = %q, want empty", got)
	}
}
