package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ── 权限清单 ───────────────────────────────────────────────────────────────────

// allPermissions 是系统预定义的全量权限，启动时 seed 到 permissions 表。
var allPermissions = []struct{ slug, desc string }{
	{"node:read", "查看节点列表和详情"},
	{"node:write", "编辑节点（location/note/tailscale_ip）"},
	{"node:delete", "删除节点"},
	{"user:read", "查看用户列表"},
	{"user:write", "创建用户、修改密码、分配角色"},
	{"user:delete", "删除用户"},
	{"audit:read", "查看审计日志"},
	{"subscription:read", "查看 VLESS/Clash 订阅"},
	{"label:read", "打印标签页"},
	{"prometheus:read", "Prometheus targets"},
	{"role:read", "查看角色及其权限"},
	{"role:write", "修改角色的权限集合"},
}

// defaultRolePerms 定义三个内置角色的默认权限集合。
var defaultRolePerms = map[string][]string{
	"superadmin": {
		"node:read", "node:write", "node:delete",
		"user:read", "user:write", "user:delete",
		"audit:read", "subscription:read", "label:read", "prometheus:read",
		"role:read", "role:write",
	},
	"admin": {
		"node:read", "node:write",
		"subscription:read", "label:read", "prometheus:read",
	},
	"viewer": {
		"node:read", "subscription:read",
	},
}

// ── 启动初始化 ─────────────────────────────────────────────────────────────────

// bootstrapRBAC 幂等地 seed permissions、roles、role_permissions，
// 并将现有 users.role 字段迁移到 user_roles 表。
func bootstrapRBAC() {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// 1. Seed permissions
	for _, p := range allPermissions {
		db.Exec("INSERT IGNORE INTO permissions (slug, description) VALUES (?, ?)", p.slug, p.desc)
	}

	// 2. Seed roles
	for roleName := range defaultRolePerms {
		db.Exec("INSERT IGNORE INTO roles (name, description, created_at) VALUES (?, ?, ?)",
			roleName, roleName+" 角色", now)
	}

	// 3. Seed role_permissions（幂等）
	for roleName, perms := range defaultRolePerms {
		var roleID uint
		if err := db.QueryRow("SELECT id FROM roles WHERE name=?", roleName).Scan(&roleID); err != nil {
			log.Printf("bootstrapRBAC: role %s not found: %v", roleName, err)
			continue
		}
		for _, slug := range perms {
			var permID uint
			if err := db.QueryRow("SELECT id FROM permissions WHERE slug=?", slug).Scan(&permID); err != nil {
				continue
			}
			db.Exec("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", roleID, permID)
		}
	}

	// 4. 迁移现有用户：将 users.role 字段同步到 user_roles 表
	rows, err := db.Query("SELECT id, role FROM users")
	if err != nil {
		log.Printf("bootstrapRBAC migrate: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var uid uint
		var roleName string
		if err := rows.Scan(&uid, &roleName); err != nil {
			continue
		}
		var roleID uint
		if err := db.QueryRow("SELECT id FROM roles WHERE name=?", roleName).Scan(&roleID); err != nil {
			continue
		}
		db.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, roleID)
	}

	log.Printf("bootstrapRBAC: seeded %d permissions, %d roles", len(allPermissions), len(defaultRolePerms))
}

// ── 权限查询 ───────────────────────────────────────────────────────────────────

// getUserPermissions 返回用户的所有权限 slug（角色权限 ∪ 直接权限）。
func getUserPermissions(userID uint) map[string]bool {
	perms := make(map[string]bool)

	// 通过角色获取权限
	rows, err := db.Query(`
		SELECT DISTINCT p.slug
		FROM user_roles ur
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE ur.user_id = ?
	`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var slug string
			if rows.Scan(&slug) == nil {
				perms[slug] = true
			}
		}
	}

	// 直接授权的权限
	rows2, err := db.Query(`
		SELECT p.slug
		FROM user_permissions up
		JOIN permissions p ON p.id = up.permission_id
		WHERE up.user_id = ?
	`, userID)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var slug string
			if rows2.Scan(&slug) == nil {
				perms[slug] = true
			}
		}
	}

	return perms
}

