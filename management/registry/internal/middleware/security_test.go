package middleware

import (
	"fmt"
	"github.com/prometheus/client_golang/prometheus"
	"hive/registry/internal/config"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMetricsHaveBoundedLabels(t *testing.T) {
	HttpRequestsTotal.Reset()
	HttpRequestDuration.Reset()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /nodes/{mac}", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	handler := WithMetrics(mux)
	for i := 0; i < 100; i++ {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(fmt.Sprintf("UNKNOWN%d", i), fmt.Sprintf("/random/%d", i), nil))
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", fmt.Sprintf("/nodes/%d", i), nil))
	}
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range families {
		if f.GetName() == "hive_http_requests_total" || f.GetName() == "hive_http_request_duration_seconds" {
			if len(f.Metric) != 2 {
				t.Fatalf("%s created %d series, want 2", f.GetName(), len(f.Metric))
			}
		}
	}
}

func TestSessionPreservesDottedUsername(t *testing.T) {
	auth := &Auth{Config: &config.Config{AdminSessionSecret: "secret", AdminCookieName: "admin"}}
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: "admin", Value: auth.MakeSessionValue(time.Now().Add(time.Hour).Unix(), "admin.example", "viewer")})
	user, role, ok := auth.ParseSession(req)
	if !ok || user != "admin.example" || role != "viewer" {
		t.Fatalf("parsed as %q %q %v", user, role, ok)
	}
}
