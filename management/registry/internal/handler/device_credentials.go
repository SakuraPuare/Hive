package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"

	"hive/registry/internal/store"
)

var deviceMACPattern = regexp.MustCompile(`^[0-9a-f]{12}$`)

// HandleIssueDeviceCredential provisions or rotates a MAC-scoped device token.
// It also works before the first registration. Only the hash is stored, and
// the plaintext is returned once to the authenticated administrator.
func (h *Handler) HandleIssueDeviceCredential(w http.ResponseWriter, r *http.Request) {
	mac := strings.ToLower(r.PathValue("mac"))
	if !deviceMACPattern.MatchString(mac) {
		h.jsonErr(w, 400, "mac must be 12 hexadecimal characters")
		return
	}
	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, 500, "cannot generate credential")
		return
	}
	sum := sha256.Sum256([]byte(token))
	if err := h.DB.Exec(`INSERT INTO device_credentials (mac, token_hash) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash)`, mac, hex.EncodeToString(sum[:])).Error; err != nil {
		h.jsonErr(w, 500, "cannot store credential")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "device_credential_rotate", "mac: "+mac, getClientIP(r))
	w.Header().Set("Cache-Control", "no-store")
	h.jsonOK(w, map[string]string{"mac": mac, "token": token})
}
