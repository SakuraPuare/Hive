#!/bin/bash
# VPS 管理端一键安装脚本（Ubuntu 22.04 / 24.04 / Debian trixie）
# 安装：hive-registry、Docker、Ansible、nginx、Node.js、部署 Prometheus+Grafana+registry-ui
# 幂等：可重复执行，已安装的组件只会更新配置或重启服务
#
# 在 VPS 上执行：
#   git clone <your-repo> /opt/rk3528-hive
#   cd /opt/rk3528-hive
#   cp .env.example .env && nano .env    # 填入所有必填项
#   bash management/setup-vps.sh

set -e
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

# 加载 .env
if [ -f "${ROOT_DIR}/.env" ]; then
    set -a; source "${ROOT_DIR}/.env"; set +a
else
    echo "!!! .env not found. Copy .env.example and fill in the values first."
    exit 1
fi

echo "=== Hive Management Setup ==="

# ─────────────────────────────────────────────
# 1. 安装基础依赖工具
# ─────────────────────────────────────────────
apt-get install -y --no-install-recommends jq curl make rsync prometheus-node-exporter
systemctl enable --now prometheus-node-exporter

# ─────────────────────────────────────────────
# 2. 安装 nginx
# ─────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
    echo ">>> Installing nginx..."
    apt-get install -y nginx
else
    echo ">>> nginx already installed: $(nginx -v 2>&1)"
fi

# 部署 nginx 配置（每次执行都刷新）
cp "${ROOT_DIR}/management/nginx/nginx.conf" /etc/nginx/nginx.conf
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl start nginx
echo ">>> nginx configured"

# ─────────────────────────────────────────────
# 3. 安装 Docker
# ─────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo ">>> Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
else
    echo ">>> Docker already installed: $(docker --version)"
fi

# ─────────────────────────────────────────────
# 4. 安装 Ansible + community.general
# ─────────────────────────────────────────────
if ! command -v ansible &>/dev/null; then
    echo ">>> Installing Ansible..."
    apt-get update -q
    apt-get install -y software-properties-common
    # Ubuntu 专属 PPA；Debian 直接用系统源
    if grep -qi ubuntu /etc/os-release; then
        add-apt-repository --yes --update ppa:ansible/ansible
    else
        apt-get update -q
    fi
    apt-get install -y ansible
else
    echo ">>> Ansible already installed: $(ansible --version | head -1)"
fi

if ! ansible-galaxy collection list community.general &>/dev/null; then
    echo ">>> Installing Ansible collections..."
    ansible-galaxy collection install community.general --upgrade
fi

# ─────────────────────────────────────────────
# 5. 安装 Go（若缺失或版本过旧）
# ─────────────────────────────────────────────
# 先把 /usr/local/go/bin 加入 PATH，避免检测时找不到已安装的 go
export PATH=$PATH:/usr/local/go/bin

GO_MIN="1.22"
need_go=false
if ! command -v go &>/dev/null; then
    need_go=true
else
    GO_VER=$(go version | awk '{print $3}' | sed 's/go//')
    # 简单比较：主版本号满足即可
    GO_MAJOR=$(echo "$GO_VER" | cut -d. -f1-2)
    if awk "BEGIN{exit !($GO_MAJOR < $GO_MIN)}"; then
        need_go=true
    fi
fi

if $need_go; then
    echo ">>> Installing Go ${GO_MIN}+..."
    ARCH=$(dpkg --print-architecture)
    case "$ARCH" in
        amd64) GOARCH=amd64 ;;
        arm64) GOARCH=arm64 ;;
        *)     echo "!!! Unsupported arch: $ARCH"; exit 1 ;;
    esac
    GO_VER_INSTALL="1.22.5"
    GO_TAR="go${GO_VER_INSTALL}.linux-${GOARCH}.tar.gz"
    curl -fsSL "https://go.dev/dl/${GO_TAR}" -o "/tmp/${GO_TAR}"
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "/tmp/${GO_TAR}"
    rm -f "/tmp/${GO_TAR}"
    echo ">>> Go installed: $(go version)"
else
    echo ">>> Go already installed: $(/usr/local/go/bin/go version)"
fi

# 写入 profile.d，对所有后续 shell session 永久生效
echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/golang.sh
chmod 644 /etc/profile.d/golang.sh
# PATH 已在检测阶段 export，此处无需重复

