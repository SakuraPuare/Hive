package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// GET /admin/roles
func (h *Handler) HandleListRoles(w http.ResponseWriter, r *http.Request) {
	type Role struct {
		ID          uint     `json:"id"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}

	var roleModels []model.RoleModel
	if err := h.DB.Order("id").Find(&roleModels).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	roles := make([]Role, 0, len(roleModels))
	for _, rm := range roleModels {
		var slugs []string
		h.DB.Raw(`
			SELECT p.slug FROM role_permissions rp
			JOIN permissions p ON p.id = rp.permission_id
			WHERE rp.role_id = ? ORDER BY p.slug
		`, rm.ID).Scan(&slugs)
		if slugs == nil {
			slugs = []string{}
		}
		roles = append(roles, Role{
			ID:          rm.ID,
			Name:        rm.Name,
			Description: rm.Description,
			Permissions: slugs,
		})
	}
	h.jsonOK(w, roles)
}

// PUT /admin/roles/{id}/permissions
func (h *Handler) HandleUpdateRolePermissions(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	roleID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	var roleName string
	if err := h.DB.Raw("SELECT name FROM roles WHERE id=?", roleID).Scan(&roleName).Error; err != nil || roleName == "" {
		h.jsonErr(w, http.StatusNotFound, "role not found")
		return
	}

	type SetPermissionsRequest struct {
		Permissions []string `json:"permissions"`
	}
	var req SetPermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	for _, slug := range req.Permissions {
		var cnt int64
		h.DB.Model(&model.Permission{}).Where("slug = ?", slug).Count(&cnt)
		if cnt == 0 {
			h.jsonErr(w, http.StatusBadRequest, "unknown permission: "+slug)
			return
		}
	}

	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role_id = ?", roleID).Delete(&model.RolePermission{}).Error; err != nil {
			return err
		}
		for _, slug := range req.Permissions {
			var perm model.Permission
			if err := tx.Where("slug = ?", slug).Select("id").First(&perm).Error; err != nil {
				continue
			}
			tx.Exec("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", roleID, perm.ID)
		}
		return nil
	}); err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "tx: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "role_perm_update",
		"role: "+roleName+" perms: "+strings.Join(req.Permissions, ","),
		getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// GET /admin/permissions
func (h *Handler) HandleListPermissions(w http.ResponseWriter, r *http.Request) {
	type PermItem struct {
		Slug        string `json:"slug"`
		Description string `json:"description"`
	}
	var items []PermItem
	if err := h.DB.Model(&model.Permission{}).Order("slug").Find(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if items == nil {
		items = []PermItem{}
	}
	h.jsonOK(w, items)
}

// HandleListPermissionsRoute is a wrapper that only requires a valid session (no specific perm).
func (h *Handler) HandleListPermissionsRoute(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.Auth.ParseSession(r); !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	h.HandleListPermissions(w, r)
}

// GET /admin/users/{id}/roles
func (h *Handler) HandleGetUserRoles(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	uid, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var username string
	if err := h.DB.Raw("SELECT username FROM users WHERE id=?", uid).Scan(&username).Error; err != nil || username == "" {
		h.jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	roles := h.getUserRoleNames(uint(uid))
	if roles == nil {
		roles = []string{}
	}
	h.jsonOK(w, roles)
}
