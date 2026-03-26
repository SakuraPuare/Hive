package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"hive/registry/internal/store"
)

// HandleAdminLogin godoc
// @Summary Admin login
// @ID      AdminLogin
// @Tags admin
// @Accept json
// @Produce json
// @Param body body AdminLoginRequest true "credentials"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /admin/login [post]
//
// HandleAdminLogin handles POST /admin/login
func (h *Handler) HandleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var req AdminLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Username == "" || req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "required: username, password")
		return
	}
	if h.Auth.Config.AdminSessionSecret == "" {
		h.jsonErr(w, http.StatusInternalServerError, "server misconfig: ADMIN_SESSION_SECRET is empty")
		return
	}

	ip := getClientIP(r)

	var u struct {
		ID           uint
		PasswordHash string
		Role         string
	}
	err := h.DB.Table("users").Select("id, password_hash, role").Where("username = ?", req.Username).Scan(&u).Error
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if u.ID == 0 {
		store.WriteAuditLog(h.DB, req.Username, "login_fail", "user not found", ip)
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized: invalid credentials")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		store.WriteAuditLog(h.DB, req.Username, "login_fail", "wrong password", ip)
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized: invalid credentials")
		return
	}

	expUnix := time.Now().UTC().Add(h.Auth.Config.AdminSessionTTL).Unix()
	token := h.Auth.MakeSessionValue(expUnix, req.Username, u.Role)

	secure := isSecureRequest(r)
	http.SetCookie(w, &http.Cookie{
		Name:     h.Auth.Config.AdminCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: h.Auth.Config.AdminCookieSameSite,
		MaxAge:   int(h.Auth.Config.AdminSessionTTL.Seconds()),
	})

	store.WriteAuditLog(h.DB, req.Username, "login_success", "role: "+u.Role, ip)
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleAdminLogout godoc
// @Summary Admin logout
// @ID      AdminLogout
// @Tags admin
// @Produce json
// @Success 200 {object} StatusResponse
// @Security AdminSessionCookie
// @Router /admin/logout [post]
//
// HandleAdminLogout handles POST /admin/logout
func (h *Handler) HandleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if username, _, ok := h.Auth.ParseSession(r); ok {
		store.WriteAuditLog(h.DB, username, "logout", "", getClientIP(r))
	}
	secure := isSecureRequest(r)
	http.SetCookie(w, &http.Cookie{
		Name:     h.Auth.Config.AdminCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: h.Auth.Config.AdminCookieSameSite,
		MaxAge:   -1,
	})
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleAdminMe godoc
// @Summary Get current admin user info
// @ID      AdminMe
// @Tags admin
// @Produce json
// @Success 200 {object} MeResponse
// @Failure 401 {object} ErrorResponse
// @Security AdminSessionCookie
// @Router /admin/me [get]
//
// HandleAdminMe handles GET /admin/me
func (h *Handler) HandleAdminMe(w http.ResponseWriter, r *http.Request) {
	username, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var uid uint
	if err := h.DB.Raw("SELECT id FROM users WHERE username=?", username).Scan(&uid).Error; err != nil || uid == 0 {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized: user not found")
		return
	}

	roles := h.getUserRoleNames(uid)
	if roles == nil {
		roles = []string{}
	}

	permList := store.GetUserPermissions(h.DB, uid)
	if permList == nil {
		permList = []string{}
	}

	h.jsonOK(w, MeResponse{
		ID:          uid,
		Username:    username,
		Roles:       roles,
		Permissions: permList,
	})
}

// isSecureRequest returns true if the request is over TLS or forwarded as HTTPS.
func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}
