# 本地开发与调试

本文档用于在本机直接跑通 `registry` 与 `registry-ui`，并插入一批默认演示节点，方便先做服务端和后台开发，不依赖真实边缘节点。

---

## 一、目标

本地开发模式下，我们只启动：

- MySQL
- `management/registry`
- `management/registry-ui`

先不启动：

- Prometheus
- Grafana
- nginx
- Cloudflare

这套模式适合开发下面这些功能：

- 节点台账
- 线路管理
- 订阅生成
- 管理后台页面
- RBAC 与审计

---

## 二、前提

本地需要有：

- Docker
- Go
- Node.js + npm

建议统一使用 `127.0.0.1`，不要混用 `localhost` 与 `127.0.0.1`，这样可以避免 Cookie 与跨域调试问题。

---

## 三、启动 MySQL

先起一个本地 MySQL 容器：

```bash
docker run --name hive-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=hive_registry \
  -e MYSQL_USER=hive \
  -e MYSQL_PASSWORD=hive \
  -p 3306:3306 \
  -d mysql:8
```

说明：

- 数据库名：`hive_registry`
- 用户名：`hive`
- 密码：`hive`

如果容器已经存在，可直接：

```bash
docker start hive-mysql
```

---

## 四、启动后端 `registry`

进入后端目录：

```bash
cd ~/rk3528-hive/management/registry
```

设置本地开发环境变量：

```bash
export LISTEN_ADDR=127.0.0.1:8080
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=hive
export MYSQL_PASSWORD=hive
export MYSQL_DB=hive_registry

export ADMIN_USER=admin
export ADMIN_PASS=admin123
export ADMIN_SESSION_SECRET=dev-session-secret

export API_SECRET=dev-api-secret
export CORS_ALLOW_ORIGINS=http://127.0.0.1:3000
export ADMIN_COOKIE_SAMESITE=lax

# 节点探测（可选，不配置则探测循环会静默失败）
# export PROMETHEUS_URL=http://127.0.0.1:4230
```

直接启动：

```bash
go run .
```

后端第一次启动时会自动：

- 建表
- 初始化 RBAC
- 在用户表为空时创建默认管理员

健康检查：

```bash
curl http://127.0.0.1:8080/health
```

---

## 五、插入本地演示数据

后端启动并完成建表后，执行：

```bash
cd ~/rk3528-hive/management/registry
make seed-local-demo
```

如果你本地数据库账号密码不是文档里的示例值，先显式传入：

```bash
cd ~/rk3528-hive/management/registry
MYSQL_USER=root MYSQL_PASSWORD=123456 make seed-local-demo
```

默认会插入：

- 4 个演示节点
- 2 个演示订阅分组
- 2 条演示线路（日本家宽、亚洲优化）

数据文件在：

- `management/registry/dev/seed-local-demo.sql`

脚本在：

- `management/registry/dev/seed-local-demo.sh`

默认演示节点包括：

- `JP-Tokyo`
- `HK-HongKong`
- `SG-Singapore`
- `US-LosAngeles`

其中故意保留了一个 `tailscale_ip = pending` 的节点，用来模拟离线或未接入场景。

---

## 六、启动前端 `registry-ui`

进入前端目录：

```bash
cd ~/rk3528-hive/management/registry-ui
```

指定 API 地址并启动开发服务器：

```bash
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

注意：

- `NEXT_PUBLIC_API_BASE` 必须在启动 `npm run dev` 之前就带上
- 如果你改了这个变量，必须重启前端开发服务器
- 如果没带这个变量，前端会默认请求 `/api`，也就是打到 `127.0.0.1:3000` 自己身上，而不是 Go 后端

打开：

```text
http://127.0.0.1:3000/login
```

默认管理员账号：

- 用户名：`admin`
- 密码：`admin123`

---

## 七、本地调试建议

### 1. 看 API 是否正常

列出节点：

```bash
curl --cookie-jar /tmp/hive-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  http://127.0.0.1:8080/admin/login

curl --cookie /tmp/hive-cookie.txt \
  http://127.0.0.1:8080/nodes
```

### 2. 看订阅是否正常

```bash
curl --cookie /tmp/hive-cookie.txt \
  http://127.0.0.1:8080/subscription

curl --cookie /tmp/hive-cookie.txt \
  http://127.0.0.1:8080/subscription/clash
```

### 3. 当前前端依赖的跨域设置

本地前后端是跨端口访问，所以后端必须允许：

- `CORS_ALLOW_ORIGINS=http://127.0.0.1:3000`

前端默认会携带 Cookie：

- `WITH_CREDENTIALS = true`

所以不要把前端切到别的 host，除非你同步更新 CORS。

---

## 八、常用重置方式

### 清空数据库重来

如果你只是本地演示环境，最简单的方式是删除 MySQL 容器：

```bash
docker rm -f hive-mysql
```

然后重新执行：

1. 启动 MySQL
2. 启动 `registry`
3. 执行 `make seed-local-demo`
4. 启动 `registry-ui`

### 只重刷演示数据

如果表结构没变，只想重新插入演示数据：

```bash
cd ~/rk3528-hive/management/registry
make seed-local-demo
```

这个脚本是幂等的，重复执行不会因为主键冲突直接失败。

---

## 九、常见问题

### 1. `405 Method Not Allowed`

如果你在登录或加载页面时看到：

```text
Generic Error: status: 405; status text: Method Not Allowed
```

最常见原因是：

- 前端请求没有打到 `127.0.0.1:8080`
- 而是打到了 `127.0.0.1:3000/api/...`

排查方法：

1. 打开浏览器开发者工具，看失败请求的 URL
2. 如果 URL 是 `http://127.0.0.1:3000/api/...`，说明 `NEXT_PUBLIC_API_BASE` 没生效
3. 停掉前端，重新执行：

```bash
cd ~/rk3528-hive/management/registry-ui
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

再单独确认后端是通的：

```bash
curl http://127.0.0.1:8080/health
```

### 2. 登录后立刻跳回 `/login`

通常是下面两个问题之一：

- 前后端 host 不一致，比如一边用 `localhost`，一边用 `127.0.0.1`
- `CORS_ALLOW_ORIGINS` 没包含 `http://127.0.0.1:3000`

建议统一使用：

- 前端：`http://127.0.0.1:3000`
- 后端：`http://127.0.0.1:8080`

---

## 十、适用范围

这套本地模式只用于：

- 服务端开发
- UI 联调
- 管理流程验证
- 订阅格式验证

它不模拟真实边缘节点的以下行为：

- provision
- 主动注册以后的状态变化
- 周期性心跳
- 节点版本变更
- 实时流量数据

这些能力后续如果要验证，需要再补专门的模拟器或等真实节点升级。
