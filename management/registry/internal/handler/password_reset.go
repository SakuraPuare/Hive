package handler

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"hive/registry/internal/mailer"
	"hive/registry/internal/model"
)

// ── request types ────────────────────────────────────────────────────────────

type ForgotPasswordRequest struct {
	Email string `json:"email"`
}

type ResetPasswordRequest struct {
	Email    string `json:"email"`
	Code     string `json:"code"`
	Password string `json:"password"`
}

// ── POST /portal/forgot-password ─────────────────────────────────────────────

// HandleForgotPassword godoc
// @Summary      发送密码重置验证码
// @ID           PortalForgotPassword
// @Description  向指定邮箱发送 6 位验证码，15 分钟有效
// @Tags         portal-auth
// @Accept       json
// @Produce      json
// @Param        body body ForgotPasswordRequest true "邮箱"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Router       /portal/forgot-password [post]
func (h *Handler) HandleForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" {
		h.jsonErr(w, http.StatusBadRequest, "email required")
		return
	}
	if !isValidEmail(req.Email) {
		h.jsonErr(w, http.StatusBadRequest, "邮箱格式无效")
		return
	}

	// Check customer exists
	var count int64
	if err := h.DB.Raw("SELECT COUNT(*) FROM customers WHERE email = ?", req.Email).Scan(&count).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if count == 0 {
		// Don't reveal whether email exists
		h.jsonOK(w, map[string]string{"message": "如果该邮箱已注册，验证码已发送"})
		return
	}

	// Generate 6-digit code
	code, err := generate6DigitCode()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "generate code: "+err.Error())
		return
	}
	expiresAt := time.Now().UTC().Add(15 * time.Minute).Format(model.TimeLayout)

	send := false
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		var cid uint
		if err := tx.Raw("SELECT id FROM customers WHERE email = ? FOR UPDATE", req.Email).Scan(&cid).Error; err != nil {
			return err
		}
		// Also rate-limit issuance per account, including concurrent requests.
		var recent int64
		if err := tx.Raw("SELECT COUNT(*) FROM password_reset_codes WHERE email = ? AND created_at > ?", req.Email, time.Now().UTC().Add(-time.Minute)).Scan(&recent).Error; err != nil {
			return err
		}
		if recent > 0 || cid == 0 {
			return nil
		}
		if err := tx.Exec("UPDATE password_reset_codes SET used = 1 WHERE email = ? AND used = 0", req.Email).Error; err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO password_reset_codes (email, code, expires_at, used) VALUES (?, ?, ?, 0)", req.Email, code, expiresAt).Error; err != nil {
			return err
		}
		send = true
		return nil
	}); err != nil {
		h.jsonErr(w, 500, "cannot create password reset")
		return
	}
	if !send {
		h.jsonOK(w, map[string]string{"message": "如果该邮箱已注册，验证码已发送"})
		return
	}

	// Send email
	body := mailer.RenderMailTemplate("password_reset", map[string]string{"code": code})
	go h.Mailer.SendMail(req.Email, "密码重置验证码", body)

	h.jsonOK(w, map[string]string{"message": "如果该邮箱已注册，验证码已发送"})
}

// ── POST /portal/reset-password ──────────────────────────────────────────────

// HandleResetPassword godoc
// @Summary      重置密码
// @ID           PortalResetPassword
// @Description  使用验证码重置客户密码
// @Tags         portal-auth
// @Accept       json
// @Produce      json
// @Param        body body ResetPasswordRequest true "邮箱、验证码、新密码"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /portal/reset-password [post]
func (h *Handler) HandleResetPassword(w http.ResponseWriter, r *http.Request) {
	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Email == "" || req.Code == "" || req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "email, code, password required")
		return
	}
	if !isValidPassword(req.Password) {
		h.jsonErr(w, http.StatusBadRequest, "密码长度不能少于8个字符")
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	valid := false
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var cid uint
		if err := tx.Raw("SELECT id FROM customers WHERE email = ? FOR UPDATE", req.Email).Scan(&cid).Error; err != nil {
			return err
		}
		if cid == 0 {
			return nil
		}
		var rc struct {
			ID       uint
			Code     string
			Attempts int
		}
		if err := tx.Raw(`SELECT id, code, attempts FROM password_reset_codes
            WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1 FOR UPDATE`, req.Email, time.Now().UTC()).Scan(&rc).Error; err != nil {
			return err
		}
		if rc.ID == 0 || rc.Attempts >= 5 {
			return nil
		}
		if subtle.ConstantTimeCompare([]byte(rc.Code), []byte(req.Code)) != 1 {
			// Commit failed attempts too. Returning an error would roll them back.
			return tx.Exec("UPDATE password_reset_codes SET attempts = attempts + 1, used = ? WHERE id = ?", rc.Attempts+1 >= 5, rc.ID).Error
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		if err := tx.Exec("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?", string(hash), time.Now().UTC(), cid).Error; err != nil {
			return err
		}
		if err := tx.Exec("UPDATE password_reset_codes SET used = 1 WHERE email = ? AND used = 0", req.Email).Error; err != nil {
			return err
		}
		valid = true
		return nil
	})
	if err != nil {
		h.jsonErr(w, 500, "cannot reset password")
		return
	}
	if !valid {
		h.jsonErr(w, 400, "验证码无效或已过期")
		return
	}

	h.jsonOK(w, map[string]string{"message": "密码重置成功"})
}

// generate6DigitCode returns a cryptographically random 6-digit string.
func generate6DigitCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", fmt.Errorf("crypto/rand: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
