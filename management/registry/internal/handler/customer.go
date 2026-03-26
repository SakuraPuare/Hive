package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// ── request/response types ────────────────────────────────────────────────────

type CreateCustomerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

type UpdateCustomerRequest struct {
	Nickname *string `json:"nickname"`
	Status   *string `json:"status"`
}

type ResetCustomerPasswordRequest struct {
	Password string `json:"password"`
}

type CreateSubscriptionRequest struct {
	PlanID uint `json:"plan_id"`
}

type UpdateSubscriptionRequest struct {
	Status       *string `json:"status"`
	TrafficLimit *int64  `json:"traffic_limit"`
	ExpiresAt    *string `json:"expires_at"`
}

type CustomerDetail struct {
	Customer      model.Customer               `json:"customer"`
	Subscriptions []model.CustomerSubscription `json:"subscriptions"`
}

type SubTraffic struct {
	SubscriptionID uint   `json:"subscription_id" gorm:"column:id"`
	Token          string `json:"token"`
	Status         string `json:"status"`
	TrafficUsed    int64  `json:"traffic_used"`
	TrafficLimit   int64  `json:"traffic_limit"`
	ExpiresAt      string `json:"expires_at"`
	UploadBytes    int64  `json:"upload_bytes"`
	DownloadBytes  int64  `json:"download_bytes"`
}

type CustomerTrafficResponse struct {
	Subscriptions []SubTraffic `json:"subscriptions"`
	TotalUpload   int64        `json:"total_upload"`
	TotalDownload int64        `json:"total_download"`
}

// ── handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) HandleListCustomers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := q.Get("status")
	email := q.Get("email")
	search := q.Get("search")
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	query := h.DB.Table("customers")
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if email != "" {
		query = query.Where("email LIKE ?", "%"+email+"%")
	}
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("email LIKE ? OR nickname LIKE ?", like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	items := make([]model.Customer, 0)
	if err := query.Order("id DESC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, map[string]any{
		"items": items,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

func (h *Handler) HandleCreateCustomer(w http.ResponseWriter, r *http.Request) {
	var req CreateCustomerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Email == "" || req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "email and password required")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	result := h.DB.Exec(
		"INSERT INTO customers (email, password_hash, nickname, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
		req.Email, string(hash), req.Nickname, now, now,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusConflict, "db: "+result.Error.Error())
		return
	}

	var id uint
	h.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&id)
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_create", fmt.Sprintf("id: %d email: %s", id, req.Email), getClientIP(r))

	h.jsonOK(w, map[string]any{"id": id})
}

func (h *Handler) HandleGetCustomer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var c model.Customer
	err := h.DB.Table("customers").Where("id = ?", id).First(&c).Error
	if err == gorm.ErrRecordNotFound {
		h.jsonErr(w, http.StatusNotFound, "customer not found")
		return
	}
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	subs := make([]model.CustomerSubscription, 0)
	if err := h.DB.Table("customer_subscriptions").Where("customer_id = ?", id).Order("id DESC").Find(&subs).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, CustomerDetail{Customer: c, Subscriptions: subs})
}

func (h *Handler) HandleUpdateCustomer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req UpdateCustomerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	updates := map[string]any{"updated_at": time.Now().UTC().Format("2006-01-02 15:04:05")}
	if req.Nickname != nil {
		updates["nickname"] = *req.Nickname
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}

	if err := h.DB.Table("customers").Where("id = ?", id).Updates(updates).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_update", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

