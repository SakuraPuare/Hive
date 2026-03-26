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

type TicketListResponse struct {
	Total int64          `json:"total"`
	Items []model.Ticket `json:"items"`
}

type TicketDetailResponse struct {
	Ticket  model.Ticket        `json:"ticket"`
	Replies []model.TicketReply `json:"replies"`
}

type TicketReplyRequest struct {
	Content string `json:"content"`
}

// ticketReplyRow is used for scanning is_admin as int from DB.
type ticketReplyRow struct {
	ID        uint   `json:"id"`
	TicketID  uint   `json:"ticket_id"`
	Author    string `json:"author"`
	IsAdmin   int    `json:"is_admin"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

// ── handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) HandleListTickets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := q.Get("status")
	customerID := q.Get("customer_id")
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	query := h.DB.Table("tickets t").Joins("LEFT JOIN customers c ON c.id = t.customer_id")
	if status != "" {
		query = query.Where("t.status = ?", status)
	}
	if customerID != "" {
		query = query.Where("t.customer_id = ?", customerID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	tickets := make([]model.Ticket, 0)
	if err := query.Select("t.id, t.customer_id, COALESCE(c.email,'') AS customer_email, t.subject, t.status, t.created_at, t.updated_at").
		Limit(limit).Offset(offset).Order("t.id DESC").Scan(&tickets).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, TicketListResponse{Total: total, Items: tickets})
}

func (h *Handler) HandleGetTicket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var t model.Ticket
	if err := h.DB.Raw(
		"SELECT t.id, t.customer_id, COALESCE(c.email,'') AS customer_email, t.subject, t.status, t.created_at, t.updated_at "+
			"FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.id = ?", id).Scan(&t).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if t.ID == 0 {
		h.jsonErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	var rows []ticketReplyRow
	if err := h.DB.Raw(
		"SELECT id, ticket_id, author, is_admin, content, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY id ASC", id).
		Scan(&rows).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	replies := make([]model.TicketReply, 0, len(rows))
	for _, row := range rows {
		replies = append(replies, model.TicketReply{
			ID:        row.ID,
			TicketID:  row.TicketID,
			Author:    row.Author,
			IsAdmin:   row.IsAdmin == 1,
			Content:   row.Content,
			CreatedAt: row.CreatedAt,
		})
	}

	h.jsonOK(w, TicketDetailResponse{Ticket: t, Replies: replies})
}

func (h *Handler) HandleAddTicketReply(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req TicketReplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Content == "" {
		h.jsonErr(w, http.StatusBadRequest, "content required")
		return
	}

	actor, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	var ticketID uint
	h.DB.Raw("SELECT id FROM tickets WHERE id = ?", id).Scan(&ticketID)
	if ticketID == 0 {
		h.jsonErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	if err := h.DB.Exec(
		"INSERT INTO ticket_replies (ticket_id, author, is_admin, content, created_at) VALUES (?,?,1,?,?)",
		id, actor, req.Content, now).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.DB.Exec("UPDATE tickets SET status='replied', updated_at=? WHERE id=?", now, id)

	store.WriteAuditLog(h.DB, actor, "ticket_reply", "ticket_id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

func (h *Handler) HandleCloseTicket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var ticketID uint
	h.DB.Raw("SELECT id FROM tickets WHERE id = ?", id).Scan(&ticketID)
	if ticketID == 0 {
		h.jsonErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := h.DB.Exec("UPDATE tickets SET status='closed', updated_at=? WHERE id=?", now, id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "ticket_close", "ticket_id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

func (h *Handler) HandleDeleteTicket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var ticketID uint
	h.DB.Raw("SELECT id FROM tickets WHERE id = ?", id).Scan(&ticketID)
	if ticketID == 0 {
		h.jsonErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	h.DB.Exec("DELETE FROM ticket_replies WHERE ticket_id = ?", id)
	if err := h.DB.Exec("DELETE FROM tickets WHERE id = ?", id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "ticket_delete", "ticket_id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}