# ─────────────────────────────────────────────
# 6. 初始化 MySQL 数据库和用户
# ─────────────────────────────────────────────
MYSQL_DB="${REGISTRY_MYSQL_DB:-hive_registry}"
MYSQL_USER="${REGISTRY_MYSQL_USER:-hive}"
MYSQL_PASS="${REGISTRY_MYSQL_PASSWORD}"

if [ -z "${MYSQL_PASS}" ]; then
    echo "!!! REGISTRY_MYSQL_PASSWORD is not set in .env"
    exit 1
fi

echo ">>> Initializing MySQL database..."
mysql -u root << SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
ALTER USER '${MYSQL_USER}'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
echo ">>> MySQL: database '${MYSQL_DB}' and user '${MYSQL_USER}' ready"

# ─────────────────────────────────────────────
# 7. 编译并安装 hive-registry
# ─────────────────────────────────────────────
echo ">>> Building hive-registry..."

REGISTRY_DIR="${ROOT_DIR}/management/registry"
REGISTRY_BIN="${REGISTRY_DIR}/hive-registry"

# 检测目标架构决定 make 目标
ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "arm64" ]; then
    make -C "${REGISTRY_DIR}" build-arm64
    REGISTRY_BIN="${REGISTRY_DIR}/hive-registry-arm64"
else
    make -C "${REGISTRY_DIR}" build
fi

# cp → mv 两步：mv 是原子 inode 替换，不会触发 "Text file busy"（服务运行中也安全）
cp "${REGISTRY_BIN}" /usr/local/bin/hive-registry.new
chmod +x /usr/local/bin/hive-registry.new
mv /usr/local/bin/hive-registry.new /usr/local/bin/hive-registry
echo ">>> hive-registry built and installed"

# 写入 EnvironmentFile（每次执行都刷新，确保密码等变量同步）
cat > /etc/hive-registry.env << EOF
LISTEN_ADDR=${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}
MYSQL_HOST=${REGISTRY_MYSQL_HOST:-127.0.0.1}
MYSQL_PORT=${REGISTRY_MYSQL_PORT:-3306}
MYSQL_USER=${REGISTRY_MYSQL_USER:-hive}
MYSQL_PASSWORD=${REGISTRY_MYSQL_PASSWORD}
MYSQL_DB=${REGISTRY_MYSQL_DB:-hive_registry}
DB_MAX_OPEN=${REGISTRY_DB_MAX_OPEN:-10}
DB_MAX_IDLE=${REGISTRY_DB_MAX_IDLE:-3}
XRAY_PATH=${REGISTRY_XRAY_PATH:-ray}
API_SECRET=${REGISTRY_API_SECRET}
ADMIN_USER=${REGISTRY_ADMIN_USER:-admin}
ADMIN_PASS=${REGISTRY_ADMIN_PASS}
ADMIN_SESSION_SECRET=${REGISTRY_ADMIN_SESSION_SECRET}
CORS_ALLOW_ORIGINS=${REGISTRY_CORS_ALLOW_ORIGINS}
ADMIN_COOKIE_SAMESITE=${REGISTRY_ADMIN_COOKIE_SAMESITE:-lax}
EOF
chmod 600 /etc/hive-registry.env

# 安装或更新 systemd 服务单元
cat > /etc/systemd/system/hive-registry.service << 'UNIT'
[Unit]
Description=Hive Node Registry
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=nobody
EnvironmentFile=/etc/hive-registry.env
ExecStart=/usr/local/bin/hive-registry
Restart=always
RestartSec=5
MemoryMax=64M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable hive-registry
# 无论服务状态如何，重启以加载最新二进制和配置
systemctl restart hive-registry
echo ">>> hive-registry: $(systemctl is-active hive-registry)"

# ─────────────────────────────────────────────
# 8. 安装 Node.js（构建 registry-ui 需要）
# ─────────────────────────────────────────────
NODE_MIN=20
if ! command -v node &>/dev/null || [ "$(node -e 'process.stdout.write(process.version.slice(1).split(".")[0])')" -lt "${NODE_MIN}" ]; then
    echo ">>> Installing Node.js ${NODE_MIN}+..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN}.x | bash -
    apt-get install -y nodejs
else
    echo ">>> Node.js already installed: $(node --version)"
