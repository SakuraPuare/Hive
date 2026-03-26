package store

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// Migration describes a single, non-reversible sequential migration step.
// Each migration is executed exactly once and recorded in the schema_migrations table.
type Migration struct {
	version int
	desc    string
	up      string // single SQL; use semicolons to separate multiple statements
}

// Migrations is the full ordered list of migrations, strictly ascending by version.
// Do not modify already-published entries.
var Migrations = []Migration{
	{
		version: 1,
		desc:    "initial schema: users, rbac, audit_logs, nodes, subscription_groups",
		up: `
CREATE TABLE IF NOT EXISTS users (
	id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	username      VARCHAR(64)  NOT NULL UNIQUE COMMENT '用户名',
	password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
	role          ENUM('superadmin','admin','viewer') NOT NULL DEFAULT 'viewer' COMMENT '角色',
	created_at    DATETIME NOT NULL,
	updated_at    DATETIME NOT NULL,
	INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员用户表';

CREATE TABLE IF NOT EXISTS roles (
	id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	name        VARCHAR(64)  NOT NULL UNIQUE COMMENT '角色名，如 superadmin',
	description VARCHAR(256) NOT NULL DEFAULT '',
	created_at  DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

CREATE TABLE IF NOT EXISTS permissions (
	id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	slug        VARCHAR(64)  NOT NULL UNIQUE COMMENT '如 node:read',
	description VARCHAR(256) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限表（系统预定义）';

CREATE TABLE IF NOT EXISTS role_permissions (
	role_id       INT UNSIGNED NOT NULL,
	permission_id INT UNSIGNED NOT NULL,
	PRIMARY KEY (role_id, permission_id),
	FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
	FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色-权限映射';

CREATE TABLE IF NOT EXISTS user_roles (
	user_id INT UNSIGNED NOT NULL,
	role_id INT UNSIGNED NOT NULL,
	PRIMARY KEY (user_id, role_id),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-角色映射（多对多）';

CREATE TABLE IF NOT EXISTS user_permissions (
	user_id       INT UNSIGNED NOT NULL,
	permission_id INT UNSIGNED NOT NULL,
	PRIMARY KEY (user_id, permission_id),
	FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
	FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户直接权限（绕过角色）';

CREATE TABLE IF NOT EXISTS audit_logs (
	id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	username   VARCHAR(64)  NOT NULL COMMENT '操作用户',
	action     VARCHAR(64)  NOT NULL COMMENT 'login_success / login_fail / logout / user_create / user_delete / password_change',
	detail     VARCHAR(256) NOT NULL DEFAULT '',
	ip         VARCHAR(45)  NOT NULL DEFAULT '',
	created_at DATETIME     NOT NULL,
	INDEX idx_audit_username   (username),
	INDEX idx_audit_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作审计日志';

CREATE TABLE IF NOT EXISTS nodes (
	mac           VARCHAR(12)       NOT NULL COMMENT 'MAC 地址（无冒号小写，如 aabbccddeeff）',
	mac6          VARCHAR(6)        NOT NULL COMMENT 'MAC 末6位（设备短 ID）',
	hostname      VARCHAR(64)       NOT NULL,
	cf_url        VARCHAR(256)      NOT NULL COMMENT 'CF Tunnel URL（含 https://）',
	tunnel_id     VARCHAR(64)       NOT NULL DEFAULT '' COMMENT 'Cloudflare Tunnel UUID',
	tailscale_ip  VARCHAR(40)       NOT NULL DEFAULT 'pending' COMMENT 'Tailscale IP，pending 表示尚未接入',
	easytier_ip   VARCHAR(40)       NOT NULL DEFAULT '' COMMENT 'EasyTier mesh IP（10.x.x.x）',
	frp_port      SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'FRP SSH 远程端口',
	xray_uuid     CHAR(36)          NOT NULL COMMENT 'xray VLESS UUID（确定性，基于 MAC）',
	location      VARCHAR(128)      NOT NULL DEFAULT '' COMMENT '管理员标注的地理位置（不随节点重注册覆盖）',
	note          VARCHAR(256)      NOT NULL DEFAULT '' COMMENT '管理员备注（不随节点重注册覆盖）',
	registered_at DATETIME          NOT NULL COMMENT '首次注册时间（不随节点重注册覆盖）',
	last_seen     DATETIME          NOT NULL COMMENT '最近一次注册/心跳时间',
	PRIMARY KEY  (mac),
	INDEX idx_mac6      (mac6),
	INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Hive 边缘节点注册表';

CREATE TABLE IF NOT EXISTS subscription_groups (
	id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	name       VARCHAR(64) NOT NULL COMMENT '分组名称',
	token      CHAR(64)    NOT NULL UNIQUE COMMENT '公开订阅 token（32字节 hex）',
	created_at DATETIME    NOT NULL,
	updated_at DATETIME    NOT NULL,
	INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Clash 订阅分组';

CREATE TABLE IF NOT EXISTS subscription_group_nodes (
	group_id INT UNSIGNED NOT NULL,
	node_mac VARCHAR(12)  NOT NULL,
	PRIMARY KEY (group_id, node_mac),
	FOREIGN KEY (group_id)  REFERENCES subscription_groups(id) ON DELETE CASCADE,
	FOREIGN KEY (node_mac)  REFERENCES nodes(mac)              ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订阅分组-节点映射';
`,
	},
	{
		version: 2,
		desc:    "alter users.role from ENUM to VARCHAR(64) for multi-role support",
		up:      `ALTER TABLE users MODIFY COLUMN role VARCHAR(64) NOT NULL DEFAULT 'viewer' COMMENT '主角色（快捷字段，用于 session cookie）'`,
	},
	{
		version: 3,
		desc:    "add node asset management fields: enabled, status, weight, region, country, city, tags, offline_reason",
		up: `
ALTER TABLE nodes ADD COLUMN enabled        TINYINT(1)        NOT NULL DEFAULT 1    COMMENT '启用/禁用，禁用后订阅不输出';
ALTER TABLE nodes ADD COLUMN status         VARCHAR(32)       NOT NULL DEFAULT 'active' COMMENT '运维状态：active/maintenance/retired';
ALTER TABLE nodes ADD COLUMN weight         SMALLINT UNSIGNED  NOT NULL DEFAULT 100  COMMENT '权重，用于线路编排排序';
ALTER TABLE nodes ADD COLUMN region         VARCHAR(64)       NOT NULL DEFAULT ''   COMMENT '区域，如 Asia、Europe';
ALTER TABLE nodes ADD COLUMN country        VARCHAR(64)       NOT NULL DEFAULT ''   COMMENT '国家代码，如 JP、HK、US';
ALTER TABLE nodes ADD COLUMN city           VARCHAR(64)       NOT NULL DEFAULT ''   COMMENT '城市，如 Tokyo、HongKong';
ALTER TABLE nodes ADD COLUMN tags           VARCHAR(512)      NOT NULL DEFAULT ''   COMMENT '逗号分隔标签，如 residential,premium';
ALTER TABLE nodes ADD COLUMN offline_reason VARCHAR(256)      NOT NULL DEFAULT ''   COMMENT '下线/维护原因';
ALTER TABLE nodes ADD INDEX idx_enabled (enabled);
ALTER TABLE nodes ADD INDEX idx_status  (status);
ALTER TABLE nodes ADD INDEX idx_country (country);
`,
	},
	{
		version: 4,
		desc:    "add lines and line_nodes tables for route management",
		up: "CREATE TABLE IF NOT EXISTS `lines` (\n" +
			"\tid            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,\n" +
			"\tname          VARCHAR(128) NOT NULL COMMENT '线路名称',\n" +
			"\tregion        VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '区域代码，如 JP/HK/SG/US',\n" +
			"\tdisplay_order INT          NOT NULL DEFAULT 0 COMMENT '展示排序，越小越靠前',\n" +
			"\tenabled       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用',\n" +
			"\tnote          VARCHAR(256) NOT NULL DEFAULT '' COMMENT '备注/展示文案',\n" +
			"\ttoken         CHAR(64)     NOT NULL UNIQUE COMMENT '公开订阅 token（32字节 hex）',\n" +
			"\tcreated_at    DATETIME     NOT NULL,\n" +
			"\tupdated_at    DATETIME     NOT NULL,\n" +
			"\tINDEX idx_enabled_order (enabled, display_order),\n" +
			"\tINDEX idx_token (token)\n" +
			") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线路表';\n" +
			"\n" +
			"CREATE TABLE IF NOT EXISTS line_nodes (\n" +
			"\tline_id  INT UNSIGNED NOT NULL,\n" +
			"\tnode_mac VARCHAR(12)  NOT NULL,\n" +
			"\tPRIMARY KEY (line_id, node_mac),\n" +
			"\tFOREIGN KEY (line_id)  REFERENCES `lines`(id) ON DELETE CASCADE,\n" +
			"\tFOREIGN KEY (node_mac) REFERENCES nodes(mac)  ON DELETE CASCADE\n" +
			") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线路-节点映射';",
	},
	{
		version: 5,
		desc:    "add node_status_checks table for Prometheus-based probing",
		up: `
CREATE TABLE IF NOT EXISTS node_status_checks (
	mac         VARCHAR(12) NOT NULL PRIMARY KEY,
	status      ENUM('online','offline','unknown') NOT NULL DEFAULT 'unknown',
	latency_ms  INT          NULL COMMENT 'node-exporter 抓取延迟(ms)',
	cpu_pct     FLOAT        NULL COMMENT 'CPU 使用率 %',
	mem_pct     FLOAT        NULL COMMENT '内存使用率 %',
	disk_pct    FLOAT        NULL COMMENT '根分区使用率 %',
	uptime_sec  BIGINT       NULL COMMENT '系统运行时间(秒)',
	checked_at  DATETIME     NOT NULL COMMENT '最近一次探测时间',
	FOREIGN KEY (mac) REFERENCES nodes(mac) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='节点探测状态（由 Prometheus 数据填充）';
`,
	},
	{
		version: 6,
		desc:    "commerce: plans, customers, customer_subscriptions, traffic_logs",
		up: `
CREATE TABLE IF NOT EXISTS plans (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(128) NOT NULL COMMENT '套餐名称',
    traffic_limit BIGINT NOT NULL DEFAULT 0 COMMENT '流量上限(字节), 0=无限',
    speed_limit   INT NOT NULL DEFAULT 0 COMMENT '限速(Mbps), 0=不限',
    device_limit  INT NOT NULL DEFAULT 3 COMMENT '设备数上限',
    duration_days INT NOT NULL DEFAULT 30 COMMENT '有效天数',
    price         INT NOT NULL DEFAULT 0 COMMENT '价格(分)',
    enabled       TINYINT(1) NOT NULL DEFAULT 1,
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐表';

CREATE TABLE IF NOT EXISTS customers (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(128) NOT NULL UNIQUE COMMENT '客户邮箱',
    password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
    nickname      VARCHAR(64) NOT NULL DEFAULT '',
    status        ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    INDEX idx_email (email),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户表';

CREATE TABLE IF NOT EXISTS customer_subscriptions (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id   INT UNSIGNED NOT NULL,
    plan_id       INT UNSIGNED NOT NULL,
    token         CHAR(64) NOT NULL UNIQUE COMMENT '订阅 token',
    traffic_used  BIGINT NOT NULL DEFAULT 0 COMMENT '已用流量(字节)',
    traffic_limit BIGINT NOT NULL DEFAULT 0 COMMENT '流量上限(字节)',
    device_limit  INT NOT NULL DEFAULT 3,
    started_at    DATETIME NOT NULL,
    expires_at    DATETIME NOT NULL,
    status        ENUM('active','expired','suspended') NOT NULL DEFAULT 'active',
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_customer (customer_id),
    INDEX idx_token (token),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户订阅表';

CREATE TABLE IF NOT EXISTS traffic_logs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT UNSIGNED NOT NULL,
    subscription_id INT UNSIGNED NOT NULL,
    bytes_up        BIGINT NOT NULL DEFAULT 0,
    bytes_down      BIGINT NOT NULL DEFAULT 0,
    logged_at       DATETIME NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
    INDEX idx_customer_time (customer_id, logged_at),
    INDEX idx_sub_time (subscription_id, logged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流量日志表';
`,
	},
	{
		version: 7,
		desc:    "commerce: orders, promo_codes, tickets, ticket_replies, risk_events",
		up: `
CREATE TABLE IF NOT EXISTS orders (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_no      VARCHAR(32) NOT NULL UNIQUE COMMENT '订单号',
    customer_id   INT UNSIGNED NOT NULL,
    plan_id       INT UNSIGNED NOT NULL,
    amount        INT NOT NULL DEFAULT 0 COMMENT '实付金额(分)',
    original_amount INT NOT NULL DEFAULT 0 COMMENT '原价(分)',
    promo_code_id INT UNSIGNED DEFAULT NULL,
    status        ENUM('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
    paid_at       DATETIME DEFAULT NULL,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_customer (customer_id),
    INDEX idx_order_no (order_no),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单表';

CREATE TABLE IF NOT EXISTS promo_codes (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code          VARCHAR(32) NOT NULL UNIQUE COMMENT '优惠码',
    discount_pct  INT NOT NULL DEFAULT 0 COMMENT '折扣百分比(0-100)',
    discount_amt  INT NOT NULL DEFAULT 0 COMMENT '固定减免金额(分)',
    max_uses      INT NOT NULL DEFAULT 0 COMMENT '最大使用次数, 0=无限',
    used_count    INT NOT NULL DEFAULT 0,
    valid_from    DATETIME NOT NULL,
    valid_to      DATETIME NOT NULL,
    enabled       TINYINT(1) NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    INDEX idx_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='优惠码表';

CREATE TABLE IF NOT EXISTS tickets (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id   INT UNSIGNED NOT NULL,
    subject       VARCHAR(256) NOT NULL,
    status        ENUM('open','replied','closed') NOT NULL DEFAULT 'open',
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    INDEX idx_customer (customer_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单表';

CREATE TABLE IF NOT EXISTS ticket_replies (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_id  INT UNSIGNED NOT NULL,
    author     VARCHAR(64) NOT NULL COMMENT '回复者(admin username 或 customer email)',
    is_admin   TINYINT(1) NOT NULL DEFAULT 0,
    content    TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    INDEX idx_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单回复表';

CREATE TABLE IF NOT EXISTS risk_events (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    customer_id   INT UNSIGNED DEFAULT NULL,
    event_type    VARCHAR(64) NOT NULL COMMENT 'login_fail, traffic_spike, device_exceed, abuse',
    detail        VARCHAR(512) NOT NULL DEFAULT '',
    ip            VARCHAR(45) NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL,
    INDEX idx_customer (customer_id),
    INDEX idx_type (event_type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控事件表';
`,
	},
	{
		version: 8,
		desc:    "plan_lines: plan-to-line access mapping",
		up: `
CREATE TABLE IF NOT EXISTS plan_lines (
    plan_id INT UNSIGNED NOT NULL,
    line_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (plan_id, line_id),
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
    FOREIGN KEY (line_id) REFERENCES ` + "`lines`" + `(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='套餐-线路映射';
`,
	},
	{
		version: 9,
		desc:    "customer_subscriptions: add traffic_reset_at",
		up:      `ALTER TABLE customer_subscriptions ADD COLUMN traffic_reset_at DATETIME DEFAULT NULL COMMENT '流量重置时间' AFTER traffic_limit`,
	},
	{
		version: 10,
		desc:    "password_reset_codes table + expiry_notified_at column",
		up: `
CREATE TABLE IF NOT EXISTS password_reset_codes (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email      VARCHAR(255) NOT NULL,
    code       VARCHAR(6) NOT NULL,
    expires_at DATETIME NOT NULL,
    used       TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_email (email),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='密码重置验证码';

ALTER TABLE customer_subscriptions ADD COLUMN expiry_notified_at DATETIME DEFAULT NULL COMMENT '到期提醒发送时间' AFTER status;
`,
	},
	{
		version: 11,
		desc:    "referral system: add referral fields to customers, create referrals table",
		up: `
ALTER TABLE customers ADD COLUMN referral_code VARCHAR(16) DEFAULT NULL UNIQUE COMMENT '邀请码（8位大写字母+数字）' AFTER status;
ALTER TABLE customers ADD COLUMN referred_by INT UNSIGNED DEFAULT NULL COMMENT '邀请人 customer ID' AFTER referral_code;
ALTER TABLE customers ADD COLUMN balance INT NOT NULL DEFAULT 0 COMMENT '余额（分），可用于抵扣订单' AFTER referred_by;

CREATE TABLE IF NOT EXISTS referrals (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    referrer_id INT UNSIGNED NOT NULL COMMENT '邀请人',
    referee_id  INT UNSIGNED NOT NULL COMMENT '被邀请人',
    order_id    INT UNSIGNED DEFAULT NULL COMMENT '触发返利的订单',
    commission  INT NOT NULL DEFAULT 0 COMMENT '返利金额（分）',
    status      ENUM('pending','paid','cancelled') NOT NULL DEFAULT 'pending',
    created_at  DATETIME NOT NULL,
    INDEX idx_referrer (referrer_id),
    INDEX idx_referee (referee_id),
    INDEX idx_order (order_id),
    INDEX idx_status (status),
    FOREIGN KEY (referrer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (referee_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请返利记录';
`,
	},
	{
		version: 12,
		desc:    "announcements table",
		up: `
CREATE TABLE IF NOT EXISTS announcements (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title      VARCHAR(256) NOT NULL DEFAULT '' COMMENT '公告标题',
    content    TEXT         NOT NULL COMMENT '公告内容（Markdown）',
    level      VARCHAR(16)  NOT NULL DEFAULT 'info' COMMENT 'info / warning / critical',
    pinned     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否置顶',
    published  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否发布',
    created_at DATETIME     NOT NULL,
    updated_at DATETIME     NOT NULL,
    INDEX idx_ann_published (published, pinned, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告表';
`,
	},
}

