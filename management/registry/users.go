package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// ── 数据结构 ───────────────────────────────────────────────────────────────────

type User struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type AuditLog struct {
	ID        uint64 `json:"id"`
	Username  string `json:"username"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	IP        string `json:"ip"`
	CreatedAt string `json:"created_at"`
}

// ── 启动初始化 ─────────────────────────────────────────────────────────────────

// bootstrapSuperadmin 在 users 表为空时，用环境变量 ADMIN_USER/ADMIN_PASS 创建初始 superadmin。
func bootstrapSuperadmin() {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		log.Fatalf("bootstrapSuperadmin count: %v", err)
	}
	if count > 0 {
		return
	}
	if adminPass == "" {
		log.Println("bootstrapSuperadmin: ADMIN_PASS is empty, skipping (set ADMIN_USER + ADMIN_PASS to create initial superadmin)")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(adminPass), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("bootstrapSuperadmin bcrypt: %v", err)
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	_, err = db.Exec(
		"INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'superadmin', ?, ?)",
		adminUser, string(hash), now, now,
	)
	if err != nil {
		log.Fatalf("bootstrapSuperadmin insert: %v", err)
	}
	log.Printf("bootstrapped superadmin: %s", adminUser)
}

// ── 审计日志 ───────────────────────────────────────────────────────────────────

func writeAuditLog(username, action, detail, ip string) {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if _, err := db.Exec(
		"INSERT INTO audit_logs (username, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)",
		username, action, detail, ip, now,
	); err != nil {
		log.Printf("writeAuditLog: %v", err)
	}
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.SplitN(xff, ",", 2)[0]
	}
	// RemoteAddr 格式为 "ip:port"
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		return addr[:idx]
	}
	return addr
}

// ── Request 结构体 ─────────────────────────────────────────────────────────────

type CreateUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type ChangePasswordRequest struct {
	Password string `json:"password"`
}

// ── Handlers ───────────────────────────────────────────────────────────────────

// GET /admin/me
//
// @Summary Get current logged-in user info
// @Tags admin
// @Produce application/json
// @Success 200 {object} User
// @Failure 401 {object} ErrorResponse
// @Router /admin/me [get]
// @ID AdminMe
func handleAdminMe(w http.ResponseWriter, r *http.Request) {
	username, _, ok := parseSession(r)
	if !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var uid uint
	if err := db.QueryRow("SELECT id FROM users WHERE username=?", username).Scan(&uid); err != nil {
		jsonErr(w, http.StatusUnauthorized, "unauthorized: user not found")
		return
	}
	roles := getUserRoleNames(uid)
	if roles == nil {
		roles = []string{}
	}
	perms := getUserPermissions(uid)
	permList := make([]string, 0, len(perms))
	for slug := range perms {
		permList = append(permList, slug)
	}
	sort.Strings(permList)

	type MeResponse struct {
		ID          uint     `json:"id"`
		Username    string   `json:"username"`
		Roles       []string `json:"roles"`
		Permissions []string `json:"permissions"`
	}
	jsonOK(w, MeResponse{
		ID:          uid,
		Username:    username,
		Roles:       roles,
		Permissions: permList,
	})
}

// GET /admin/users
//
// @Summary List all users
// @Tags admin
// @Produce application/json
// @Success 200 {array} User
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Router /admin/users [get]
// @ID AdminListUsers
func handleListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, username, role, created_at, updated_at FROM users ORDER BY id")
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()

	type UserWithRoles struct {
		ID        uint     `json:"id"`
		Username  string   `json:"username"`
		Roles     []string `json:"roles"`
		CreatedAt string   `json:"created_at"`
		UpdatedAt string   `json:"updated_at"`
	}

	users := make([]UserWithRoles, 0)
	for rows.Next() {
		var u UserWithRoles
		var primaryRole string
		if err := rows.Scan(&u.ID, &u.Username, &primaryRole, &u.CreatedAt, &u.UpdatedAt); err != nil {
			jsonErr(w, http.StatusInternalServerError, "scan: "+err.Error())
			return
		}
		u.Roles = getUserRoleNames(u.ID)
		if u.Roles == nil {
			u.Roles = []string{primaryRole}
		}
		users = append(users, u)
	}
	jsonOK(w, users)
}

// POST /admin/users
//
// @Summary Create a new user
// @Tags admin
// @Accept json
// @Produce application/json
// @Param body body CreateUserRequest true "create user payload"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Router /admin/users [post]
// @ID AdminCreateUser
func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Username == "" || req.Password == "" {
		jsonErr(w, http.StatusBadRequest, "required: username, password")
		return
	}
	if req.Role != "" {
		// 验证角色存在
		var cnt int
		db.QueryRow("SELECT COUNT(*) FROM roles WHERE name=?", req.Role).Scan(&cnt)
		if cnt == 0 {
			jsonErr(w, http.StatusBadRequest, "unknown role: "+req.Role)
			return
		}
	} else {
		req.Role = "viewer"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	result, err := db.Exec(
		"INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		req.Username, string(hash), req.Role, now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate") {
			jsonErr(w, http.StatusConflict, "username already exists")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	newUID, _ := result.LastInsertId()

	// 同步到 user_roles 表
	var roleID uint
	if err := db.QueryRow("SELECT id FROM roles WHERE name=?", req.Role).Scan(&roleID); err == nil {
		db.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", newUID, roleID)
	}

	actor, _, _ := parseSession(r)
	writeAuditLog(actor, "user_create", "created user: "+req.Username+" role: "+req.Role, getClientIP(r))
	jsonOK(w, StatusResponse{Status: "ok"})
}

// DELETE /admin/users/{id}
//
// @Summary Delete a user
// @Tags admin
// @Produce application/json
// @Param id path int true "user id"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /admin/users/{id} [delete]
// @ID AdminDeleteUser
func handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor, _, _ := parseSession(r)
	idStr := r.PathValue("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	// 查目标用户名，防止删自己
	var targetUsername string
	if err := db.QueryRow("SELECT username FROM users WHERE id=?", id).Scan(&targetUsername); err != nil {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	if targetUsername == actor {
		jsonErr(w, http.StatusBadRequest, "cannot delete yourself")
		return
	}

	result, err := db.Exec("DELETE FROM users WHERE id=?", id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}

	writeAuditLog(actor, "user_delete", "deleted user: "+targetUsername, getClientIP(r))
	jsonOK(w, StatusResponse{Status: "ok"})
}

// POST /admin/users/{id}/password
//
// @Summary Change user password (superadmin for others, any user for self)
// @Tags admin
// @Accept json
// @Produce application/json
// @Param id path int true "user id"
// @Param body body ChangePasswordRequest true "new password"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /admin/users/{id}/password [post]
// @ID AdminChangePassword
func handleChangePassword(w http.ResponseWriter, r *http.Request) {
	actor, _, ok := parseSession(r)
	if !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	idStr := r.PathValue("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	// 查目标用户名
	var targetUsername string
	if err := db.QueryRow("SELECT username FROM users WHERE id=?", id).Scan(&targetUsername); err != nil {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}

	// 只允许拥有 user:write 权限的用户改别人的密码，普通用户只能改自己的
	if targetUsername != actor {
		var actorUID uint
		db.QueryRow("SELECT id FROM users WHERE username=?", actor).Scan(&actorUID)
		if !hasPermission(actorUID, "user:write") {
			jsonErr(w, http.StatusForbidden, "forbidden: can only change your own password")
			return
		}
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Password == "" {
		jsonErr(w, http.StatusBadRequest, "required: password")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	result, err := db.Exec(
		"UPDATE users SET password_hash=?, updated_at=? WHERE id=?",
		string(hash), now, id,
	)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}

	writeAuditLog(actor, "password_change", "changed password for: "+targetUsername, getClientIP(r))
	jsonOK(w, StatusResponse{Status: "ok"})
}

// GET /admin/audit-logs
//
// @Summary List audit logs
// @Tags admin
// @Produce application/json
// @Param limit query int false "limit (default 50)"
// @Param offset query int false "offset (default 0)"
// @Success 200 {array} AuditLog
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Router /admin/audit-logs [get]
// @ID AdminAuditLogs
func handleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	rows, err := db.Query(
		"SELECT id, username, action, detail, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?",
		limit, offset,
	)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()

	logs := make([]AuditLog, 0)
	for rows.Next() {
		var l AuditLog
		if err := rows.Scan(&l.ID, &l.Username, &l.Action, &l.Detail, &l.IP, &l.CreatedAt); err != nil {
			jsonErr(w, http.StatusInternalServerError, "scan: "+err.Error())
			return
		}
		logs = append(logs, l)
	}
	jsonOK(w, logs)
}
