package handler

import (
	"net/http"
	"strconv"
	"time"

	"hive/registry/internal/model"
)

// ── response types ────────────────────────────────────────────────────────────

type RiskEventListResponse struct {
	Total int64             `json:"total"`
	Items []model.RiskEvent `json:"items"`
}

// ── handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) HandleListRiskEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	customerID := q.Get("customer_id")
	eventType := q.Get("event_type")
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	query := h.DB.Table("risk_events")
	if customerID != "" {
		query = query.Where("customer_id = ?", customerID)
	}
	if eventType != "" {
		query = query.Where("event_type = ?", eventType)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	events := make([]model.RiskEvent, 0)
	if err := query.Select("id, customer_id, event_type, detail, ip, created_at").
		Order("id DESC").Limit(limit).Offset(offset).
		Scan(&events).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, RiskEventListResponse{Total: total, Items: events})
}

func (h *Handler) writeRiskEvent(customerID *uint, eventType, detail, ip string) {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if customerID != nil {
		h.DB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (?,?,?,?,?)",
			*customerID, eventType, detail, ip, now)
	} else {
		h.DB.Exec("INSERT INTO risk_events (customer_id, event_type, detail, ip, created_at) VALUES (NULL,?,?,?,?)",
			eventType, detail, ip, now)
	}
}
