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
}

func initSchema() {
	_, err := db.Exec(`
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
}
