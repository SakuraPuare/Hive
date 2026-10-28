package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
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

// hmacKey derives a domain-separated signing key from the configured secret.
// Admin and customer cookies are signed with distinct keys so a token minted
// for one audience can never be replayed against the other, even if the two
// payload formats were ever to align.
func (a *Auth) hmacKey(domain string) []byte {
	return []byte(a.Config.AdminSessionSecret + "\x00" + domain)
}

// MakeSessionValue generates a signed cookie value: {expUnix}.{username}.{role}.{sig}
func (a *Auth) MakeSessionValue(exp int64, username, role string) string {
	expStr := strconv.FormatInt(exp, 10)
	payload := expStr + "." + username + "." + role
	mac := hmac.New(sha256.New, a.hmacKey("admin"))
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

	mac := hmac.New(sha256.New, a.hmacKey("admin"))
	_, _ = mac.Write([]byte(payload))
	wantSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(gotSig), []byte(wantSig)) != 1 {
		return "", "", false
	}

	parts := strings.Split(payload, ".")
	if len(parts) >= 3 {
		parts = []string{parts[0], strings.Join(parts[1:len(parts)-1], "."), parts[len(parts)-1]}
	}
	if len(parts) != 3 {
		return "", "", false
	}
	expUnix, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() > expUnix {
		return "", "", false
	}
	return parts[1], parts[2], true
}

// automationContextKey marks a request that RequirePerm admitted through the
// server-only automation credential instead of an admin session cookie.
type automationContextKey struct{}

// IsAutomationRequest reports whether the current request was authenticated by
// the automation credential (ADMIN_API_SECRET) rather than a browser session.
// Handlers use it to allow operator automation to reach exports that are
// otherwise scoped to a single paid customer subscription.
func IsAutomationRequest(r *http.Request) bool {
	automation, _ := r.Context().Value(automationContextKey{}).(bool)
	return automation
}

// RequirePerm returns middleware that checks the user has the given permission.
func (a *Auth) RequirePerm(perm string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if a.checkAPISecret(r) {
				next(w, r.WithContext(context.WithValue(r.Context(), automationContextKey{}, true)))
				return
			}
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
	mac := hmac.New(sha256.New, a.hmacKey("customer"))
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

	mac := hmac.New(sha256.New, a.hmacKey("customer"))
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

// RequireDeviceAuth verifies a per-device credential and binds it to the MAC.
// Body-based routes supply the decoded MAC explicitly. Shared image secrets are
// deliberately never accepted here.
func (a *Auth) RequireDeviceAuth(w http.ResponseWriter, r *http.Request, bodyMAC ...string) bool {
	mac := r.PathValue("mac")
	if len(bodyMAC) > 0 {
		mac = bodyMAC[0]
	}
	mac = strings.ToLower(mac)
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if ok && token != "" && mac != "" && a.DB != nil {
		sum := sha256.Sum256([]byte(token))
		var stored string
		err := a.DB.Raw("SELECT token_hash FROM device_credentials WHERE mac = ?", mac).Scan(&stored).Error
		if err == nil && stored != "" && subtle.ConstantTimeCompare([]byte(stored), []byte(hex.EncodeToString(sum[:]))) == 1 {
			return true
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"invalid device credential"}`))
	return false
}

// queryTokenPaths are the only routes where the automation credential may be
// passed as ?token= instead of an Authorization header. Clients that embed a
// subscription URL (mihomo proxy-providers, browsers, pasted links) cannot set
// headers, so those two exports accept it; everything else stays header-only so
// operator automation does not start leaking secrets through query strings.
var queryTokenPaths = map[string]bool{
	"/subscription":       true,
	"/subscription/clash": true,
}

// automationCredentials lists the secrets accepted as operator automation on
// this request.
//
// ADMIN_API_SECRET is a server-only credential and works on every perm-gated
// route. The legacy shared API_SECRET is still baked into deployed firmware
// images and older mihomo configs, so it keeps working on the export routes
// only; admitting it everywhere would hand a widely distributed secret full
// admin API access.
func (a *Auth) automationCredentials(r *http.Request) []string {
	var out []string
	admin, legacy := a.Config.AdminAPISecret, a.Config.APISecret
	if admin != "" && admin != legacy {
		out = append(out, admin)
	}
	if legacy != "" && queryTokenPaths[r.URL.Path] {
		out = append(out, legacy)
	}
	return out
}

func (a *Auth) checkAPISecret(r *http.Request) bool {
	credentials := a.automationCredentials(r)
	if len(credentials) == 0 {
		return false
	}

	token, hasHeader := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !hasHeader || token == "" {
		if !queryTokenPaths[r.URL.Path] {
			return false
		}
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		return false
	}

	ok := false
	for _, c := range credentials {
		if subtle.ConstantTimeCompare([]byte(token), []byte(c)) == 1 {
			ok = true
		}
	}
	return ok
}
