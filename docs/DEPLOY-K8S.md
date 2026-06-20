# Kubernetes 部署（管理平面 Registry + UI）

本文档描述如何把 `management/registry`（Go API）和 `management/registry-ui`
（Next.js 静态导出）以容器方式部署到 Kubernetes，并通过 Zadig 做 CI/CD。
这是 `setup-vps.sh`（单机 systemd + nginx）之外的另一种部署形态。

## 组件

| 组件 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| hive-registry | `management/registry/Dockerfile` | 8080 | Go API，需 MySQL，自带 GORM 自动迁移 + 管理员/RBAC 引导，`/health` 健康检查 |
| hive-registry-ui | `management/registry-ui/Dockerfile` | 80 | Next.js `output: export` → nginx 托管 `out/`，`/api/` 反代到 `hive-registry:8080` |
| MySQL 8.4 | 上游 `mysql:8.4` | 3306 | 空库 `hive_registry`，registry 启动时自建表 |

## 镜像构建

```bash
# Registry API（构建上下文 = management/registry）
docker build -t <registry>/hive-registry:<tag> management/registry

# Registry UI（构建上下文 = management/registry-ui；生成的 API 客户端已提交，
# 构建期无需 gen-api / OpenAPI 规范）
docker build -t <registry>/hive-registry-ui:<tag> management/registry-ui
```

## 关键环境变量（hive-registry，详见 `internal/config/config.go`）

| 变量 | 说明 |
|------|------|
| `PORT` / `LISTEN_ADDR` | 监听端口，默认 8080 |
| `MYSQL_HOST/PORT/USER/PASSWORD/DB` | MySQL 连接，DB 默认 `hive_registry` |
| `API_SECRET` | 管理 API（PATCH/DELETE）Bearer 密钥；非 `HIVE_ENV=dev` 时必填 |
| `ADMIN_USER` / `ADMIN_PASS` | 超管引导账号 |
| `ADMIN_SESSION_SECRET` | 管理端 session 签名密钥；非 dev 必填 |
| `CORS_ALLOW_ORIGINS` | 跨域调试用，同域 ingress 部署可留空 |

> 非 `HIVE_ENV=dev` 时若缺 `API_SECRET` / `ADMIN_SESSION_SECRET`，进程会 fail-fast 退出。

## 网络

UI 容器内 nginx（`nginx.k8s.conf`）把 `/api/` 反代到 `hive-registry:8080`，
故前端与 API 同源，`NEXT_PUBLIC_API_BASE` 保持默认 `/api` 即可。
集群入口建议用 Ingress（如 `hive.sakurapuare.com`）指向 `hive-registry-ui:80`，
由 ingress 终止 TLS。
