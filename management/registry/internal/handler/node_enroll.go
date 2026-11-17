package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// Enrollment accepts a random, durably persisted client secret, never MAC alone.
// The existing credential hash is also the retry proof: identical requests can
// recover a lost response, but a different secret (including one revoked by an
// administrator) cannot rotate credentials or change ownership/configuration.
var enrollMACPattern = regexp.MustCompile(`^[0-9a-f]{12}$`)
var enrollMAC6Pattern = regexp.MustCompile(`^[0-9a-f]{6}$`)
var enrollTokenPattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

var (
	errDeviceClaimed  = errors.New("device is not eligible for enrollment")
	errDeviceEnrolled = errors.New("device already enrolled with a different token")
)

// EnrollRequest requires the device to save Token before its first request.
type EnrollRequest struct {
	MAC      string `json:"mac" binding:"required"`
	Token    string `json:"token" binding:"required" minLength:"64" maxLength:"64" pattern:"^[0-9a-fA-F]{64}$"`
	MAC6     string `json:"mac6"`
	Hostname string `json:"hostname"`
}

// EnrollResponse echoes the accepted client token. Only hashes are stored;
// retries return a claim code only while its derived hash still matches.
type EnrollResponse struct {
	MAC       string `json:"mac"`
	Token     string `json:"token"`
	ClaimCode string `json:"claim_code,omitempty"`
}

// Domain separation keeps the claim code independent of the credential hash.
// Eight Crockford symbols retain the existing human-readable 40-bit format.
func enrollmentClaimCode(mac, token string) string {
	sum := sha256.Sum256([]byte("hive:enrollment-claim:v1\x00" + mac + "\x00" + token))
	var code [9]byte
	for i := range 8 {
		pos := i
		if i >= 4 {
			pos++
		}
		code[pos] = crockfordBase32[sum[i]&31]
	}
	code[4] = '-'
	return string(code[:])
}

// HandleNodeEnroll godoc
// @Summary      Device self-enrollment (first boot)
// @ID           NodeEnroll
// @Description  Requires a random 64-hex token durably saved by the device before its
// @Description  first request. Stores only its hash and creates the node immediately.
// @Description  Retrying the same token succeeds without changing credentials or node state.
// @Description  A different or admin-revoked token is rejected; MAC alone cannot recover secrets.
// @Tags         nodes
// @Accept       json
// @Produce      json
// @Param        body body EnrollRequest true "Device identity and durable enrollment token"
// @Success      200 {object} EnrollResponse
// @Failure      400 {object} ErrorResponse
// @Failure      409 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /nodes/enroll [post]
func (h *Handler) HandleNodeEnroll(w http.ResponseWriter, r *http.Request) {
	var body EnrollRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	mac := strings.ToLower(strings.NewReplacer(":", "", "-", "").Replace(strings.TrimSpace(body.MAC)))
	if !enrollMACPattern.MatchString(mac) {
		h.jsonErr(w, http.StatusBadRequest, "mac must be 12 hexadecimal characters")
		return
	}
	if !enrollTokenPattern.MatchString(body.Token) {
		h.jsonErr(w, http.StatusBadRequest, "token must be 64 hexadecimal characters")
		return
	}
	mac6 := strings.ToLower(strings.TrimSpace(body.MAC6))
	if !enrollMAC6Pattern.MatchString(mac6) {
		mac6 = mac[6:]
	}
	hostname := strings.TrimSpace(body.Hostname)
	if hostname == "" {
		hostname = "hive-" + mac6
	}
	if len(hostname) > 63 || strings.ContainsAny(hostname, " \t\r\n/") {
		h.jsonErr(w, http.StatusBadRequest, "invalid hostname")
		return
	}

	token := body.Token
	sum := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(sum[:])
	now := time.Now().UTC().Format(model.TimeLayout)
	derivedCode := enrollmentClaimCode(mac, token)
	derivedClaimHash := hashClaimCode(derivedCode)
	claimCode := ""
	createdCredential := false

	err := h.DB.Transaction(func(tx *gorm.DB) error {
		// Lock the MAC even on the first request. A no-op upsert serializes
		// concurrent first enrollments without competing missing-row gap locks.
		// Rollback removes this placeholder if an existing credential rejects us.
		if err := tx.Exec(
			"INSERT INTO nodes (mac, mac6, hostname, cf_url, xray_uuid, registered_at, last_seen) "+
				"VALUES (?, ?, ?, '', '', ?, ?) ON DUPLICATE KEY UPDATE mac = VALUES(mac)",
			mac, mac6, hostname, now, now,
		).Error; err != nil {
			return err
		}
		var existing model.Node
		if err := tx.Raw(
			"SELECT mac, registered_at, owner_customer_id, claimed_at, server_enabled, claim_code_hash FROM nodes WHERE mac = ? FOR UPDATE",
			mac,
		).Scan(&existing).Error; err != nil {
			return err
		}
		var storedHash string
		if err := tx.Raw("SELECT token_hash FROM device_credentials WHERE mac = ? FOR UPDATE", mac).Scan(&storedHash).Error; err != nil {
			return err
		}
		if storedHash != "" {
			if storedHash != tokenHash {
				return errDeviceEnrolled
			}
			if existing.ClaimCodeHash == derivedClaimHash {
				claimCode = derivedCode
			}
			return nil
		}
		// Do not turn a legacy claimed/server row into a new client identity.
		if existing.OwnerCustomerID != nil || existing.ClaimedAt != nil || existing.ServerEnabled {
			return errDeviceClaimed
		}
		if err := tx.Exec(
			"INSERT INTO device_credentials (mac, token_hash) VALUES (?, ?)",
			mac, tokenHash,
		).Error; err != nil {
			return err
		}
		createdCredential = true
		updates := map[string]any{"hostname": hostname, "mac6": mac6, "last_seen": now}
		if existing.RegisteredAt == "" {
			updates["registered_at"] = now
		}
		if existing.ClaimCodeHash == "" {
			claimCode = derivedCode
			updates["claim_code_hash"] = derivedClaimHash
		}
		return tx.Model(&model.Node{}).Where("mac = ?", mac).Updates(updates).Error
	})
	switch {
	case errors.Is(err, errDeviceClaimed):
		h.jsonErr(w, http.StatusConflict, "device is not eligible for enrollment; an administrator must re-issue its credential")
		return
	case errors.Is(err, errDeviceEnrolled):
		h.jsonErr(w, http.StatusConflict, "device already enrolled with a different token; use its saved enrollment/device token or ask an administrator to rotate it")
		return
	case err != nil:
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	if createdCredential {
		store.WriteAuditLog(h.DB, "device:"+mac, "device_enroll", "hostname="+hostname, getClientIP(r))
	}
	w.Header().Set("Cache-Control", "no-store")
	h.jsonOK(w, EnrollResponse{MAC: mac, Token: token, ClaimCode: claimCode})
}