// RunMigrations runs all pending migrations in order.
// Each migration's up field may contain multiple semicolon-separated SQL statements.
func RunMigrations(db *gorm.DB) {
	ensureMigrationsTable(db)
	applied := appliedVersions(db)

	for _, m := range Migrations {
		if applied[m.version] {
			continue
		}
		log.Printf("migration %03d: %s", m.version, m.desc)
		if err := execMigration(db, m); err != nil {
			log.Fatalf("migration %03d failed: %v", m.version, err)
		}
		if err := db.Exec(
			`INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, NOW())`,
			m.version, m.desc,
		).Error; err != nil {
			log.Fatalf("migration %03d record: %v", m.version, err)
		}
		log.Printf("migration %03d: done", m.version)
	}
	log.Printf("schema up to date (latest: %d)", LatestVersion())
}

// CurrentDBVersion returns the highest applied migration version, used by /health.
func CurrentDBVersion(db *gorm.DB) int {
	var v int
	if err := db.Raw(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&v).Error; err != nil {
		return 0
	}
	return v
}

// LatestVersion returns the version number of the last defined migration.
func LatestVersion() int {
	if len(Migrations) == 0 {
		return 0
	}
	return Migrations[len(Migrations)-1].version
}

// ensureMigrationsTable creates the migration tracking table (idempotent).
func ensureMigrationsTable(db *gorm.DB) {
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INT UNSIGNED NOT NULL,
			description VARCHAR(256) NOT NULL DEFAULT '',
			applied_at DATETIME     NOT NULL,
			PRIMARY KEY (version)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='数据库迁移版本记录'
	`).Error; err != nil {
		log.Fatalf("ensureMigrationsTable: %v", err)
	}
}

// appliedVersions returns the set of already-executed migration versions.
func appliedVersions(db *gorm.DB) map[int]bool {
	var versions []int
	if err := db.Raw(`SELECT version FROM schema_migrations`).Scan(&versions).Error; err != nil {
		log.Fatalf("appliedVersions: %v", err)
	}
	applied := make(map[int]bool)
	for _, v := range versions {
		applied[v] = true
	}
	return applied
}

// execMigration splits the up field by semicolons and executes each statement.
// Empty statements (whitespace only) are skipped.
func execMigration(db *gorm.DB, m Migration) error {
	stmts := splitSQL(m.up)
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("stmt %q: %w", truncate(stmt, 80), err)
		}
	}
	return nil
}

// splitSQL splits SQL by semicolons, filtering empty statements.
func splitSQL(s string) []string {
	var out []string
	for _, part := range splitBySemicolon(s) {
		trimmed := trimSQL(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func splitBySemicolon(s string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ';' {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}

func trimSQL(s string) string {
	i, j := 0, len(s)-1
	for i <= j && isSpace(s[i]) {
		i++
	}
	for j >= i && isSpace(s[j]) {
		j--
	}
	if i > j {
		return ""
	}
	return s[i : j+1]
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
