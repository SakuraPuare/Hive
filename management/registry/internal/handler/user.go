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

// HandleListUsers godoc
// @Summary      获取用户列表
// @ID           AdminListUsers
// @Description  返回所有用户及其角色
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {array}  UserWithRoles
// @Failure      500 {object} ErrorResponse
// @Router       /admin/users [get]
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

// HandleCreateUser godoc
// @Summary      创建用户
// @ID           AdminCreateUser
// @Description  创建新的管理后台用户
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        body body CreateUserRequest true "用户信息"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      409 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/users [post]
func (h *Handler) HandleCreateUser(w http.ResponseWriter, r *http.Request) {
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
	now := time.Now().UTC().Format(model.TimeLayout)
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

// HandleDeleteUser godoc
// @Summary      删除用户
// @ID           AdminDeleteUser
// @Description  根据 ID 删除管理后台用户
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        id path int true "用户 ID"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/users/{id} [delete]
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
	now := time.Now().UTC().Format(model.TimeLayout)
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

// HandleChangePasswordRoute godoc
// @Summary      修改用户密码
// @ID           AdminChangePassword
// @Description  修改指定用户的密码（可改自己或需要 user:write 权限）
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        id   path int                true "用户 ID"
// @Param        body body ChangePasswordRequest true "新密码"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      401 {object} ErrorResponse
// @Failure      403 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/users/{id}/password [post]
func (h *Handler) HandleChangePasswordRoute(w http.ResponseWriter, r *http.Request) {
	username, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	_ = username
	h.HandleChangePassword(w, r)
}

// HandleSetUserRoles godoc
// @Summary      设置用户角色
// @ID           AdminSetUserRoles
// @Description  替换指定用户的所有角色
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        id   path int             true "用户 ID"
// @Param        body body SetRolesRequest  true "角色列表"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/users/{id}/roles [put]
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
		now := time.Now().UTC().Format(model.TimeLayout)
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

// HandleListAuditLogs godoc
// @Summary      获取审计日志
// @ID           AdminAuditLogs
// @Description  分页查询审计日志，支持按操作类型、用户名、时间范围筛选
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        limit    query int    false "每页条数（默认 50，最大 500）"
// @Param        offset   query int    false "偏移量"
// @Param        action   query string false "操作类型"
// @Param        username query string false "用户名"
// @Param        from     query string false "起始时间（含）"
// @Param        to       query string false "结束时间（含）"
// @Success      200 {array}  model.AuditLog
// @Failure      500 {object} ErrorResponse
// @Router       /admin/audit-logs [get]
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
