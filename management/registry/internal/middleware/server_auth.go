package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"gorm.io/gorm"
)

// ValidServerCredential deliberately accepts neither device nor administrator
// credentials. Call it again inside the accounting transaction after locking
// the node, so rotation/revocation cannot race a previously authenticated report.
func ValidServerCredential(db *gorm.DB, r *http.Request) (bool, error) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || token == "" || r.PathValue("mac") == "" {
		return false, nil
	}
	var hash string
	err := db.Raw(`SELECT sc.token_hash FROM server_credentials sc JOIN nodes n ON n.mac = sc.mac
		WHERE n.mac = ? AND n.server_enabled = 1 AND n.owner_customer_id IS NULL`, r.PathValue("mac")).Scan(&hash).Error
	if err != nil {
		return false, err
	}
	sum := sha256.Sum256([]byte(token))
	return hash != "" && subtle.ConstantTimeCompare([]byte(hash), []byte(hex.EncodeToString(sum[:]))) == 1, nil
}

func (a *Auth) RequireServerAuth(w http.ResponseWriter, r *http.Request) bool {
	ok, err := ValidServerCredential(a.DB, r)
	if err != nil {
		http.Error(w, `{"error":"server authentication unavailable"}`, http.StatusServiceUnavailable)
		return false
	}
	if !ok {
		http.Error(w, `{"error":"trusted server credential required"}`, http.StatusUnauthorized)
		return false
	}
	return true
}
