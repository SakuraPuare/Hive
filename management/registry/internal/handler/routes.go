package handler

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// RegisterRoutes creates and returns a ServeMux with all routes registered.
func (h *Handler) RegisterRoutes() *http.ServeMux {
	mux := http.NewServeMux()
	perm := h.Auth.RequirePerm

	// ── 节点注册（设备端调用，Bearer token 认证）──────────────────────────
	mux.HandleFunc("POST /nodes/register", h.HandleRegister)
	mux.HandleFunc("POST /nodes/heartbeat", h.HandleHeartbeat)

	// ── 节点查询 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /nodes", perm("node:read")(h.HandleListNodes))
	mux.HandleFunc("GET /nodes/{mac}", perm("node:read")(h.HandleGetNode))

	// ── 节点管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("PATCH /nodes/{mac}", perm("node:write")(h.HandleUpdateNode))
	mux.HandleFunc("DELETE /nodes/{mac}", perm("node:delete")(h.HandleDeleteNode))

	// ── 管理端登录（Cookie 会话）────────────────────────────────────────────
	mux.HandleFunc("POST /admin/login", h.HandleAdminLogin)
	mux.HandleFunc("POST /admin/logout", h.HandleAdminLogout)

	// ── 当前用户信息（任意已登录用户）──────────────────────────────────────
	mux.HandleFunc("GET /admin/me", h.HandleAdminMe)

	// ── 用户管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/users", perm("user:read")(h.HandleListUsers))
	mux.HandleFunc("POST /admin/users", perm("user:write")(h.HandleCreateUser))
	mux.HandleFunc("DELETE /admin/users/{id}", perm("user:delete")(h.HandleDeleteUser))

	// ── 密码修改（user:write 或本人，handler 内部鉴权）──────────────────────
	mux.HandleFunc("POST /admin/users/{id}/password", h.HandleChangePasswordRoute)

	// ── 用户角色管理 ──────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/users/{id}/roles", perm("user:read")(h.HandleGetUserRoles))
	mux.HandleFunc("PUT /admin/users/{id}/roles", perm("user:write")(h.HandleSetUserRoles))

	// ── 角色管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/roles", perm("role:read")(h.HandleListRoles))
	mux.HandleFunc("PUT /admin/roles/{id}/permissions", perm("role:write")(h.HandleUpdateRolePermissions))

	// ── 权限列表（任意已登录用户）──────────────────────────────────────────
	mux.HandleFunc("GET /admin/permissions", h.HandleListPermissionsRoute)

	// ── 审计日志 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/audit-logs", perm("audit:read")(h.HandleListAuditLogs))

	// ── 订阅（管理员 session 认证）──────────────────────────────────────
	mux.HandleFunc("GET /subscription", perm("subscription:read")(h.HandleSubscriptionVless))
	mux.HandleFunc("GET /subscription/clash", perm("subscription:read")(h.HandleSubscriptionClash))

	// ── 公开订阅分组（无需认证）────────────────────────────────────────────
	mux.HandleFunc("GET /s/{token}", h.HandlePublicGroupClash)

	// ── 订阅分组管理 ──────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/subscription-groups", perm("subscription:read")(h.HandleListGroups))
	mux.HandleFunc("POST /admin/subscription-groups", perm("subscription:write")(h.HandleCreateGroup))
	mux.HandleFunc("DELETE /admin/subscription-groups/{id}", perm("subscription:write")(h.HandleDeleteGroup))
	mux.HandleFunc("GET /admin/subscription-groups/{id}/nodes", perm("subscription:read")(h.HandleGetGroupNodes))
	mux.HandleFunc("PUT /admin/subscription-groups/{id}/nodes", perm("subscription:write")(h.HandleSetGroupNodes))
	mux.HandleFunc("POST /admin/subscription-groups/{id}/reset-token", perm("subscription:write")(h.HandleResetGroupToken))

	// ── 线路管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/lines", perm("line:read")(h.HandleListLines))
	mux.HandleFunc("POST /admin/lines", perm("line:write")(h.HandleCreateLine))
	mux.HandleFunc("PATCH /admin/lines/{id}", perm("line:write")(h.HandleUpdateLine))
	mux.HandleFunc("DELETE /admin/lines/{id}", perm("line:write")(h.HandleDeleteLine))
	mux.HandleFunc("GET /admin/lines/{id}/nodes", perm("line:read")(h.HandleGetLineNodes))
	mux.HandleFunc("PUT /admin/lines/{id}/nodes", perm("line:write")(h.HandleSetLineNodes))
	mux.HandleFunc("POST /admin/lines/{id}/reset-token", perm("line:write")(h.HandleResetLineToken))

	// ── 公开线路订阅（无需认证）────────────────────────────────────────────
	mux.HandleFunc("GET /l/{token}", h.HandlePublicLineClash)
	mux.HandleFunc("GET /l/{token}/vless", h.HandlePublicLineVless)

	// ── 套餐管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/plans", perm("plan:read")(h.HandleListPlans))
	mux.HandleFunc("POST /admin/plans", perm("plan:write")(h.HandleCreatePlan))
	mux.HandleFunc("PATCH /admin/plans/{id}", perm("plan:write")(h.HandleUpdatePlan))
	mux.HandleFunc("DELETE /admin/plans/{id}", perm("plan:write")(h.HandleDeletePlan))
	mux.HandleFunc("GET /admin/plans/{id}/lines", perm("plan:read")(h.HandleGetPlanLines))
	mux.HandleFunc("PUT /admin/plans/{id}/lines", perm("plan:write")(h.HandleSetPlanLines))

	// ── 客户订阅（公开，token 认证）─────────────────────────────────────
	mux.HandleFunc("GET /c/{token}", h.HandleCustomerSubscriptionClash)
	mux.HandleFunc("GET /c/{token}/vless", h.HandleCustomerSubscriptionVless)

	// ── 订单管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/orders", perm("order:read")(h.HandleListOrders))
	mux.HandleFunc("PATCH /admin/orders/{id}/status", perm("order:write")(h.HandleUpdateOrderStatus))
	mux.HandleFunc("GET /admin/promo-codes", perm("order:read")(h.HandleListPromoCodes))
	mux.HandleFunc("POST /admin/promo-codes", perm("order:write")(h.HandleCreatePromoCode))
	mux.HandleFunc("PATCH /admin/promo-codes/{id}", perm("order:write")(h.HandleUpdatePromoCode))
	mux.HandleFunc("DELETE /admin/promo-codes/{id}", perm("order:write")(h.HandleDeletePromoCode))

	// ── 客户管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/customers", perm("customer:read")(h.HandleListCustomers))
	mux.HandleFunc("POST /admin/customers", perm("customer:write")(h.HandleCreateCustomer))
	mux.HandleFunc("GET /admin/customers/{id}", perm("customer:read")(h.HandleGetCustomer))
	mux.HandleFunc("PATCH /admin/customers/{id}", perm("customer:write")(h.HandleUpdateCustomer))
	mux.HandleFunc("DELETE /admin/customers/{id}", perm("customer:delete")(h.HandleDeleteCustomer))
	mux.HandleFunc("POST /admin/customers/{id}/password", perm("customer:write")(h.HandleResetCustomerPassword))
	mux.HandleFunc("POST /admin/customers/{id}/subscriptions", perm("customer:write")(h.HandleCreateSubscription))
	mux.HandleFunc("GET /admin/customers/{id}/subscriptions", perm("customer:read")(h.HandleListSubscriptions))
	mux.HandleFunc("GET /admin/customers/{id}/traffic", perm("customer:read")(h.HandleGetCustomerTraffic))
	mux.HandleFunc("PATCH /admin/subscriptions/{id}", perm("customer:write")(h.HandleUpdateSubscription))
	mux.HandleFunc("DELETE /admin/subscriptions/{id}", perm("customer:delete")(h.HandleDeleteSubscription))
	mux.HandleFunc("POST /admin/subscriptions/{id}/reset-token", perm("customer:write")(h.HandleResetSubscriptionToken))

	// ── 工单系统 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/tickets", perm("ticket:read")(h.HandleListTickets))
	mux.HandleFunc("GET /admin/tickets/{id}", perm("ticket:read")(h.HandleGetTicket))
	mux.HandleFunc("POST /admin/tickets/{id}/replies", perm("ticket:write")(h.HandleAddTicketReply))
	mux.HandleFunc("POST /admin/tickets/{id}/close", perm("ticket:write")(h.HandleCloseTicket))
	mux.HandleFunc("DELETE /admin/tickets/{id}", perm("ticket:write")(h.HandleDeleteTicket))

	// ── 风控事件 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/risk-events", perm("customer:read")(h.HandleListRiskEvents))

	// ── 运维接口 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/node-status", perm("node:read")(h.HandleNodeStatus))
	mux.HandleFunc("GET /prometheus-targets", perm("prometheus:read")(h.HandlePrometheusTargets))
	mux.HandleFunc("GET /labels", perm("label:read")(h.HandleLabels))
	mux.HandleFunc("GET /health", h.HandleHealth)
	mux.Handle("GET /metrics", promhttp.Handler())

	// ── 控制台 Dashboard ─────────────────────────────────────────────────
	mux.HandleFunc("GET /", h.HandleRoot)

	return mux
}