fi

# ─────────────────────────────────────────────
# 9. 构建并部署 registry-ui
# ─────────────────────────────────────────────
UI_DIR="${ROOT_DIR}/management/registry-ui"
UI_OUT="${UI_DIR}/out"
UI_DEPLOY="/var/www/hive-ui"

echo ">>> Building registry-ui..."
cd "${UI_DIR}"
npm ci --prefer-offline
npm run build
cd "${ROOT_DIR}"

echo ">>> Deploying registry-ui to ${UI_DEPLOY}..."
mkdir -p "${UI_DEPLOY}"
# rsync 原子替换：先同步到临时目录，再 rename（避免 nginx 服务中断）
rsync -a --delete "${UI_OUT}/" "${UI_DEPLOY}.new/"
# 原子切换
if [ -d "${UI_DEPLOY}" ]; then
    mv "${UI_DEPLOY}" "${UI_DEPLOY}.old"
fi
mv "${UI_DEPLOY}.new" "${UI_DEPLOY}"
rm -rf "${UI_DEPLOY}.old"
echo ">>> registry-ui deployed"

# 重新加载 nginx 以确保配置生效
systemctl reload nginx

# ─────────────────────────────────────────────
# 10. 创建运行时目录
# ─────────────────────────────────────────────
mkdir -p "${ROOT_DIR}/management/prometheus/targets"
[ -f "${ROOT_DIR}/management/prometheus/targets/nodes.json" ] || \
    echo "[]" > "${ROOT_DIR}/management/prometheus/targets/nodes.json"

# ─────────────────────────────────────────────
# 11. 启动 Prometheus + Grafana
# ─────────────────────────────────────────────
echo ">>> Starting Prometheus + Grafana + Alertmanager..."
cd "${ROOT_DIR}/management"
docker compose up -d --remove-orphans
cd "${ROOT_DIR}"

# ─────────────────────────────────────────────
# 12. cron：每分钟从 hive-registry 刷新 Prometheus 节点列表
# ─────────────────────────────────────────────
REGISTRY_LOCAL_URL="http://${REGISTRY_LISTEN_ADDR:-127.0.0.1:8080}"
TARGETS_FILE="${ROOT_DIR}/management/prometheus/targets/nodes.json"
AUTH_HEADER=""
if [ -n "${REGISTRY_API_SECRET}" ]; then
    AUTH_HEADER="-H \"Authorization: Bearer ${REGISTRY_API_SECRET}\""
fi

# cron 直连 Go 服务（不经 nginx），路径无 /api 前缀
# 写入 /etc/cron.d/（支持用户字段格式，幂等覆盖）
cat > /etc/cron.d/hive-targets << EOF
* * * * * root curl -sf ${AUTH_HEADER} -o ${TARGETS_FILE} ${REGISTRY_LOCAL_URL}/prometheus-targets
EOF
chmod 0644 /etc/cron.d/hive-targets
echo ">>> Cron installed: prometheus-targets refresh every minute"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Registry UI    : http://localhost/"
echo "  hive-registry  : ${REGISTRY_LOCAL_URL}  (local only)"
echo "  Prometheus     : ${PROMETHEUS_EXTERNAL_URL:-http://localhost/prometheus/}"
echo "  Grafana        : ${GRAFANA_ROOT_URL:-http://localhost/grafana}"
echo "  Grafana PW     : ${GRAFANA_PASSWORD:-changeme}"
echo "  Alertmanager   : ${ALERTMANAGER_EXTERNAL_URL:-http://localhost/alertmanager/}"
echo ""
echo "  Verify:"
if [ -n "${REGISTRY_API_SECRET}" ]; then
    echo "    curl -H 'Authorization: Bearer ${REGISTRY_API_SECRET}' http://localhost/api/health"
else
    echo "    curl http://localhost/api/health"
fi
echo "    curl http://localhost/"
echo ""
echo "  Grafana setup:"
echo "    1. Login admin / (password above)"
echo "    2. Dashboards -> Import -> ID: 1860  (Node Exporter Full)"
echo "    3. Select 'Prometheus' datasource -> Import"
echo ""
echo "  Ansible test (after nodes are up):"
echo "    cd ${ROOT_DIR}"
echo "    ansible-playbook ansible/playbooks/ping.yml"
echo ""
