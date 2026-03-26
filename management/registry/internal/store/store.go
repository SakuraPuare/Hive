package store

import (
	"fmt"
	"log"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"hive/registry/internal/config"
)

// AllPermissions is the full list of system-defined permissions, seeded into the permissions table on startup.
var AllPermissions = []struct{ Slug, Desc string }{
	{"node:read", "查看节点列表和详情"},
	{"node:write", "编辑节点（location/note/tailscale_ip）"},
	{"node:delete", "删除节点"},
	{"user:read", "查看用户列表"},
	{"user:write", "创建用户、修改密码、分配角色"},
	{"user:delete", "删除用户"},
	{"audit:read", "查看审计日志"},
	{"subscription:read", "查看 VLESS/Clash 订阅"},
	{"subscription:write", "创建/编辑/删除订阅分组"},
	{"label:read", "打印标签页"},
	{"prometheus:read", "Prometheus targets"},
	{"role:read", "查看角色及其权限"},
	{"role:write", "修改角色的权限集合"},
	{"line:read", "查看线路列表"},
	{"line:write", "创建/编辑/删除线路"},
	{"plan:read", "查看套餐列表"},
	{"plan:write", "创建/编辑/删除套餐"},
	{"customer:read", "查看客户列表和详情"},
	{"customer:write", "创建/编辑客户、管理订阅"},
	{"customer:delete", "删除客户和订阅"},
	{"order:read", "查看订单和优惠码"},
	{"order:write", "管理订单状态和优惠码"},
	{"ticket:read", "查看工单列表"},
	{"ticket:write", "回复/关闭/删除工单"},
	{"announcement:read", "查看公告列表"},
	{"announcement:write", "创建/编辑/删除公告"},
}

// DefaultRolePerms defines the default permission sets for the three built-in roles.
var DefaultRolePerms = map[string][]string{
	"superadmin": {
		"node:read", "node:write", "node:delete",
		"user:read", "user:write", "user:delete",
		"audit:read", "subscription:read", "subscription:write", "label:read", "prometheus:read",
		"role:read", "role:write",
		"line:read", "line:write",
		"plan:read", "plan:write",
		"customer:read", "customer:write", "customer:delete",
		"order:read", "order:write",
		"ticket:read", "ticket:write",
		"announcement:read", "announcement:write",
	},
	"admin": {
		"node:read", "node:write",
		"subscription:read", "label:read", "prometheus:read",
	},
	"viewer": {
		"node:read", "subscription:read",
	},
}

// Init opens a GORM DB connection using the provided config, configures the pool, pings, and returns the DB.
func Init(cfg *config.Config) *gorm.DB {
	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&collation=utf8mb4_unicode_ci&time_zone=%%27%%2B00%%3A00%%27&timeout=10s&readTimeout=30s&writeTimeout=30s&parseTime=true",
		cfg.MySQLUser, cfg.MySQLPassword, cfg.MySQLHost, cfg.MySQLPort, cfg.MySQLDB,
	)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("db.Open: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("db.DB(): %v", err)
	}
	sqlDB.SetMaxOpenConns(cfg.DBMaxOpen)
	sqlDB.SetMaxIdleConns(cfg.DBMaxIdle)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	sqlDB.SetConnMaxIdleTime(2 * time.Minute)

	if err = sqlDB.Ping(); err != nil {
		log.Fatalf("db.Ping: %v", err)
	}
	log.Printf("MySQL connected: %s:%s/%s (maxOpen=%d maxIdle=%d)",
		cfg.MySQLHost, cfg.MySQLPort, cfg.MySQLDB, cfg.DBMaxOpen, cfg.DBMaxIdle)

	return db
}

// BootstrapSuperadmin creates an initial superadmin user if the users table is empty and adminPass is set.
func BootstrapSuperadmin(db *gorm.DB, adminUser, adminPass string) {
	var count int64
	if err := db.Raw("SELECT COUNT(*) FROM users").Scan(&count).Error; err != nil {
		log.Fatalf("BootstrapSuperadmin count: %v", err)
	}
	if count > 0 {
		return
	}
	if adminPass == "" {
		log.Println("BootstrapSuperadmin: ADMIN_PASS is empty, skipping (set ADMIN_USER + ADMIN_PASS to create initial superadmin)")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(adminPass), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("BootstrapSuperadmin bcrypt: %v", err)
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := db.Exec(
		"INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'superadmin', ?, ?)",
		adminUser, string(hash), now, now,
	).Error; err != nil {
		log.Fatalf("BootstrapSuperadmin insert: %v", err)
	}
	log.Printf("bootstrapped superadmin: %s", adminUser)
}

// BootstrapRBAC idempotently seeds permissions, roles, and role_permissions,
// and migrates existing users.role values into the user_roles table.
func BootstrapRBAC(db *gorm.DB) {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// 1. Seed permissions
	for _, p := range AllPermissions {
		db.Exec("INSERT IGNORE INTO permissions (slug, description) VALUES (?, ?)", p.Slug, p.Desc)
	}

	// 2. Seed roles
	for roleName := range DefaultRolePerms {
		db.Exec("INSERT IGNORE INTO roles (name, description, created_at) VALUES (?, ?, ?)",
			roleName, "", now)
	}

	// 3. Seed role_permissions
	for roleName, perms := range DefaultRolePerms {
		var roleID uint
		db.Raw("SELECT id FROM roles WHERE name = ?", roleName).Scan(&roleID)
		if roleID == 0 {
			continue
		}
		for _, slug := range perms {
			var permID uint
			db.Raw("SELECT id FROM permissions WHERE slug = ?", slug).Scan(&permID)
			if permID == 0 {
				continue
			}
			db.Exec("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", roleID, permID)
		}
	}

	// 4. Migrate existing users.role → user_roles
	type userRow struct {
		ID   uint
		Role string
	}
	var users []userRow
	db.Raw("SELECT id, role FROM users").Scan(&users)
	for _, u := range users {
		var roleID uint
		db.Raw("SELECT id FROM roles WHERE name = ?", u.Role).Scan(&roleID)
		if roleID > 0 {
			db.Exec("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", u.ID, roleID)
		}
	}

	log.Println("RBAC bootstrapped")
}

// WriteAuditLog inserts a record into the audit_logs table.
func WriteAuditLog(db *gorm.DB, username, action, detail, ip string) {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	if err := db.Exec(
		"INSERT INTO audit_logs (username, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)",
		username, action, detail, ip, now,
	).Error; err != nil {
		log.Printf("WriteAuditLog: %v", err)
	}
}

// GetUserPermissions returns all permission slugs for a user (role perms ∪ direct user perms).
func GetUserPermissions(db *gorm.DB, uid uint) []string {
	var perms []string
	db.Raw(`
		SELECT DISTINCT p.slug
		FROM permissions p
		LEFT JOIN role_permissions rp ON rp.permission_id = p.id
		LEFT JOIN user_roles ur ON ur.role_id = rp.role_id AND ur.user_id = ?
		LEFT JOIN user_permissions up ON up.permission_id = p.id AND up.user_id = ?
		WHERE ur.user_id IS NOT NULL OR up.user_id IS NOT NULL
		ORDER BY p.slug
	`, uid, uid).Scan(&perms)
	return perms
}
