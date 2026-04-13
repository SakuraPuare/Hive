.PHONY: help setup setup-armbian download-binaries env \
       build build-r3s build-qemu run-qemu \
       registry registry-arm64 registry-test registry-test-short registry-openapi registry-seed registry-clean \
       ui-dev ui-build ui-gen-api ui-typecheck ui-test \
       monitoring-up monitoring-down monitoring-logs \
       docs-dev docs-build docs-deploy \
       sanitize node-lookup

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 帮助
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

help: ## 显示所有可用目标
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 初始化
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

setup: setup-armbian download-binaries env ## 一键初始化（Armbian 框架 + 二进制 + .env）

setup-armbian: ## 克隆/更新 Armbian 构建框架
	./scripts/setup-armbian.sh

download-binaries: ## 下载 arm64 预编译二进制
	./scripts/download-binaries.sh

env: ## 从 .env.example 创建 .env（不覆盖已有）
	@test -f .env || (cp .env.example .env && echo ".env 已创建，请填写配置")
	@test -f .env && echo ".env 已存在，跳过"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 镜像构建
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

build: ## 构建 nanopi-zero2 (RK3528) 镜像
	./scripts/build.sh nanopi-zero2

build-r3s: ## 构建 nanopi-r3s (RK3566) 镜像
	./scripts/build.sh nanopi-r3s

build-all: build build-r3s ## 构建所有板子镜像

build-qemu: ## 构建 QEMU 测试镜像
	./scripts/build-qemu.sh

run-qemu: ## 启动 QEMU 虚拟机（SSH: localhost:2222）
	./scripts/run-qemu.sh

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Registry 后端
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

registry: ## 编译 registry 后端 (amd64)
	$(MAKE) -C management/registry build

registry-arm64: ## 交叉编译 registry 后端 (arm64)
	$(MAKE) -C management/registry build-arm64

registry-test: ## 运行 registry 集成测试
	$(MAKE) -C management/registry test

registry-test-short: ## 运行 registry 测试（简洁输出）
	$(MAKE) -C management/registry test-short

registry-openapi: ## 生成 OpenAPI 文档
	$(MAKE) -C management/registry openapi

registry-seed: ## 填充本地演示数据
	$(MAKE) -C management/registry seed-local-demo

registry-clean: ## 清理 registry 构建产物
	$(MAKE) -C management/registry clean

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Registry UI 前端
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ui-build: ## 构建前端
	cd management/registry-ui && npm run build

ui-gen-api: ## 从 OpenAPI 生成 TS client
	cd management/registry-ui && npm run gen-api

ui-typecheck: ## TypeScript 类型检查
	cd management/registry-ui && npm run typecheck

ui-test: ## 运行前端测试
	cd management/registry-ui && npm test

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 监控
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

monitoring-up: ## 启动监控栈 (Prometheus + Grafana + Alertmanager)
	cd management && docker compose up -d

monitoring-down: ## 停止监控栈
	cd management && docker compose down

monitoring-logs: ## 查看监控日志
	cd management && docker compose logs -f

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 文档
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

docs-build: ## 构建 VitePress 文档
	npm run docs:build

docs-deploy: ## 部署文档到 Cloudflare Pages
	./scripts/deploy-docs.sh

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 运维
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

sanitize: ## 量产前清洗镜像唯一标识
	./scripts/sanitize.sh

node-lookup: ## 查询节点访问地址（用法: make node-lookup MAC6=aabbcc）
	./scripts/node-lookup.sh $(MAC6)
