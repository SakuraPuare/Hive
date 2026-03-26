package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.SplitN(xff, ",", 2)[0]
	}
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		return addr[:idx]
	}
	return addr
}

func (h *Handler) getUserRoleNames(userID uint) []string {
	var names []string
	h.DB.Raw(`
		SELECT r.name FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE ur.user_id = ?
		ORDER BY r.id
	`, userID).Scan(&names)
	return names
}

func (h *Handler) hasPermission(userID uint, perm string) bool {
	perms := store.GetUserPermissions(h.DB, userID)
	for _, p := range perms {
		if p == perm {
			return true
		}
	}
	return false
}

// GET /admin/users
func (h *Handler) HandleListUsers(w http.ResponseWriter, r *http.Request) {
	type UserRow struct {
		ID        uint   `json:"id"`
		Username  string `json:"username"`
		Role      string `json:"role"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}
	var rows []UserRow
	if err := h.DB.Raw("SELECT id, username, role, created_at, updated_at FROM users ORDER BY id").Scan(&rows).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	type UserWithRoles struct {
		ID        uint     `json:"id"`
		Username  string   `json:"username"`
		Roles     []string `json:"roles"`
		CreatedAt string   `json:"created_at"`
		UpdatedAt string   `json:"updated_at"`
	}
	users := make([]UserWithRoles, 0, len(rows))
	for _, row := range rows {
		u := UserWithRoles{
			ID:        row.ID,
			Username:  row.Username,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
		}
		u.Roles = h.getUserRoleNames(u.ID)
		if u.Roles == nil {
			u.Roles = []string{row.Role}
		}
		users = append(users, u)
	}
	h.jsonOK(w, users)
}

// POST /admin/users
func (h *Handler) HandleCreateUser(w http.ResponseWriter, r *http.Request) {
	type CreateUserRequest struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Username == "" || req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "required: username, password")
		return
	}
	if req.Role != "" {
		var cnt int64
		h.DB.Model(&model.RoleModel{}).Where("name=?", req.Role).Count(&cnt)
		if cnt == 0 {
			h.jsonErr(w, http.StatusBadRequest, "unknown role: "+req.Role)
			return
		}
	} else {
		req.Role = "viewer"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := h.DB.Exec(
		"INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		req.Username, string(hash), req.Role, now, now,
	).Error; err != nil {
		if strings.Contains(err.Error(), "Duplicate") {
			h.jsonErr(w, http.StatusConflict, "username already exists")
			return
		}
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	var newUID uint
	h.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&newUID)
	var roleID uint
	if err := h.DB.Raw("SELECT id FROM roles WHERE name=?", req.Role).Scan(&roleID).Error; err == nil && roleID > 0 {
		h.DB.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", newUID, roleID)
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "user_create", "created user: "+req.Username+" role: "+req.Role, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// DELETE /admin/users/{id}
func (h *Handler) HandleDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor, _, _ := h.Auth.ParseSession(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var targetUsername string
	if err := h.DB.Raw("SELECT username FROM users WHERE id=?", id).Scan(&targetUsername).Error; err != nil || targetUsername == "" {
		h.jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	if targetUsername == actor {
		h.jsonErr(w, http.StatusBadRequest, "cannot delete yourself")
		return
	}
	result := h.DB.Exec("DELETE FROM users WHERE id=?", id)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	store.WriteAuditLog(h.DB, actor, "user_delete", "deleted user: "+targetUsername, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// POST /admin/users/{id}/password
func (h *Handler) HandleChangePassword(w http.ResponseWriter, r *http.Request) {
	actor, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	idStr := r.PathValue("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var targetUsername string
	if err := h.DB.Raw("SELECT username FROM users WHERE id=?", id).Scan(&targetUsername).Error; err != nil || targetUsername == "" {
		h.jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	if targetUsername != actor {
		var actorUID uint
		h.DB.Raw("SELECT id FROM users WHERE username=?", actor).Scan(&actorUID)
		if !h.hasPermission(actorUID, "user:write") {
			h.jsonErr(w, http.StatusForbidden, "forbidden: can only change your own password")
			return
		}
	}
	type ChangePasswordRequest struct {
		Password string `json:"password"`
	}
	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "required: password")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	result := h.DB.Exec("UPDATE users SET password_hash=?, updated_at=? WHERE id=?", string(hash), now, id)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	store.WriteAuditLog(h.DB, actor, "password_change", "changed password for: "+targetUsername, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleChangePasswordRoute is a wrapper used when the route doesn't require perm middleware.
func (h *Handler) HandleChangePasswordRoute(w http.ResponseWriter, r *http.Request) {
	username, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	_ = username
	h.HandleChangePassword(w, r)
}

// HandleSetUserRoles handles PUT /admin/users/{id}/roles.
func (h *Handler) HandleSetUserRoles(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	uid, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var targetUsername string
	if err := h.DB.Raw("SELECT username FROM users WHERE id=?", uid).Scan(&targetUsername).Error; err != nil || targetUsername == "" {
		h.jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	type SetRolesRequest struct {
		Roles []string `json:"roles"`
	}
	var req SetRolesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(req.Roles) == 0 {
		h.jsonErr(w, http.StatusBadRequest, "roles must not be empty")
		return
	}
	for _, name := range req.Roles {
		var cnt int64
		h.DB.Model(&model.RoleModel{}).Where("name = ?", name).Count(&cnt)
		if cnt == 0 {
			h.jsonErr(w, http.StatusBadRequest, "unknown role: "+name)
			return
		}
	}
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", uid).Delete(&model.UserRole{}).Error; err != nil {
			return err
		}
		primaryRole := req.Roles[0]
		for _, name := range req.Roles {
			var role model.RoleModel
			if err := tx.Where("name = ?", name).Select("id").First(&role).Error; err != nil {
				continue
			}
			tx.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, role.ID)
		}
		now := time.Now().UTC().Format("2006-01-02 15:04:05")
		tx.Exec("UPDATE users SET role=?, updated_at=? WHERE id=?", primaryRole, now, uid)
		return nil
	}); err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "tx: "+err.Error())
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "user_roles_update",
		"user: "+targetUsername+" roles: "+strings.Join(req.Roles, ","),
		getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// GET /admin/audit-logs
func (h *Handler) HandleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 50
	offset := 0
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	where := "1=1"
	args := []any{}
	if v := q.Get("action"); v != "" {
		where += " AND action = ?"
		args = append(args, v)
	}
	if v := q.Get("username"); v != "" {
		where += " AND username = ?"
		args = append(args, v)
	}
	if v := q.Get("from"); v != "" {
		where += " AND created_at >= ?"
		args = append(args, v)
	}
	if v := q.Get("to"); v != "" {
		where += " AND created_at <= ?"
		args = append(args, v)
	}
	args = append(args, limit, offset)
	logs := make([]model.AuditLog, 0)
	if err := h.DB.Raw(
		"SELECT id, username, action, detail, ip, created_at FROM audit_logs WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?",
		args...,
	).Scan(&logs).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, logs)
}
