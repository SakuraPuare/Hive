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

// Metric labels come exclusively from registered ServeMux patterns, never request URLs.
func metricPath(r *http.Request) string {
	if r.Pattern == "" {
		return "unmatched"
	}
	_, path, found := strings.Cut(r.Pattern, " ")
	if found {
		return path
	}
	return r.Pattern
}

func metricMethod(method string) string {
	switch method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE":
		return method
	default:
		return "OTHER"
	}
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

		path := metricPath(r)
		method := metricMethod(r.Method)
		duration := time.Since(start).Seconds()

		HttpRequestsTotal.WithLabelValues(method, path, strconv.Itoa(sw.code)).Inc()
		HttpRequestDuration.WithLabelValues(method, path).Observe(duration)
	})
}

// RefreshNodeGauge updates the hive_nodes_total gauge.
func RefreshNodeGauge(db *gorm.DB) {
	var count int64
	db.Model(&model.Node{}).Count(&count)
	NodesTotal.Set(float64(count))
}
