package handler

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"

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
	if req.Email == "" {
		h.jsonErr(w, http.StatusBadRequest, "email required")
		return
	}

	// Check customer exists
	var count int64
	h.DB.Raw("SELECT COUNT(*) FROM customers WHERE email = ?", req.Email).Scan(&count)
	if count == 0 {
		// Don't reveal whether email exists
		h.jsonOK(w, map[string]string{"message": "如果该邮箱已注册，验证码已发送"})
		return
	}

	// Generate 6-digit code
	code := generate6DigitCode()
	expiresAt := time.Now().UTC().Add(15 * time.Minute).Format("2006-01-02 15:04:05")

	// Invalidate previous unused codes for this email
	h.DB.Exec("UPDATE password_reset_codes SET used = 1 WHERE email = ? AND used = 0", req.Email)

	// Insert new code
	h.DB.Exec(
		"INSERT INTO password_reset_codes (email, code, expires_at, used) VALUES (?, ?, ?, 0)",
		req.Email, code, expiresAt,
	)

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

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Find valid code
	var rc model.PasswordResetCode
	err := h.DB.Raw(
		"SELECT id, email, code, expires_at, used FROM password_reset_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1",
		req.Email, req.Code, now,
	).Scan(&rc).Error
	if err != nil || rc.ID == 0 {
		h.jsonErr(w, http.StatusBadRequest, "验证码无效或已过期")
		return
	}

	// Mark code as used
	h.DB.Exec("UPDATE password_reset_codes SET used = 1 WHERE id = ?", rc.ID)

	// Update password
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}
	if err := h.DB.Exec("UPDATE customers SET password_hash = ?, updated_at = ? WHERE email = ?", string(hash), now, req.Email).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "update password: "+err.Error())
		return
	}

	h.jsonOK(w, map[string]string{"message": "密码重置成功"})
}

// generate6DigitCode returns a cryptographically random 6-digit string.
func generate6DigitCode() string {
	b := make([]byte, 3)
	rand.Read(b)
	n := (int(b[0])<<16 | int(b[1])<<8 | int(b[2])) % 1000000
	return fmt.Sprintf("%06d", n)
}
