package config

import "testing"

func TestOTARetentionConfiguration(t *testing.T) {
	for _, test := range []struct {
		value string
		want  int
	}{{"", 30}, {"30", 30}, {"90", 90}, {"0", 0}, {"-1", 0}, {"invalid", 0}, {"999999999999999999999", 0}} {
		t.Setenv("OTA_RETENTION_DAYS", test.value)
		if got := Load().OTARetentionDays; got != test.want {
			t.Fatalf("%q: got %d, want %d", test.value, got, test.want)
		}
	}
}
