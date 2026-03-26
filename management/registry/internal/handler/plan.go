package handler

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"hive/registry/internal/middleware"
	"hive/registry/internal/model"
	"hive/registry/internal/store"

	"gorm.io/gorm"
)

type CreatePlanRequest struct {
	Name         string `json:"name"`
	TrafficLimit *int64 `json:"traffic_limit"`
	SpeedLimit   *int   `json:"speed_limit"`
	DeviceLimit  *int   `json:"device_limit"`
	DurationDays *int   `json:"duration_days"`
	Price        *int   `json:"price"`
	Enabled      *bool  `json:"enabled"`
	SortOrder    *int   `json:"sort_order"`
}

type UpdatePlanRequest struct {
	Name         *string `json:"name"`
	TrafficLimit *int64  `json:"traffic_limit"`
	SpeedLimit   *int    `json:"speed_limit"`
	DeviceLimit  *int    `json:"device_limit"`
	DurationDays *int    `json:"duration_days"`
	Price        *int    `json:"price"`
	Enabled      *bool   `json:"enabled"`
	SortOrder    *int    `json:"sort_order"`
}

type SetPlanLinesRequest struct {
	Lines []int `json:"lines"`
}

// CreatePlanResponse is the response body for POST /admin/plans.
type CreatePlanResponse struct {
	ID uint `json:"id" example:"1"`
}

// HandleListPlans handles GET /admin/plans
// @Summary      获取套餐列表
// @ID           AdminListPlans
// @Description  返回所有套餐
// @Tags         admin
// @Produce      json
// @Success      200 {array} model.Plan
// @Failure      500 {object} ErrorResponse
// @Router       /admin/plans [get]
func (h *Handler) HandleListPlans(w http.ResponseWriter, r *http.Request) {
	var plans []model.Plan
	if err := h.DB.Order("sort_order, id").Find(&plans).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	h.jsonOK(w, plans)
}

