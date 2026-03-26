package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── request/response types ────────────────────────────────────────────────────

type AnnouncementListResponse struct {
	Total int64                `json:"total"`
	Items []model.Announcement `json:"items"`
}

type AnnouncementRequest struct {
	Title     string `json:"title"`
	Content   string `json:"content"`
	Level     string `json:"level"`
	Pinned    *bool  `json:"pinned"`
	Published *bool  `json:"published"`
}

// ── admin handlers ────────────────────────────────────────────────────────────

// GET /admin/announcements
func (h *Handler) HandleListAnnouncements(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	query := h.DB.Table("announcements")

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	items := make([]model.Announcement, 0)
	if err := query.Order("pinned DESC, created_at DESC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, AnnouncementListResponse{Total: total, Items: items})
}

// POST /admin/announcements
func (h *Handler) HandleCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	var req AnnouncementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Title == "" {
		h.jsonErr(w, http.StatusBadRequest, "title is required")
		return
	}
	if req.Level == "" {
		req.Level = "info"
	}
	if req.Level != "info" && req.Level != "warning" && req.Level != "critical" {
		h.jsonErr(w, http.StatusBadRequest, "level must be info, warning, or critical")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	ann := model.Announcement{
		Title:     req.Title,
		Content:   req.Content,
		Level:     req.Level,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if req.Pinned != nil {
		ann.Pinned = *req.Pinned
	}
	if req.Published != nil {
		ann.Published = *req.Published
	}

	if err := h.DB.Create(&ann).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "announcement_create", "id:"+strconv.FormatUint(uint64(ann.ID), 10)+" title:"+req.Title, getClientIP(r))
	h.jsonOK(w, ann)
}

// PATCH /admin/announcements/{id}
func (h *Handler) HandleUpdateAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var ann model.Announcement
	if err := h.DB.First(&ann, id).Error; err != nil {
		h.jsonErr(w, http.StatusNotFound, "announcement not found")
		return
	}

	var req AnnouncementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	updates := map[string]any{
		"updated_at": time.Now().UTC().Format("2006-01-02 15:04:05"),
	}
	if req.Title != "" {
		updates["title"] = req.Title
	}
	if req.Content != "" {
		updates["content"] = req.Content
	}
	if req.Level != "" {
		if req.Level != "info" && req.Level != "warning" && req.Level != "critical" {
			h.jsonErr(w, http.StatusBadRequest, "level must be info, warning, or critical")
			return
		}
		updates["level"] = req.Level
	}
	if req.Pinned != nil {
		updates["pinned"] = *req.Pinned
	}
	if req.Published != nil {
		updates["published"] = *req.Published
	}

	if err := h.DB.Model(&ann).Updates(updates).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "announcement_update", "id:"+id, getClientIP(r))

	h.DB.First(&ann, id)
	h.jsonOK(w, ann)
}

// DELETE /admin/announcements/{id}
func (h *Handler) HandleDeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	res := h.DB.Delete(&model.Announcement{}, id)
	if res.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+res.Error.Error())
		return
	}
	if res.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "announcement not found")
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "announcement_delete", "id:"+id, getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// ── portal handler ────────────────────────────────────────────────────────────

// GET /portal/announcements
func (h *Handler) HandlePortalAnnouncements(w http.ResponseWriter, r *http.Request) {
	items := make([]model.Announcement, 0)
	if err := h.DB.Where("published = ?", true).
		Order("pinned DESC, created_at DESC").
		Limit(20).
		Find(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, items)
}