// getUserRoleNames 返回用户的所有角色名。
func getUserRoleNames(userID uint) []string {
	rows, err := db.Query(`
		SELECT r.name FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE ur.user_id = ?
		ORDER BY r.id
	`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		if rows.Scan(&n) == nil {
			names = append(names, n)
		}
	}
	return names
}

// hasPermission 检查用户是否拥有指定权限。
func hasPermission(userID uint, perm string) bool {
	return getUserPermissions(userID)[perm]
}

// requirePerm 返回中间件，要求请求方持有有效 session 且拥有指定权限。
func requirePerm(perm string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			username, _, ok := parseSession(r)
			if !ok {
				jsonErr(w, http.StatusUnauthorized, "unauthorized: invalid or missing session")
				return
			}
			var uid uint
			if err := db.QueryRow("SELECT id FROM users WHERE username=?", username).Scan(&uid); err != nil {
				jsonErr(w, http.StatusUnauthorized, "unauthorized: user not found")
				return
			}
			if !hasPermission(uid, perm) {
				jsonErr(w, http.StatusForbidden, "forbidden: missing permission "+perm)
				return
			}
			next(w, r)
		}
	}
}

// ── 数据结构 ───────────────────────────────────────────────────────────────────

type Role struct {
	ID          uint     `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

type SetPermissionsRequest struct {
	Permissions []string `json:"permissions"`
}

type SetRolesRequest struct {
	Roles []string `json:"roles"`
}

// ── 角色管理 Handlers ──────────────────────────────────────────────────────────

// GET /admin/roles
//
// @Summary List all roles with their permissions
// @Tags admin
// @Produce application/json
// @Success 200 {array} Role
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Router /admin/roles [get]
// @ID AdminListRoles
func handleListRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, name, description FROM roles ORDER BY id")
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()

	var roles []Role
	for rows.Next() {
		var role Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Description); err != nil {
			jsonErr(w, http.StatusInternalServerError, "scan: "+err.Error())
			return
		}
		// 查该角色的权限
		prows, err := db.Query(`
			SELECT p.slug FROM role_permissions rp
			JOIN permissions p ON p.id = rp.permission_id
			WHERE rp.role_id = ? ORDER BY p.slug
		`, role.ID)
		if err == nil {
			defer prows.Close()
			for prows.Next() {
				var slug string
				if prows.Scan(&slug) == nil {
					role.Permissions = append(role.Permissions, slug)
				}
			}
		}
		if role.Permissions == nil {
			role.Permissions = []string{}
		}
		roles = append(roles, role)
	}
	if roles == nil {
		roles = []Role{}
	}
	jsonOK(w, roles)
}

// PUT /admin/roles/{id}/permissions
//
// @Summary Replace role permissions
// @Tags admin
// @Accept json
// @Produce application/json
// @Param id path int true "role id"
// @Param body body SetPermissionsRequest true "permissions list"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /admin/roles/{id}/permissions [put]
// @ID AdminSetRolePermissions
func handleSetRolePermissions(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	roleID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	// 验证角色存在
	var roleName string
	if err := db.QueryRow("SELECT name FROM roles WHERE id=?", roleID).Scan(&roleName); err != nil {
		jsonErr(w, http.StatusNotFound, "role not found")
		return
	}

	var req SetPermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	// 验证所有 slug 合法
	for _, slug := range req.Permissions {
		var cnt int
		db.QueryRow("SELECT COUNT(*) FROM permissions WHERE slug=?", slug).Scan(&cnt)
		if cnt == 0 {
			jsonErr(w, http.StatusBadRequest, "unknown permission: "+slug)
			return
		}
	}

	// 事务替换
	tx, err := db.Begin()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "tx: "+err.Error())
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM role_permissions WHERE role_id=?", roleID); err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	for _, slug := range req.Permissions {
		var permID uint
		if err := tx.QueryRow("SELECT id FROM permissions WHERE slug=?", slug).Scan(&permID); err != nil {
			continue
		}
		tx.Exec("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", roleID, permID)
	}
	if err := tx.Commit(); err != nil {
		jsonErr(w, http.StatusInternalServerError, "commit: "+err.Error())
		return
	}

	actor, _, _ := parseSession(r)
	writeAuditLog(actor, "role_perm_update",
		"role: "+roleName+" perms: "+strings.Join(req.Permissions, ","),
		getClientIP(r))
	jsonOK(w, StatusResponse{Status: "ok"})
}

// GET /admin/users/{id}/roles
//
// @Summary Get user roles
// @Tags admin
// @Produce application/json
// @Param id path int true "user id"
// @Success 200 {array} string
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /admin/users/{id}/roles [get]
// @ID AdminGetUserRoles
func handleGetUserRoles(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	uid, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var username string
	if err := db.QueryRow("SELECT username FROM users WHERE id=?", uid).Scan(&username); err != nil {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	roles := getUserRoleNames(uint(uid))
	if roles == nil {
		roles = []string{}
	}
	jsonOK(w, roles)
}

// PUT /admin/users/{id}/roles
//
// @Summary Replace user roles
// @Tags admin
// @Accept json
// @Produce application/json
// @Param id path int true "user id"
// @Param body body SetRolesRequest true "roles list"
// @Success 200 {object} StatusResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /admin/users/{id}/roles [put]
// @ID AdminSetUserRoles
func handleSetUserRoles(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	uid, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	var targetUsername string
	if err := db.QueryRow("SELECT username FROM users WHERE id=?", uid).Scan(&targetUsername); err != nil {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}

	var req SetRolesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(req.Roles) == 0 {
		jsonErr(w, http.StatusBadRequest, "roles must not be empty")
		return
	}

	// 验证所有角色名合法
	for _, name := range req.Roles {
		var cnt int
		db.QueryRow("SELECT COUNT(*) FROM roles WHERE name=?", name).Scan(&cnt)
		if cnt == 0 {
			jsonErr(w, http.StatusBadRequest, "unknown role: "+name)
			return
		}
	}

	tx, err := db.Begin()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "tx: "+err.Error())
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM user_roles WHERE user_id=?", uid); err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	primaryRole := req.Roles[0]
	for _, name := range req.Roles {
		var roleID uint
		if err := tx.QueryRow("SELECT id FROM roles WHERE name=?", name).Scan(&roleID); err != nil {
			continue
		}
		tx.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, roleID)
	}
	// 同步更新 users.role 快捷字段
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	tx.Exec("UPDATE users SET role=?, updated_at=? WHERE id=?", primaryRole, now, uid)

	if err := tx.Commit(); err != nil {
		jsonErr(w, http.StatusInternalServerError, "commit: "+err.Error())
		return
	}

	actor, _, _ := parseSession(r)
	writeAuditLog(actor, "user_roles_update",
		"user: "+targetUsername+" roles: "+strings.Join(req.Roles, ","),
		getClientIP(r))
	jsonOK(w, StatusResponse{Status: "ok"})
}

// GET /admin/permissions
//
// @Summary List all available permissions
// @Tags admin
// @Produce application/json
// @Success 200 {array} object
// @Failure 401 {object} ErrorResponse
// @Router /admin/permissions [get]
// @ID AdminListPermissions
func handleListPermissions(w http.ResponseWriter, r *http.Request) {
	type PermItem struct {
		Slug        string `json:"slug"`
		Description string `json:"description"`
	}
	rows, err := db.Query("SELECT slug, description FROM permissions ORDER BY slug")
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	defer rows.Close()
	items := make([]PermItem, 0)
	for rows.Next() {
		var p PermItem
		if rows.Scan(&p.Slug, &p.Description) == nil {
			items = append(items, p)
		}
	}
	jsonOK(w, items)
}
