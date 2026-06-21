package middleware

import (
	"net/http"
	"strings"

	"hive/registry/internal/config"
)

// WithCORS wraps a handler with CORS support.
func WithCORS(next http.Handler, cfg *config.Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			allowed, credentials := resolveOrigin(origin, cfg.CORSAllowedOrigins)
			if !allowed {
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			// Credentials are only safe to allow when the origin was matched
			// explicitly. A wildcard ("*") match must never be combined with
			// credentials, or any site could make authenticated cross-origin
			// calls with the user's session cookie.
			if credentials {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")

			reqHeaders := strings.TrimSpace(r.Header.Get("Access-Control-Request-Headers"))
			if reqHeaders != "" {
				w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
			} else {
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			}
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// resolveOrigin reports whether origin is permitted and whether credentials
// may be allowed for it. An exact (case-insensitive) match permits credentials;
// a wildcard ("*") match permits the request but not credentials.
func resolveOrigin(origin string, allowed []string) (ok, credentials bool) {
	if len(allowed) == 0 {
		return false, false
	}
	wildcard := false
	for _, a := range allowed {
		if strings.EqualFold(a, origin) {
			return true, true
		}
		if a == "*" {
			wildcard = true
		}
	}
	if wildcard {
		return true, false
	}
	return false, false
}
