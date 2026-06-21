package middleware

import "testing"

func TestResolveOrigin(t *testing.T) {
	cases := []struct {
		name        string
		origin      string
		allowed     []string
		wantOK      bool
		wantCredent bool
	}{
		{"empty allowlist denies", "https://a.com", nil, false, false},
		{"exact match allows credentials", "https://a.com", []string{"https://a.com"}, true, true},
		{"case-insensitive exact match", "https://A.com", []string{"https://a.com"}, true, true},
		{"no match denies", "https://evil.com", []string{"https://a.com"}, false, false},
		{"wildcard allows without credentials", "https://evil.com", []string{"*"}, true, false},
		{"exact wins over wildcard for credentials", "https://a.com", []string{"*", "https://a.com"}, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ok, cred := resolveOrigin(c.origin, c.allowed)
			if ok != c.wantOK || cred != c.wantCredent {
				t.Fatalf("resolveOrigin(%q, %v) = (%v, %v), want (%v, %v)",
					c.origin, c.allowed, ok, cred, c.wantOK, c.wantCredent)
			}
		})
	}
}
