package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"hive/registry/internal/model"

	"gorm.io/gorm"
)

var (
	HttpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hive_http_requests_total",
		Help: "Total HTTP requests by method, path, and status code.",
	}, []string{"method", "path", "status"})

	HttpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hive_http_request_duration_seconds",
		Help:    "HTTP request latency in seconds.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	}, []string{"method", "path"})

	NodesTotal = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "hive_nodes_total",
		Help: "Total number of registered nodes.",
	})

	SubscriptionRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hive_subscription_requests_total",
		Help: "Total subscription export requests by format.",
	}, []string{"format"})
)

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(code int) {
	w.code = code
	w.ResponseWriter.WriteHeader(code)
}

func NormalizePath(path string) string {
	switch {
	case len(path) > 7 && path[:7] == "/nodes/":
		return "/nodes/{mac}"
	case len(path) > 13 && path[:13] == "/admin/users/":
		if len(path) > 13 {
			rest := path[13:]
			if rest == "roles" || len(rest) > 0 && rest[len(rest)-1] == 's' {
				return "/admin/users/{id}/roles"
			}
			if rest == "password" || (len(rest) > 0 && rest[len(rest)-1] == 'd') {
				return "/admin/users/{id}/password"
			}
			return "/admin/users/{id}"
		}
		return path
	case len(path) > 13 && path[:13] == "/admin/roles/":
		return "/admin/roles/{id}/permissions"
	case len(path) > 28 && path[:28] == "/admin/subscription-groups/":
		rest := path[28:]
		for i, c := range rest {
			if c == '/' {
				suffix := rest[i:]
				if suffix == "/nodes" {
					return "/admin/subscription-groups/{id}/nodes"
				}
				if suffix == "/reset-token" {
					return "/admin/subscription-groups/{id}/reset-token"
				}
				return "/admin/subscription-groups/{id}"
			}
		}
		return "/admin/subscription-groups/{id}"
	case len(path) > 13 && path[:13] == "/admin/lines/":
		rest := path[13:]
		for i, c := range rest {
			if c == '/' {
				suffix := rest[i:]
				if suffix == "/nodes" {
					return "/admin/lines/{id}/nodes"
				}
				if suffix == "/reset-token" {
					return "/admin/lines/{id}/reset-token"
				}
				return "/admin/lines/{id}"
			}
		}
		return "/admin/lines/{id}"
	case len(path) > 3 && path[:3] == "/s/":
		return "/s/{token}"
	case len(path) > 3 && path[:3] == "/l/":
		return "/l/{token}"
	case len(path) > 3 && path[:3] == "/c/":
		if strings.Contains(path, "/vless") {
			return "/c/{token}/vless"
		}
		return "/c/{token}"
	case len(path) > 13 && path[:13] == "/admin/plans/":
		rest := path[13:]
		for i, c := range rest {
			if c == '/' {
				suffix := rest[i:]
				if suffix == "/lines" {
					return "/admin/plans/{id}/lines"
				}
				return "/admin/plans/{id}"
			}
		}
		return "/admin/plans/{id}"
	case len(path) > 14 && path[:14] == "/admin/orders/":
		return "/admin/orders/{id}"
	case len(path) > 19 && path[:19] == "/admin/promo-codes/":
		return "/admin/promo-codes/{id}"
	case len(path) > 15 && path[:15] == "/admin/tickets/":
		rest := path[15:]
		for i, c := range rest {
			if c == '/' {
				suffix := rest[i:]
				if suffix == "/replies" {
					return "/admin/tickets/{id}/replies"
				}
				if suffix == "/close" {
					return "/admin/tickets/{id}/close"
				}
			}
		}
		return "/admin/tickets/{id}"
	case len(path) > 20 && path[:20] == "/admin/risk-events/":
		return "/admin/risk-events/{id}"
	case len(path) > 17 && path[:17] == "/admin/customers/":
		rest := path[17:]
		for i, c := range rest {
			if c == '/' {
				suffix := rest[i:]
				if suffix == "/subscriptions" {
					return "/admin/customers/{id}/subscriptions"
				}
				if suffix == "/traffic" {
					return "/admin/customers/{id}/traffic"
				}
				if suffix == "/password" {
					return "/admin/customers/{id}/password"
				}
				return "/admin/customers/{id}"
			}
		}
		return "/admin/customers/{id}"
	}
	return path
}

// WithMetrics wraps a handler with Prometheus metrics recording.
func WithMetrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sw, r)

		path := NormalizePath(r.URL.Path)
		duration := time.Since(start).Seconds()

		HttpRequestsTotal.WithLabelValues(r.Method, path, strconv.Itoa(sw.code)).Inc()
		HttpRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
	})
}

// RefreshNodeGauge updates the hive_nodes_total gauge.
func RefreshNodeGauge(db *gorm.DB) {
	var count int64
	db.Model(&model.Node{}).Count(&count)
	NodesTotal.Set(float64(count))
}
