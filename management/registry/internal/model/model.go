package model

// TimeLayout 是项目统一使用的时间格式字符串。
const TimeLayout = "2006-01-02 15:04:05"

// ── Node ─────────────────────────────────────────────────────────────────────

// Node 是所有接口通用的节点数据结构。
type Node struct {
	MAC           string `json:"mac" gorm:"primaryKey;column:mac"`
	MAC6          string `json:"mac6"`
	Hostname      string `json:"hostname"`
	CFURL         string `json:"cf_url"`
	TunnelID      string `json:"tunnel_id"`
	TailscaleIP   string `json:"tailscale_ip"`
	EasytierIP    string `json:"easytier_ip"`
	FRPPort       int    `json:"frp_port"`
	XrayUUID      string `json:"xray_uuid"`
	MeshTunnelID  string `json:"mesh_tunnel_id"`
	MeshIP        string `json:"mesh_ip"`
	Location      string `json:"location"`
	Note          string `json:"note"`
	RegisteredAt  string `json:"registered_at"`
	LastSeen      string `json:"last_seen"`
	Enabled       bool   `json:"enabled"`
	Status        string `json:"status"`
	Weight        int    `json:"weight"`
	Region        string `json:"region"`
	Country       string `json:"country"`
	City          string `json:"city"`
	Tags          string `json:"tags"`
	OfflineReason string `json:"offline_reason"`
	ProbeStatus   string `json:"probe_status"`
}

// NodeCols SELECT 列顺序，用于 LEFT JOIN 查询
const NodeCols = "n.mac, n.mac6, n.hostname, n.cf_url, n.tunnel_id, n.tailscale_ip, n.easytier_ip, n.frp_port, n.xray_uuid, n.mesh_tunnel_id, n.mesh_ip, n.location, n.note, n.registered_at, n.last_seen, n.enabled, n.status, n.weight, n.region, n.country, n.city, n.tags, n.offline_reason, COALESCE(nsc.status, 'unknown') AS probe_status"

// NodeColsPlain 用于不需要 JOIN 的场景
const NodeColsPlain = "mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, easytier_ip, frp_port, xray_uuid, mesh_tunnel_id, mesh_ip, location, note, registered_at, last_seen, enabled, status, weight, region, country, city, tags, offline_reason"

// ── User & Auth ──────────────────────────────────────────────────────────────