// HandleCreatePlan handles POST /admin/plans
// @Summary      创建套餐
// @ID           AdminCreatePlan
// @Description  创建新的套餐
// @Tags         admin
// @Accept       json
// @Produce      json
// @Param        body body CreatePlanRequest true "套餐信息"
// @Success      200 {object} CreatePlanResponse
// @Failure      400 {object} ErrorResponse
// @Failure      401 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/plans [post]
func (h *Handler) HandleCreatePlan(w http.ResponseWriter, r *http.Request) {
	username, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req CreatePlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" {
		h.jsonErr(w, http.StatusBadRequest, "name required")
		return
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	p := model.Plan{
		Name:      req.Name,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if req.TrafficLimit != nil {
		p.TrafficLimit = *req.TrafficLimit
	}
	if req.SpeedLimit != nil {
		p.SpeedLimit = *req.SpeedLimit
	}
	if req.DeviceLimit != nil {
		p.DeviceLimit = *req.DeviceLimit
	}
	if req.DurationDays != nil {
		p.DurationDays = *req.DurationDays
	}
	if req.Price != nil {
		p.Price = *req.Price
	}
	if req.Enabled != nil {
		p.Enabled = *req.Enabled
	}
	if req.SortOrder != nil {
		p.SortOrder = *req.SortOrder
	}

	if err := h.DB.Create(&p).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	store.WriteAuditLog(h.DB, username, "create_plan", fmt.Sprintf("id=%d name=%s", p.ID, req.Name), getClientIP(r))
	h.jsonOK(w, map[string]any{"id": p.ID})
}

// HandleUpdatePlan handles PATCH /admin/plans/{id}
// @Summary      更新套餐
// @ID           AdminUpdatePlan
// @Description  根据 ID 更新套餐信息
// @Tags         admin
// @Accept       json
// @Produce      json
// @Param        id path int true "套餐 ID"
// @Param        body body UpdatePlanRequest true "更新字段"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      401 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/plans/{id} [patch]
func (h *Handler) HandleUpdatePlan(w http.ResponseWriter, r *http.Request) {
	username, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id := r.PathValue("id")

	var req UpdatePlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	updates := map[string]any{
		"updated_at": time.Now().UTC().Format("2006-01-02 15:04:05"),
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.TrafficLimit != nil {
		updates["traffic_limit"] = *req.TrafficLimit
	}
	if req.SpeedLimit != nil {
		updates["speed_limit"] = *req.SpeedLimit
	}
	if req.DeviceLimit != nil {
		updates["device_limit"] = *req.DeviceLimit
	}
	if req.DurationDays != nil {
		updates["duration_days"] = *req.DurationDays
	}
	if req.Price != nil {
		updates["price"] = *req.Price
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.SortOrder != nil {
		updates["sort_order"] = *req.SortOrder
	}

	var fields []string
	for k := range updates {
		if k != "updated_at" {
			fields = append(fields, k)
		}
	}
	if len(fields) == 0 {
		h.jsonErr(w, http.StatusBadRequest, "no updatable fields")
		return
	}

	result := h.DB.Model(&model.Plan{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "plan not found")
		return
	}

	store.WriteAuditLog(h.DB, username, "update_plan", fmt.Sprintf("id=%s fields=%s", id, strings.Join(fields, ",")), getClientIP(r))
	h.jsonOK(w, map[string]any{"ok": true})
}

// HandleDeletePlan handles DELETE /admin/plans/{id}
// @Summary      删除套餐
// @ID           AdminDeletePlan
// @Description  根据 ID 删除套餐
// @Tags         admin
// @Produce      json
// @Param        id path int true "套餐 ID"
// @Success      200 {object} StatusResponse
// @Failure      401 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/plans/{id} [delete]
func (h *Handler) HandleDeletePlan(w http.ResponseWriter, r *http.Request) {
	username, _, ok := h.Auth.ParseSession(r)
	if !ok {
		h.jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id := r.PathValue("id")

	result := h.DB.Where("id = ?", id).Delete(&model.Plan{})
	if result.Error != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		h.jsonErr(w, http.StatusNotFound, "plan not found")
		return
	}

	store.WriteAuditLog(h.DB, username, "delete_plan", fmt.Sprintf("id=%s", id), getClientIP(r))
	h.jsonOK(w, map[string]any{"ok": true})
}

// HandleGetPlanLines handles GET /admin/plans/{id}/lines
// @Summary      获取套餐线路
// @ID           AdminGetPlanLines
// @Description  返回套餐关联的线路 ID 列表
// @Tags         admin
// @Produce      json
// @Param        id path int true "套餐 ID"
// @Success      200 {array} int
// @Failure      500 {object} ErrorResponse
// @Router       /admin/plans/{id}/lines [get]
func (h *Handler) HandleGetPlanLines(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var lineIDs []int
	h.DB.Model(&model.PlanLine{}).Where("plan_id = ?", id).Pluck("line_id", &lineIDs)
	h.jsonOK(w, lineIDs)
}

// HandleSetPlanLines handles PUT /admin/plans/{id}/lines
// @Summary      设置套餐线路
// @ID           AdminSetPlanLines
// @Description  替换套餐关联的线路列表
// @Tags         admin
// @Accept       json
// @Produce      json
// @Param        id path int true "套餐 ID"
// @Param        body body SetPlanLinesRequest true "线路 ID 列表"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} ErrorResponse
// @Failure      404 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /admin/plans/{id}/lines [put]
func (h *Handler) HandleSetPlanLines(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req SetPlanLinesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	var plan model.Plan
	if err := h.DB.Where("id = ?", id).First(&plan).Error; err == gorm.ErrRecordNotFound {
		h.jsonErr(w, http.StatusNotFound, "plan not found")
		return
	}

	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("plan_id = ?", id).Delete(&model.PlanLine{}).Error; err != nil {
			return err
		}
		for _, lid := range req.Lines {
			if err := tx.Create(&model.PlanLine{PlanID: plan.ID, LineID: uint(lid)}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "plan_set_lines",
		fmt.Sprintf("plan_id=%d count=%d", plan.ID, len(req.Lines)), getClientIP(r))
	h.jsonOK(w, map[string]string{"status": "ok"})
}

// queryPlanNodes resolves a customer subscription token to a plan name and its nodes.
// Also returns subscription metadata for traffic/expiry checks.
func (h *Handler) queryPlanNodes(token string) (planName string, nodes []model.Node, sub struct {
	ID           uint
	Status       string
	TrafficUsed  int64
	TrafficLimit int64
	ExpiresAt    string
}, err error) {
	var row struct {
		ID           uint
		CustomerID   uint
		PlanID       uint
		Status       string
		TrafficUsed  int64
		TrafficLimit int64
		ExpiresAt    time.Time
	}
	h.DB.Raw("SELECT id, customer_id, plan_id, status, traffic_used, traffic_limit, expires_at "+
		"FROM customer_subscriptions WHERE token=?", token).Scan(&row)
	if row.ID == 0 {
		return "", nil, sub, fmt.Errorf("subscription not found")
	}
	sub.ID = row.ID
	sub.Status = row.Status
	sub.TrafficUsed = row.TrafficUsed
	sub.TrafficLimit = row.TrafficLimit
	sub.ExpiresAt = row.ExpiresAt.UTC().Format("2006-01-02 15:04:05")

	var custStatus string
	h.DB.Raw("SELECT status FROM customers WHERE id=?", row.CustomerID).Scan(&custStatus)
	if custStatus != "active" {
		return "", nil, sub, fmt.Errorf("customer not active")
	}

	h.DB.Raw("SELECT name FROM plans WHERE id=?", row.PlanID).Scan(&planName)

	var macs []string
	h.DB.Raw("SELECT DISTINCT ln.node_mac FROM plan_lines pl "+
		"JOIN line_nodes ln ON ln.line_id = pl.line_id "+
		"JOIN `lines` l ON l.id = pl.line_id AND l.enabled = 1 "+
		"WHERE pl.plan_id = ?", row.PlanID).Scan(&macs)

	nodes, err = h.queryNodesByMACs(macs)
	return planName, nodes, sub, err
}

// HandleCustomerSubscriptionClash handles GET /c/{token}
// @Summary      获取客户 Clash 订阅
// @ID           CustomerSubscriptionClash
// @Description  根据订阅 token 返回 Clash/Mihomo YAML 格式配置 (text/plain)
// @Tags         subscription
// @Produce      plain
// @Param        token path string true "订阅 token"
// @Success      200 {string} string "Clash subscription"
// @Failure      404 {string} string "Not Found"
// @Router       /c/{token} [get]
func (h *Handler) HandleCustomerSubscriptionClash(w http.ResponseWriter, r *http.Request) {
	middleware.SubscriptionRequestsTotal.WithLabelValues("customer_clash").Inc()

	token := r.PathValue("token")
	if len(token) != 64 {
		http.NotFound(w, r)
		return
	}

	planName, nodes, sub, err := h.queryPlanNodes(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if ok, reason := checkSubscriptionValid(sub.Status, sub.TrafficUsed, sub.TrafficLimit, sub.ExpiresAt); !ok {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "# %s\nproxies: []\n", reason)
		return
	}

	yaml := h.buildGroupClashYAML(planName, nodes)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="hive-%s.yaml"`, planName))
	fmt.Fprint(w, yaml)
}

// HandleCustomerSubscriptionVless handles GET /c/{token}/vless
// @Summary      获取客户 VLESS 订阅
// @ID           CustomerSubscriptionVless
// @Description  根据订阅 token 返回 base64 编码的 VLESS 订阅链接 (text/plain)
// @Tags         subscription
// @Produce      plain
// @Param        token path string true "订阅 token"
// @Success      200 {string} string "VLESS subscription"
// @Failure      404 {string} string "Not Found"
// @Router       /c/{token}/vless [get]
func (h *Handler) HandleCustomerSubscriptionVless(w http.ResponseWriter, r *http.Request) {
	middleware.SubscriptionRequestsTotal.WithLabelValues("customer_vless").Inc()

	token := r.PathValue("token")
	if len(token) != 64 {
		http.NotFound(w, r)
		return
	}

	planName, nodes, sub, err := h.queryPlanNodes(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if ok, reason := checkSubscriptionValid(sub.Status, sub.TrafficUsed, sub.TrafficLimit, sub.ExpiresAt); !ok {
		content := base64.StdEncoding.EncodeToString([]byte("# " + reason))
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, content)
		return
	}

	var links []string
	for _, n := range nodes {
		host := stripScheme(n.CFURL)
		if host == "" || n.XrayUUID == "" {
			continue
		}
		name := buildNodeName(n)
		params := url.Values{}
		params.Set("type", "ws")
		params.Set("security", "tls")
		params.Set("sni", host)
		params.Set("path", fmt.Sprintf("/%s?ed=2560", h.Config.XrayPath))
		link := fmt.Sprintf("vless://%s@%s:443?%s#%s",
			n.XrayUUID, host, params.Encode(), url.PathEscape(name))
		links = append(links, link)
	}

	content := base64.StdEncoding.EncodeToString([]byte(strings.Join(links, "\n")))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="hive-%s.txt"`, planName))
	fmt.Fprint(w, content)
}
