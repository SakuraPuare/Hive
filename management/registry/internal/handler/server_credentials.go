package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"gorm.io/gorm"

	"hive/registry/internal/store"
)

type ServerCredentialResponse struct {
	MAC   string `json:"mac"`
	Token string `json:"token"`
}

var errCustomerOwnedServer = errors.New("customer-owned devices cannot be trusted exit servers")

// HandleIssueServerCredential godoc
// @Summary Enable a trusted exit server and issue or rotate its credential
// @Description Only operator-controlled, unowned nodes may serve as exits. The token is returned once.
// @ID ServerCredentialIssue
// @Tags admin
// @Security AdminSessionCookie
// @Produce json
// @Param mac path string true "Server MAC"
// @Success 200 {object} ServerCredentialResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Router /admin/nodes/{mac}/server-credential [post]
func (h *Handler) HandleIssueServerCredential(w http.ResponseWriter, r *http.Request) {
	mac := strings.ToLower(r.PathValue("mac"))
	if !deviceMACPattern.MatchString(mac) {
		h.jsonErr(w, 400, "mac must be 12 hexadecimal characters")
		return
	}
	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, 500, "cannot generate server credential")
		return
	}
	sum := sha256.Sum256([]byte(token))
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		var n struct {
			MAC             string
			OwnerCustomerID *uint
		}
		if err := tx.Raw("SELECT mac, owner_customer_id FROM nodes WHERE mac = ? FOR UPDATE", mac).Scan(&n).Error; err != nil {
			return err
		}
		if n.MAC == "" {
			return gorm.ErrRecordNotFound
		}
		if n.OwnerCustomerID != nil {
			return errCustomerOwnedServer
		}
		if err := tx.Exec("UPDATE nodes SET server_enabled = 1 WHERE mac = ?", mac).Error; err != nil {
			return err
		}
		return tx.Exec(`INSERT INTO server_credentials (mac, token_hash) VALUES (?, ?)
			ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash)`, mac, hex.EncodeToString(sum[:])).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		h.jsonErr(w, 404, "node not found")
		return
	}
	if errors.Is(err, errCustomerOwnedServer) {
		h.jsonErr(w, 409, err.Error())
		return
	}
	if err != nil {
		h.jsonErr(w, 500, "cannot store server credential")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "server_credential_rotate", "mac="+mac, getClientIP(r))
	w.Header().Set("Cache-Control", "no-store")
	h.jsonOK(w, ServerCredentialResponse{MAC: mac, Token: token})
}

// HandleRevokeServerCredential godoc
// @Summary Disable an exit server and revoke its credential
// @ID ServerCredentialRevoke
// @Tags admin
// @Security AdminSessionCookie
// @Param mac path string true "Server MAC"
// @Success 200 {object} StatusResponse
// @Failure 404 {object} ErrorResponse
// @Router /admin/nodes/{mac}/server-credential [delete]
func (h *Handler) HandleRevokeServerCredential(w http.ResponseWriter, r *http.Request) {
	mac := strings.ToLower(r.PathValue("mac"))
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var found string
		if err := tx.Raw("SELECT mac FROM nodes WHERE mac = ? FOR UPDATE", mac).Scan(&found).Error; err != nil {
			return err
		}
		if found == "" {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Exec("UPDATE nodes SET server_enabled = 0 WHERE mac = ?", mac).Error; err != nil {
			return err
		}
		return tx.Exec("DELETE FROM server_credentials WHERE mac = ?", mac).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		h.jsonErr(w, 404, "node not found")
		return
	}
	if err != nil {
		h.jsonErr(w, 500, "cannot revoke server credential")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "server_credential_revoke", "mac="+mac, getClientIP(r))
	h.jsonOK(w, StatusResponse{Status: "ok"})
}
