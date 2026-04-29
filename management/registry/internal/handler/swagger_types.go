package handler

import "hive/registry/internal/model"

// StatusResponse is a generic success response.
type StatusResponse struct {
	Status string `json:"status" example:"ok"`
}

// ErrorResponse is a generic error response.
type ErrorResponse struct {
	Error string `json:"error" example:"error message"`
}

// AdminLoginRequest is the request body for POST /admin/login.
type AdminLoginRequest struct {
	Username string `json:"username" example:"admin"`
	Password string `json:"password" example:"secret"`
}

// AdminLoginResponse is the response body for POST /admin/login.
// Alias of StatusResponse; kept for clarity in swagger docs.
type AdminLoginResponse = StatusResponse

// MeResponse is the response body for GET /admin/me.
type MeResponse struct {
	ID          uint     `json:"id" example:"1"`
	Username    string   `json:"username" example:"admin"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
}

// UserWithRoles is the response item for GET /admin/users.
type UserWithRoles struct {
	ID        uint     `json:"id" example:"1"`
	Username  string   `json:"username" example:"admin"`
	Roles     []string `json:"roles"`
	CreatedAt string   `json:"created_at" example:"2024-01-01 00:00:00"`
	UpdatedAt string   `json:"updated_at" example:"2024-01-01 00:00:00"`
}

// CreateUserRequest is the request body for POST /admin/users.
type CreateUserRequest struct {
	Username string `json:"username" example:"newuser"`
	Password string `json:"password" example:"secret"`
	Role     string `json:"role" example:"viewer"`
}

// ChangePasswordRequest is the request body for POST /admin/users/{id}/password.
type ChangePasswordRequest struct {
	Password string `json:"password" example:"newpassword"`
}

// SetRolesRequest is the request body for PUT /admin/users/{id}/roles.
type SetRolesRequest struct {
	Roles []string `json:"roles"`
}

// NodeRegisterRequest is the request body for POST /nodes/register.
type NodeRegisterRequest struct {
	MAC          string `json:"mac" example:"AA:BB:CC:DD:EE:FF"`
	MAC6         string `json:"mac6" example:"AABBCC"`
	Hostname     string `json:"hostname" example:"node-01"`
	CFURL        string `json:"cf_url" example:"https://tunnel.example.com"`
	TunnelID     string `json:"tunnel_id" example:"abc123"`
	XrayUUID     string `json:"xray_uuid" example:"550e8400-e29b-41d4-a716-446655440000"`
	MeshTunnelID string `json:"mesh_tunnel_id" example:"704320e0-f87b-4ca8-a45e-481c1fcd7462"`
	MeshIP       string `json:"mesh_ip" example:"100.96.0.10"`
}

// NodeRegisterResponse is the response body for POST /nodes/register.
type NodeRegisterResponse struct {
	Status       string `json:"status" example:"registered"`
	Hostname     string `json:"hostname" example:"node-01"`
	RegisteredAt string `json:"registered_at" example:"2025-01-01 00:00:00"`
}

// NodeUpdateRequest is the request body for PATCH /nodes/{mac}.
type NodeUpdateRequest struct {
	Location      *string `json:"location,omitempty" example:"Tokyo"`
	Note          *string `json:"note,omitempty" example:"primary node"`
	TailscaleIP   *string `json:"tailscale_ip,omitempty" example:"100.64.0.1"`
	EasytierIP    *string `json:"easytier_ip,omitempty" example:"10.0.0.1"`
	FRPPort       *int    `json:"frp_port,omitempty" example:"7000"`
	Enabled       *bool   `json:"enabled,omitempty" example:"true"`
	Status        *string `json:"status,omitempty" example:"online"`
	Weight        *int    `json:"weight,omitempty" example:"10"`
	Region       *string `json:"region,omitempty" example:"asia"`
	MeshTunnelID *string `json:"mesh_tunnel_id,omitempty" example:"704320e0-f87b-4ca8-a45e-481c1fcd7462"`
	MeshIP        *string `json:"mesh_ip,omitempty" example:"100.96.0.10"`
}

// ── customer swagger types ───────────────────────────────────────────────────

// CustomerListResponse is the paginated response for GET /admin/customers.
type CustomerListResponse struct {
	Items []model.Customer `json:"items"`
	Total int64            `json:"total" example:"42"`
	Page  int              `json:"page" example:"1"`
	Limit int              `json:"limit" example:"20"`
}

// CreateIDResponse is a generic response containing a created resource ID.
type CreateIDResponse struct {
	ID uint `json:"id" example:"1"`
}

// CreateSubscriptionResponse is the response for POST /admin/customers/{id}/subscriptions.
type CreateSubscriptionResponse struct {
	ID    uint   `json:"id" example:"1"`
	Token string `json:"token" example:"abc123"`
}

// ResetSubscriptionTokenResponse is the response for POST /admin/subscriptions/{id}/reset-token.
type ResetSubscriptionTokenResponse struct {
	Token string `json:"token" example:"abc123"`
}
