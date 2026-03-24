package main

import (
	"log"
	"net/http"
	"os"
)

// Node 是所有接口通用的节点数据结构。
// 与数据库列一一对应，JSON tag 为接口规范。
type Node struct {
	MAC          string `json:"mac"`
	MAC6         string `json:"mac6"`
	Hostname     string `json:"hostname"`
	CFURL        string `json:"cf_url"`
	TunnelID     string `json:"tunnel_id"`
	TailscaleIP  string `json:"tailscale_ip"`
	EasytierIP   string `json:"easytier_ip"`
	FRPPort      int    `json:"frp_port"`
	XrayUUID     string `json:"xray_uuid"`
	Location     string `json:"location"`
	Note         string `json:"note"`
	RegisteredAt string `json:"registered_at"`
	LastSeen     string `json:"last_seen"`
}

// SELECT 列顺序，与 scanNode / scanNodeRow 的 Scan 参数严格对应
const nodeCols = "mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, easytier_ip, frp_port, xray_uuid, location, note, registered_at, last_seen"

var xrayPath = getenv("XRAY_PATH", "ray") // xray path，默认 /ray

func main() {
	initDB()

	mux := http.NewServeMux()

	// ── 节点注册（设备端调用，Bearer token 认证）──────────────────────────
	mux.HandleFunc("POST /nodes/register", handleRegister)

	// ── 节点查询 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /nodes", requirePerm("node:read")(handleListNodes))
	mux.HandleFunc("GET /nodes/{mac}", requirePerm("node:read")(handleGetNode))

	// ── 节点管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("PATCH /nodes/{mac}", requirePerm("node:write")(handleUpdateNode))
	mux.HandleFunc("DELETE /nodes/{mac}", requirePerm("node:delete")(handleDeleteNode))

	// ── 管理端登录（Cookie 会话）────────────────────────────────────────────
	mux.HandleFunc("POST /admin/login", handleAdminLogin)
	mux.HandleFunc("POST /admin/logout", handleAdminLogout)

	// ── 当前用户信息（任意已登录用户）──────────────────────────────────────
	mux.HandleFunc("GET /admin/me", handleAdminMe)

	// ── 用户管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/users", requirePerm("user:read")(handleListUsers))
	mux.HandleFunc("POST /admin/users", requirePerm("user:write")(handleCreateUser))
	mux.HandleFunc("DELETE /admin/users/{id}", requirePerm("user:delete")(handleDeleteUser))

	// ── 密码修改（user:write 或本人，handler 内部鉴权）──────────────────────
	mux.HandleFunc("POST /admin/users/{id}/password", handleChangePasswordRoute)

	// ── 用户角色管理 ──────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/users/{id}/roles", requirePerm("user:read")(handleGetUserRoles))
	mux.HandleFunc("PUT /admin/users/{id}/roles", requirePerm("user:write")(handleSetUserRoles))

	// ── 角色管理 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/roles", requirePerm("role:read")(handleListRoles))
	mux.HandleFunc("PUT /admin/roles/{id}/permissions", requirePerm("role:write")(handleSetRolePermissions))

	// ── 权限列表（任意已登录用户）──────────────────────────────────────────
	mux.HandleFunc("GET /admin/permissions", handleListPermissionsRoute)

	// ── 审计日志 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/audit-logs", requirePerm("audit:read")(handleListAuditLogs))

	// ── 订阅（requireAuth：session cookie 或 ?token=API_SECRET）────────────
	mux.HandleFunc("GET /subscription", handleSubscriptionVless)
	mux.HandleFunc("GET /subscription/clash", handleSubscriptionClash)

	// ── 公开订阅分组（无需认证）────────────────────────────────────────────
	mux.HandleFunc("GET /s/{token}", handlePublicGroupClash)

	// ── 订阅分组管理 ──────────────────────────────────────────────────────
	mux.HandleFunc("GET /admin/subscription-groups", requirePerm("subscription:read")(handleListGroups))
	mux.HandleFunc("POST /admin/subscription-groups", requirePerm("subscription:write")(handleCreateGroup))
	mux.HandleFunc("DELETE /admin/subscription-groups/{id}", requirePerm("subscription:write")(handleDeleteGroup))
	mux.HandleFunc("GET /admin/subscription-groups/{id}/nodes", requirePerm("subscription:read")(handleGetGroupNodes))
	mux.HandleFunc("PUT /admin/subscription-groups/{id}/nodes", requirePerm("subscription:write")(handleSetGroupNodes))
	mux.HandleFunc("POST /admin/subscription-groups/{id}/reset-token", requirePerm("subscription:write")(handleResetGroupToken))

	// ── 运维接口 ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /prometheus-targets", requirePerm("prometheus:read")(handlePrometheusTargets))
	mux.HandleFunc("GET /labels", requirePerm("label:read")(handleLabels))
	mux.HandleFunc("GET /health", handleHealth)

	// ── 控制台 Dashboard ─────────────────────────────────────────────────
	mux.HandleFunc("GET /", handleIndex)

	addr := getenv("LISTEN_ADDR", ":8080")
	log.Printf("hive-registry listening on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

// handleChangePasswordRoute 允许本人或拥有 user:write 权限的用户修改密码。
func handleChangePasswordRoute(w http.ResponseWriter, r *http.Request) {
	username, _, ok := parseSession(r)
	if !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	_ = username
	handleChangePassword(w, r)
}

// handleListPermissionsRoute 要求已登录（任意角色）。
func handleListPermissionsRoute(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := parseSession(r); !ok {
		jsonErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	handleListPermissions(w, r)
}

// getenv 返回环境变量值，未设置时返回默认值
func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
