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

// RoleDetail is the response item for listing roles.
type RoleDetail struct {
	ID          uint     `json:"id" example:"1"`
	Name        string   `json:"name" example:"admin"`
	Description string   `json:"description" example:"管理员"`
	Permissions []string `json:"permissions"`
}

// SetPermissionsRequest is the request body for updating role permissions.
type SetPermissionsRequest struct {
	Permissions []string `json:"permissions"`
}

// PermissionItem is the response item for listing permissions.
type PermissionItem struct {
	Slug        string `json:"slug" example:"node:read"`
	Description string `json:"description" example:"查看节点"`
}

// HandleListRoles godoc
// @Summary      获取所有角色
// @ID           AdminListRoles
// @Description  返回所有角色及其权限列表
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {array}  RoleDetail
// @Failure      401 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/roles [get]
func (h *Handler) HandleListRoles(w http.ResponseWriter, r *http.Request) {
	var roleModels []model.RoleModel
	if err := h.DB.Order("id").Find(&roleModels).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	roles := make([]RoleDetail, 0, len(roleModels))
	for _, rm := range roleModels {
		var slugs []string
		if err := h.DB.Raw(`
			SELECT p.slug FROM role_permissions rp
			JOIN permissions p ON p.id = rp.permission_id
			WHERE rp.role_id = ? ORDER BY p.slug
		`, rm.ID).Scan(&slugs).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
		if slugs == nil {
			slugs = []string{}
		}
		roles = append(roles, RoleDetail{
			ID:          rm.ID,
			Name:        rm.Name,
			Description: rm.Description,
			Permissions: slugs,
		})
	}
	h.jsonOK(w, roles)
}

// HandleUpdateRolePermissions godoc
// @Summary      更新角色权限
// @ID           AdminSetRolePermissions
// @Description  替换指定角色的全部权限
// @Tags         admin
// @Security     AdminSessionCookie
// @Accept       json
// @Produce      json
// @Param        id   path     int                   true "角色 ID"
// @Param        body body     SetPermissionsRequest  true "权限列表"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      401 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/roles/{id}/permissions [put]
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

	var req SetPermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	for _, slug := range req.Permissions {
		var cnt int64
		if err := h.DB.Model(&model.Permission{}).Where("slug = ?", slug).Count(&cnt).Error; err != nil {
			h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
			return
		}
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
			if err := tx.Exec("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", roleID, perm.ID).Error; err != nil {
				return err
			}
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

// HandleListPermissions returns all permissions (internal, called by HandleListPermissionsRoute).
func (h *Handler) HandleListPermissions(w http.ResponseWriter, r *http.Request) {
	var items []PermissionItem
	if err := h.DB.Model(&model.Permission{}).Order("slug").Find(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if items == nil {
		items = []PermissionItem{}
	}
	h.jsonOK(w, items)
}

// HandleListPermissionsRoute godoc
// @Summary      获取所有权限
// @ID           AdminListPermissions
// @Description  返回所有可分配的权限列表（仅需有效会话）
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Success      200 {array}  PermissionItem
// @Failure      401 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/permissions [get]
func (h *Handler) HandleListPermissionsRoute(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.Auth.ParseSession(r); !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	h.HandleListPermissions(w, r)
}

// HandleGetUserRoles godoc
// @Summary      获取用户角色
// @ID           AdminGetUserRoles
// @Description  返回指定用户的角色名称列表
// @Tags         admin
// @Security     AdminSessionCookie
// @Produce      json
// @Param        id path int true "用户 ID"
// @Success      200 {array}  string
// @Failure      400 {object} ErrorResponse
// @Failure      401 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Router       /admin/users/{id}/roles [get]
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
