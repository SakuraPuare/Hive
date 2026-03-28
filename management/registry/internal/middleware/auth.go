package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/config"
	"hive/registry/internal/store"
)

// Auth holds authentication state and provides middleware.
type Auth struct {
	Config *config.Config
	DB     *gorm.DB
}

// MakeSessionValue generates a signed cookie value: {expUnix}.{username}.{role}.{sig}
func (a *Auth) MakeSessionValue(exp int64, username, role string) string {
	expStr := strconv.FormatInt(exp, 10)
	payload := expStr + "." + username + "." + role
	mac := hmac.New(sha256.New, []byte(a.Config.AdminSessionSecret))
	_, _ = mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payload + "." + sig
}

// ParseSession parses and validates the session cookie, returns (username, role, valid).
func (a *Auth) ParseSession(r *http.Request) (username, role string, valid bool) {
	if a.Config.AdminSessionSecret == "" {
		return "", "", false
	}
	c, err := r.Cookie(a.Config.AdminCookieName)
	if err != nil {
		return "", "", false
	}
	lastDot := strings.LastIndex(c.Value, ".")
	if lastDot < 0 {
		return "", "", false
	}
	payload := c.Value[:lastDot]
	gotSig := c.Value[lastDot+1:]

	mac := hmac.New(sha256.New, []byte(a.Config.AdminSessionSecret))
	_, _ = mac.Write([]byte(payload))
	wantSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(gotSig), []byte(wantSig)) != 1 {
		return "", "", false
	}

	parts := strings.SplitN(payload, ".", 3)
	if len(parts) != 3 {
		return "", "", false
	}
	expUnix, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() > expUnix {
		return "", "", false
	}
	return parts[1], parts[2], true
}

// RequirePerm returns middleware that checks the user has the given permission.
func (a *Auth) RequirePerm(perm string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			username, _, ok := a.ParseSession(r)
			if !ok {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			var uid uint
			a.DB.Raw("SELECT id FROM users WHERE username = ?", username).Scan(&uid)
			if uid == 0 {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			perms := store.GetUserPermissions(a.DB, uid)
			for _, p := range perms {
				if p == perm {
					next(w, r)
					return
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"forbidden"}`))
		}
	}
}

// MakeCustomerSessionValue generates a signed customer cookie: {expUnix}.{customerID}.{sig}
func (a *Auth) MakeCustomerSessionValue(exp int64, customerID uint) string {
	expStr := strconv.FormatInt(exp, 10)
	cidStr := strconv.FormatUint(uint64(customerID), 10)
	payload := expStr + "." + cidStr
	mac := hmac.New(sha256.New, []byte(a.Config.AdminSessionSecret))
	_, _ = mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payload + "." + sig
}

// ParseCustomerSession parses and validates the customer session cookie, returns (customerID, valid).
func (a *Auth) ParseCustomerSession(r *http.Request) (customerID uint, valid bool) {
	if a.Config.AdminSessionSecret == "" {
		return 0, false
	}
	c, err := r.Cookie("hive_customer_session")
	if err != nil {
		return 0, false
	}
	lastDot := strings.LastIndex(c.Value, ".")
	if lastDot < 0 {
		return 0, false
	}
	payload := c.Value[:lastDot]
	gotSig := c.Value[lastDot+1:]

	mac := hmac.New(sha256.New, []byte(a.Config.AdminSessionSecret))
	_, _ = mac.Write([]byte(payload))
	wantSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(gotSig), []byte(wantSig)) != 1 {
		return 0, false
	}

	parts := strings.SplitN(payload, ".", 2)
	if len(parts) != 2 {
		return 0, false
	}
	expUnix, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() > expUnix {
		return 0, false
	}
	cid, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil || cid == 0 {
		return 0, false
	}
	return uint(cid), true
}

// RequireDeviceAuth checks Bearer token for device API endpoints.
// Returns true if auth passed, false if it wrote an error response.
func (a *Auth) RequireDeviceAuth(w http.ResponseWriter, r *http.Request) bool {
	if a.Config.APISecret == "" {
		log.Println("WARN: API_SECRET is empty, denying device auth request")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"server misconfigured: API_SECRET not set"}`))
		return false
	}
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"missing or invalid Authorization header"}`))
		return false
	}
	token := strings.TrimPrefix(auth, "Bearer ")
	if subtle.ConstantTimeCompare([]byte(token), []byte(a.Config.APISecret)) != 1 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid token"}`))
		return false
	}
	return true
}
