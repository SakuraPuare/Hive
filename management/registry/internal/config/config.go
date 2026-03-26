package config

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	Port               string
	APISecret          string
	AdminUser          string
	AdminPass          string
	AdminSessionSecret string
	AdminSessionTTL    time.Duration
	AdminCookieName    string
	CORSAllowedOrigins []string
	AdminCookieSameSite http.SameSite
	XrayPath           string
	PrometheusURL      string

	// DB
	MySQLHost     string
	MySQLPort     string
	MySQLUser     string
	MySQLPassword string
	MySQLDB       string
	DBMaxOpen     int
	DBMaxIdle     int
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	maxOpen, _ := strconv.Atoi(Getenv("DB_MAX_OPEN", "10"))
	maxIdle, _ := strconv.Atoi(Getenv("DB_MAX_IDLE", "3"))

	return &Config{
		Port:                Getenv("PORT", "8080"),
		APISecret:           Getenv("API_SECRET", ""),
		AdminUser:           Getenv("ADMIN_USER", "admin"),
		AdminPass:           Getenv("ADMIN_PASS", ""),
		AdminSessionSecret:  Getenv("ADMIN_SESSION_SECRET", ""),
		AdminSessionTTL:     12 * time.Hour,
		AdminCookieName:     "hive_admin_session",
		CORSAllowedOrigins:  splitCSV(Getenv("CORS_ALLOW_ORIGINS", "")),
		AdminCookieSameSite: parseSameSite(Getenv("ADMIN_COOKIE_SAMESITE", "lax")),
		XrayPath:            Getenv("XRAY_PATH", "ray"),
		PrometheusURL:       Getenv("PROMETHEUS_URL", "http://127.0.0.1:4230"),

		MySQLHost:     Getenv("MYSQL_HOST", "127.0.0.1"),
		MySQLPort:     Getenv("MYSQL_PORT", "3306"),
		MySQLUser:     Getenv("MYSQL_USER", "hive"),
		MySQLPassword: Getenv("MYSQL_PASSWORD", ""),
		MySQLDB:       Getenv("MYSQL_DB", "hive_registry"),
		DBMaxOpen:     maxOpen,
		DBMaxIdle:     maxIdle,
	}
}

// Getenv returns the environment variable value or a default.
func Getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func parseSameSite(v string) http.SameSite {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}