type User struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type AuditLog struct {
	ID        uint64 `json:"id"`
	Username  string `json:"username"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	IP        string `json:"ip"`
	CreatedAt string `json:"created_at"`
}

// ── Subscription Group ───────────────────────────────────────────────────────

type SubscriptionGroup struct {
	ID        uint   `json:"id"`
	Name      string `json:"name"`
	Token     string `json:"token"`
	NodeCount int    `json:"node_count"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// ── Plan & Line ──────────────────────────────────────────────────────────────

type Plan struct {
	ID           uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	Name         string `json:"name"`
	TrafficLimit int64  `json:"traffic_limit"`
	SpeedLimit   int    `json:"speed_limit"`
	DeviceLimit  int    `json:"device_limit"`
	DurationDays int    `json:"duration_days"`
	Price        int    `json:"price"`
	Enabled      bool   `json:"enabled"`
	SortOrder    int    `json:"sort_order"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type PlanLine struct {
	PlanID uint `json:"plan_id" gorm:"primaryKey"`
	LineID uint `json:"line_id" gorm:"primaryKey"`
}

type Line struct {
	ID           uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	Name         string `json:"name"`
	Region       string `json:"region"`
	Token        string `json:"token"`
	Enabled      bool   `json:"enabled"`
	DisplayOrder int    `json:"display_order"`
	Note         string `json:"note"`
	NodeCount    int    `json:"node_count" gorm:"-"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type LineNode struct {
	LineID  uint   `json:"line_id" gorm:"primaryKey"`
	NodeMAC string `json:"node_mac" gorm:"primaryKey;column:node_mac"`
}

// ── Customer ─────────────────────────────────────────────────────────────────

type Customer struct {
	ID        uint   `json:"id"`
	Email     string `json:"email"`
	Nickname  string `json:"nickname"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type CustomerSubscription struct {
	ID             uint    `json:"id"`
	CustomerID     uint    `json:"customer_id"`
	PlanID         uint    `json:"plan_id"`
	Token          string  `json:"token"`
	TrafficUsed    int64   `json:"traffic_used"`
	TrafficLimit   int64   `json:"traffic_limit"`
	TrafficResetAt *string `json:"traffic_reset_at"`
	DeviceLimit    int     `json:"device_limit"`
	StartedAt      string  `json:"started_at"`
	ExpiresAt      string  `json:"expires_at"`
	Status         string  `json:"status"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// ── Order & PromoCode ────────────────────────────────────────────────────────

type Order struct {
	ID             uint    `json:"id"`
	OrderNo        string  `json:"order_no"`
	CustomerID     uint    `json:"customer_id"`
	PlanID         uint    `json:"plan_id"`
	Amount         int     `json:"amount"`
	OriginalAmount int     `json:"original_amount"`
	PromoCodeID    *uint   `json:"promo_code_id"`
	Status         string  `json:"status"`
	PaidAt         *string `json:"paid_at"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type PromoCode struct {
	ID          uint   `json:"id"`
	Code        string `json:"code"`
	DiscountPct int    `json:"discount_pct"`
	DiscountAmt int    `json:"discount_amt"`
	MaxUses     int    `json:"max_uses"`
	UsedCount   int    `json:"used_count"`
	ValidFrom   string `json:"valid_from"`
	ValidTo     string `json:"valid_to"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// ── Ticket ───────────────────────────────────────────────────────────────────

type Ticket struct {
	ID            uint   `json:"id"`
	CustomerID    uint   `json:"customer_id"`
	CustomerEmail string `json:"customer_email"`
	Subject       string `json:"subject"`
	Status        string `json:"status"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

type TicketReply struct {
	ID        uint   `json:"id"`
	TicketID  uint   `json:"ticket_id"`
	Author    string `json:"author"`
	IsAdmin   bool   `json:"is_admin"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

// ── Password Reset ──────────────────────────────────────────────────────────

type PasswordResetCode struct {
	ID        uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	Email     string `json:"email"`
	Code      string `json:"code"`
	ExpiresAt string `json:"expires_at"`
	Used      bool   `json:"used"`
}

// ── Risk ─────────────────────────────────────────────────────────────────────

type RiskEvent struct {
	ID         uint   `json:"id"`
	CustomerID *uint  `json:"customer_id"`
	EventType  string `json:"event_type"`
	Detail     string `json:"detail"`
	IP         string `json:"ip"`
	CreatedAt  string `json:"created_at"`
}

// ── RBAC GORM Models ─────────────────────────────────────────────────────────

type NodeStatusCheck struct {
	MAC       string   `json:"mac" gorm:"primaryKey;column:mac"`
	Hostname  string   `json:"hostname" gorm:"column:hostname;->"`
	Location  string   `json:"location" gorm:"column:location;->"`
	Status    string   `json:"status"`
	LatencyMs *int     `json:"latency_ms"`
	CpuPct    *float64 `json:"cpu_pct" gorm:"column:cpu_pct"`
	MemPct    *float64 `json:"mem_pct" gorm:"column:mem_pct"`
	DiskPct   *float64 `json:"disk_pct" gorm:"column:disk_pct"`
	UptimeSec *int64   `json:"uptime_sec"`
	CheckedAt string   `json:"checked_at"`
}

func (NodeStatusCheck) TableName() string { return "node_status_checks" }

type SubscriptionGroupNode struct {
	GroupID uint   `gorm:"primaryKey;column:group_id"`
	NodeMAC string `gorm:"primaryKey;column:node_mac"`
}

func (SubscriptionGroupNode) TableName() string { return "subscription_group_nodes" }

type Permission struct {
	ID          uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
}

type RoleModel struct {
	ID          uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
}

func (RoleModel) TableName() string { return "roles" }

type RolePermission struct {
	RoleID       uint `gorm:"primaryKey;column:role_id"`
	PermissionID uint `gorm:"primaryKey;column:permission_id"`
}

func (RolePermission) TableName() string { return "role_permissions" }

type UserRole struct {
	UserID uint `gorm:"primaryKey;column:user_id"`
	RoleID uint `gorm:"primaryKey;column:role_id"`
}

func (UserRole) TableName() string { return "user_roles" }

type UserPermission struct {
	UserID       uint `gorm:"primaryKey;column:user_id"`
	PermissionID uint `gorm:"primaryKey;column:permission_id"`
}

func (UserPermission) TableName() string { return "user_permissions" }

type SchemaVersion struct {
	Version   int    `gorm:"primaryKey;column:version"`
	AppliedAt string `gorm:"column:applied_at"`
}

func (SchemaVersion) TableName() string { return "schema_migrations" }

// ── Referral ─────────────────────────────────────────────────────────────────

type Referral struct {
	ID         uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	ReferrerID uint   `json:"referrer_id"`
	RefereeID  uint   `json:"referee_id"`
	OrderID    *uint  `json:"order_id"`
	Commission int    `json:"commission"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
}

// ── Announcement ─────────────────────────────────────────────────────────────

type Announcement struct {
	ID        uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Level     string `json:"level"`
	Pinned    bool   `json:"pinned"`
	Published bool   `json:"published"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func (Announcement) TableName() string { return "announcements" }

// ── Heartbeat ────────────────────────────────────────────────────────────────

type HeartbeatRequest struct {
	MAC       string  `json:"mac"`
	CPUPct    float64 `json:"cpu_pct"`
	MemPct    float64 `json:"mem_pct"`
	DiskPct   float64 `json:"disk_pct"`
	UptimeSec int64   `json:"uptime_sec"`
}
