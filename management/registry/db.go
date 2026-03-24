package main

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var db *sql.DB

func initDB() {
	host := getenv("MYSQL_HOST", "127.0.0.1")
	port := getenv("MYSQL_PORT", "3306")
	user := getenv("MYSQL_USER", "hive")
	pass := getenv("MYSQL_PASSWORD", "")
	dbname := getenv("MYSQL_DB", "hive_registry")

	// time_zone=%27%2B00%3A00%27 → '+00:00'，强制会话 UTC，与 Go time.Now().UTC() 保持一致
	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&collation=utf8mb4_unicode_ci&time_zone=%%27%%2B00%%3A00%%27&timeout=10s&readTimeout=30s&writeTimeout=30s",
		user, pass, host, port, dbname,
	)

	var err error
	db, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("db.Open: %v", err)
	}

	// 连接池配置：通过环境变量可调，默认值适合小规模部署
	maxOpen, _ := strconv.Atoi(getenv("DB_MAX_OPEN", "10"))
	maxIdle, _ := strconv.Atoi(getenv("DB_MAX_IDLE", "3"))
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(5 * time.Minute)  // 超时后 driver 主动断开
	db.SetConnMaxIdleTime(2 * time.Minute)  // 空闲连接保留时间

	if err = db.Ping(); err != nil {
		log.Fatalf("db.Ping: %v", err)
	}
	log.Printf("MySQL connected: %s:%s/%s (maxOpen=%d maxIdle=%d)", host, port, dbname, maxOpen, maxIdle)
	initSchema()
	bootstrapSuperadmin()
	bootstrapRBAC()
}

func initSchema() {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			username      VARCHAR(64)  NOT NULL UNIQUE
			              COMMENT '用户名',
			password_hash VARCHAR(255) NOT NULL
			              COMMENT 'bcrypt hash',
			role          ENUM('superadmin','admin','viewer') NOT NULL DEFAULT 'viewer'
			              COMMENT '角色',
			created_at    DATETIME NOT NULL,
			updated_at    DATETIME NOT NULL,
			INDEX idx_username (username)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='管理员用户表'
	`)
	if err != nil {
		log.Fatalf("initSchema users: %v", err)
	}

	// ── RBAC 表 ────────────────────────────────────────────────────────────────

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS roles (
			id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			name        VARCHAR(64)  NOT NULL UNIQUE COMMENT '角色名，如 superadmin',
			description VARCHAR(256) NOT NULL DEFAULT '',
			created_at  DATETIME NOT NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='角色表'
	`)
	if err != nil {
		log.Fatalf("initSchema roles: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS permissions (
			id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			slug        VARCHAR(64)  NOT NULL UNIQUE COMMENT '如 node:read',
			description VARCHAR(256) NOT NULL DEFAULT ''
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='权限表（系统预定义）'
	`)
	if err != nil {
		log.Fatalf("initSchema permissions: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS role_permissions (
			role_id       INT UNSIGNED NOT NULL,
			permission_id INT UNSIGNED NOT NULL,
			PRIMARY KEY (role_id, permission_id),
			FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
			FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='角色-权限映射'
	`)
	if err != nil {
		log.Fatalf("initSchema role_permissions: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS user_roles (
			user_id INT UNSIGNED NOT NULL,
			role_id INT UNSIGNED NOT NULL,
			PRIMARY KEY (user_id, role_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='用户-角色映射（多对多）'
	`)
	if err != nil {
		log.Fatalf("initSchema user_roles: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS user_permissions (
			user_id       INT UNSIGNED NOT NULL,
			permission_id INT UNSIGNED NOT NULL,
			PRIMARY KEY (user_id, permission_id),
			FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
			FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='用户直接权限（绕过角色）'
	`)
	if err != nil {
		log.Fatalf("initSchema user_permissions: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS audit_logs (
			id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			username   VARCHAR(64)  NOT NULL
			           COMMENT '操作用户',
			action     VARCHAR(64)  NOT NULL
			           COMMENT 'login_success / login_fail / logout / user_create / user_delete / password_change',
			detail     VARCHAR(256) NOT NULL DEFAULT '',
			ip         VARCHAR(45)  NOT NULL DEFAULT '',
			created_at DATETIME     NOT NULL,
			INDEX idx_audit_username   (username),
			INDEX idx_audit_created_at (created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='操作审计日志'
	`)
	if err != nil {
		log.Fatalf("initSchema audit_logs: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS nodes (
			mac           VARCHAR(12)       NOT NULL
			              COMMENT 'MAC 地址（无冒号小写，如 aabbccddeeff）',
			mac6          VARCHAR(6)        NOT NULL
			              COMMENT 'MAC 末6位（设备短 ID）',
			hostname      VARCHAR(64)       NOT NULL,
			cf_url        VARCHAR(256)      NOT NULL
			              COMMENT 'CF Tunnel URL（含 https://）',
			tunnel_id     VARCHAR(64)       NOT NULL DEFAULT ''
			              COMMENT 'Cloudflare Tunnel UUID',
			tailscale_ip  VARCHAR(40)       NOT NULL DEFAULT 'pending'
			              COMMENT 'Tailscale IP，pending 表示尚未接入',
			easytier_ip   VARCHAR(40)       NOT NULL DEFAULT ''
			              COMMENT 'EasyTier mesh IP（10.x.x.x）',
			frp_port      SMALLINT UNSIGNED NOT NULL DEFAULT 0
			              COMMENT 'FRP SSH 远程端口',
			xray_uuid     CHAR(36)          NOT NULL
			              COMMENT 'xray VLESS UUID（确定性，基于 MAC）',
			location      VARCHAR(128)      NOT NULL DEFAULT ''
			              COMMENT '管理员标注的地理位置（不随节点重注册覆盖）',
			note          VARCHAR(256)      NOT NULL DEFAULT ''
			              COMMENT '管理员备注（不随节点重注册覆盖）',
			registered_at DATETIME          NOT NULL
			              COMMENT '首次注册时间（不随节点重注册覆盖）',
			last_seen     DATETIME          NOT NULL
			              COMMENT '最近一次注册/心跳时间',
			PRIMARY KEY  (mac),
			INDEX idx_mac6      (mac6),
			INDEX idx_last_seen (last_seen)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		  COMMENT='Hive 边缘节点注册表'
	`)
	if err != nil {
		log.Fatalf("initSchema: %v", err)
	}
	log.Println("Schema ready")

	// 将 users.role 从 ENUM 迁移到 VARCHAR(64)（幂等，忽略已迁移的情况）
	db.Exec(`ALTER TABLE users MODIFY COLUMN role VARCHAR(64) NOT NULL DEFAULT 'viewer' COMMENT '主角色（快捷字段，用于 session cookie）'`)
}