func (h *Handler) HandleDeleteCustomer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.DB.Exec("DELETE FROM customers WHERE id = ?", id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_delete", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

func (h *Handler) HandleCreateSubscription(w http.ResponseWriter, r *http.Request) {
	customerID := r.PathValue("id")

	var req CreateSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.PlanID == 0 {
		h.jsonErr(w, http.StatusBadRequest, "plan_id required")
		return
	}

	var plan struct {
		TrafficLimit int64
		DeviceLimit  int
		DurationDays int
	}
	err := h.DB.Raw("SELECT traffic_limit, device_limit, duration_days FROM plans WHERE id = ?", req.PlanID).Scan(&plan).Error
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if plan.DurationDays == 0 && plan.TrafficLimit == 0 && plan.DeviceLimit == 0 {
		h.jsonErr(w, http.StatusBadRequest, "plan not found")
		return
	}

	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "token: "+err.Error())
		return
	}

	now := time.Now().UTC()
	nowStr := now.Format("2006-01-02 15:04:05")
	expiresAt := now.AddDate(0, 0, plan.DurationDays).Format("2006-01-02 15:04:05")

	result := h.DB.Exec(
		"INSERT INTO customer_subscriptions (customer_id, plan_id, token, traffic_used, traffic_limit, device_limit, started_at, expires_at, status, created_at, updated_at) "+
			"VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?)",
		customerID, req.PlanID, token, plan.TrafficLimit, plan.DeviceLimit, nowStr, expiresAt, nowStr, nowStr,
	)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}

	var subID uint
	h.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&subID)
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_subscription_create",
		fmt.Sprintf("id: %d customer_id: %s plan_id: %d", subID, customerID, req.PlanID), getClientIP(r))

	h.jsonOK(w, map[string]any{"id": subID, "token": token})
}

func (h *Handler) HandleGetCustomerTraffic(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var exists int64
	if err := h.DB.Table("customers").Where("id = ?", id).Count(&exists).Error; err != nil || exists == 0 {
		h.jsonErr(w, http.StatusNotFound, "customer not found")
		return
	}

	items := make([]SubTraffic, 0)
	if err := h.DB.Raw(
		"SELECT cs.id, cs.token, cs.status, cs.traffic_used, cs.traffic_limit, cs.expires_at, "+
			"COALESCE(SUM(tl.bytes_up), 0) AS upload_bytes, COALESCE(SUM(tl.bytes_down), 0) AS download_bytes "+
			"FROM customer_subscriptions cs "+
			"LEFT JOIN traffic_logs tl ON tl.subscription_id = cs.id "+
			"WHERE cs.customer_id = ? GROUP BY cs.id ORDER BY cs.id DESC", id,
	).Scan(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	var totalUpload, totalDownload int64
	for _, s := range items {
		totalUpload += s.UploadBytes
		totalDownload += s.DownloadBytes
	}

	h.jsonOK(w, CustomerTrafficResponse{
		Subscriptions: items,
		TotalUpload:   totalUpload,
		TotalDownload: totalDownload,
	})
}

func (h *Handler) HandleResetCustomerPassword(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req ResetCustomerPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Password == "" {
		h.jsonErr(w, http.StatusBadRequest, "password required")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "bcrypt: "+err.Error())
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := h.DB.Exec("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?", string(hash), now, id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_password_reset", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleListSubscriptions lists subscriptions for a customer.
func (h *Handler) HandleListSubscriptions(w http.ResponseWriter, r *http.Request) {
	customerID := r.PathValue("id")

	items := make([]model.CustomerSubscription, 0)
	if err := h.DB.Table("customer_subscriptions").Where("customer_id = ?", customerID).Order("id DESC").Find(&items).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	h.jsonOK(w, items)
}

// HandleUpdateSubscription updates subscription fields.
func (h *Handler) HandleUpdateSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req UpdateSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	updates := map[string]any{"updated_at": time.Now().UTC().Format("2006-01-02 15:04:05")}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.TrafficLimit != nil {
		updates["traffic_limit"] = *req.TrafficLimit
	}
	if req.ExpiresAt != nil {
		updates["expires_at"] = *req.ExpiresAt
	}

	if err := h.DB.Table("customer_subscriptions").Where("id = ?", id).Updates(updates).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_subscription_update", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleDeleteSubscription deletes a subscription by ID.
func (h *Handler) HandleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.DB.Exec("DELETE FROM customer_subscriptions WHERE id = ?", id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_subscription_delete", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]string{"status": "ok"})
}

// HandleResetSubscriptionToken generates a new token for a subscription.
func (h *Handler) HandleResetSubscriptionToken(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "token: "+err.Error())
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := h.DB.Exec("UPDATE customer_subscriptions SET token = ?, updated_at = ? WHERE id = ?", token, now, id).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "customer_subscription_token_reset", "id: "+id, getClientIP(r))

	h.jsonOK(w, map[string]any{"token": token})
}
