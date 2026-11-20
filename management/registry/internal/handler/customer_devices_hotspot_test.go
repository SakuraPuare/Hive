package handler

import (
	"testing"

	"hive/registry/internal/model"
)

func TestHotspotCapable(t *testing.T) {
	raw := func(value string) *string { return &value }

	cases := []struct {
		name     string
		snapshot *string
		want     bool
	}{
		{name: "no sample", want: false},
		{name: "wired only", snapshot: raw(`{"lan":[{"interface":"end0","address":"192.168.5.2","prefix_length":24,"role":"wan"}]}`), want: false},
		{name: "capability flag", snapshot: raw(`{"hotspot_capable":true,"lan":[]}`), want: true},
		{name: "legacy hotspot role", snapshot: raw(`{"lan":[{"interface":"wlp1s0","address":"10.42.1.1","prefix_length":24,"role":"hotspot"}]}`), want: true},
		{name: "corrupt", snapshot: raw(`{`), want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := hotspotCapable(model.Node{AddressSnapshot: tc.snapshot})
			if got != tc.want {
				t.Fatalf("hotspotCapable() = %v, want %v", got, tc.want)
			}
		})
	}
}
