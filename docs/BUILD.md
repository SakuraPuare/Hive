# 镜像构建指南

本文档描述如何从零开始构建 Hive Node 的 Armbian 镜像，并烧录到 SD 卡。

---

## 一、前提条件

### 构建主机要求

| 项目 | 最低要求 | 推荐 |
|------|----------|------|
| 操作系统 | Ubuntu 22.04 / Debian 12 | Ubuntu 22.04 LTS |
| CPU 核数 | 4 核 | 8 核以上（ccache 加速后影响不大） |
| 内存 | 8 GB | 16 GB（可启用 tmpfs 加速） |
| 磁盘空间 | 50 GB | 100 GB SSD |
| 网络 | 可访问 GitHub | 国际出口带宽越大越快 |

### 主机依赖

```bash
# Armbian 构建系统依赖
sudo apt install -y \
    git curl wget jq \
    build-essential python3 \
    ccache unzip zip \
    qemu-user-static binfmt-support \
    debootstrap

# 可选：ccache 加速（推荐，第二次构建节约 60%+ 时间）
sudo apt install -y ccache
```

### 网络凭证准备

构建前需要准备好以下凭证，填入 `.env`：

| 变量 | 来源 | 文档 |
|------|------|------|
| `CF_API_TOKEN` | Cloudflare Dashboard | [03-cloudflare-tokens.md](../management/docs/03-cloudflare-tokens.md) |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard | 同上 |
| `CF_ZONE_ID` | Cloudflare Dashboard | 同上 |
| `CF_DOMAIN` | 你的域名 | 同上 |
| `TAILSCALE_OAUTH_SECRET` | Tailscale Admin Console | [04-tailscale-key.md](../management/docs/04-tailscale-key.md) |
| `FRP_SERVER_ADDR` | 境外 VPS IP | [01-foreign-vps.md](../management/docs/01-foreign-vps.md) |
| `FRP_AUTH_TOKEN` | frps.toml 里的 token | 同上 |
| `EASYTIER_PEERS` | 境外 VPS IP | 同上 |
| `EASYTIER_NETWORK_NAME` | 自定义 | — |
| `EASYTIER_SECRET` | 自定义 | — |
| `NODE_REGISTRY_URL` | 中国 VPS 域名 | [02-china-vps.md](../management/docs/02-china-vps.md) |

---

## 二、首次构建流程

### 步骤 1：克隆仓库

```bash
git clone <your-repo-url> rk3528-hive
cd rk3528-hive
```

### 步骤 2：配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入所有凭证
vim .env
```

`.env` 关键字段说明：

```bash
# ─── Cloudflare ───────────────────────────────────
CF_API_TOKEN=       # CF API Token（需要 Tunnel Edit + DNS Edit 权限）
CF_ACCOUNT_ID=      # CF 账户 ID
CF_ZONE_ID=         # 你的域名 Zone ID
CF_DOMAIN=          # 根域名，如 example.com

# ─── Tailscale ────────────────────────────────────
TAILSCALE_OAUTH_SECRET=tskey-client-xxxxx   # OAuth Client Secret

# ─── FRP ──────────────────────────────────────────
FRP_SERVER_ADDR=    # 境外 VPS 公网 IP 或域名
FRP_SERVER_PORT=7000
FRP_AUTH_TOKEN=     # 与 frps.toml 里 auth.token 一致

# ─── EasyTier ─────────────────────────────────────
EASYTIER_PEERS=     # 境外 VPS IP:11010（多中继逗号分隔）
EASYTIER_NETWORK_NAME=hive
EASYTIER_SECRET=    # 自定义密钥

# ─── 账号 ─────────────────────────────────────────
DEFAULT_ROOT_PASSWORD=   # 节点 root 初始密码（provision 后应通过 key 登录）

# ─── 可选 ─────────────────────────────────────────
NODE_REGISTRY_URL=https://registry.example.com
```

### 步骤 3：初始化 Armbian 构建框架

```bash
./scripts/setup-armbian.sh
```

这会克隆 Armbian 官方构建系统到 `armbian-build/build/`，约需下载 100-200 MB。

### 步骤 4：下载 arm64 二进制

```bash
./scripts/download-binaries.sh
```

会下载以下二进制到 overlay 目录：

| 软件 | 说明 |
|------|------|
| `xray` | VLESS 代理核心 |
| `cloudflared` | Cloudflare Tunnel 客户端 |
| `frpc` | FRP 客户端（SSH 应急隧道） |
| `easytier-core` | P2P mesh 网络 |

下载均来自各项目 GitHub Releases，可通过环境变量指定版本：

```bash
XRAY_VER=v26.2.6 CLOUDFLARED_VER=2026.2.0 ./scripts/download-binaries.sh
```

### 步骤 5：构建镜像

```bash
./scripts/build.sh
```

构建脚本会：
1. 根据 CPU 核数自动设置并行编译线程
2. 渲染配置模板（`config.env`, `frpc.toml`）
3. 同步 userpatches 到 Armbian build 目录
4. 调用 `compile.sh` 完成完整构建

首次构建约需 30-90 分钟（视机器性能）。后续构建因 ccache 缓存通常只需 10-20 分钟。

**自定义构建参数**：

```bash
# 指定开发板型号（默认 nanopi-zero2，RK3528 用 ido-som3588q 或你的实际型号）
BOARD=nanopi-zero2 ./scripts/build.sh

# 开启 Kernel menuconfig
KERNEL_CONFIGURE=yes ./scripts/build.sh

# 指定 Debian release（默认 trixie）
RELEASE=bookworm ./scripts/build.sh
```

### 步骤 6：烧录到 SD 卡

构建完成后，镜像输出在 `armbian-build/build/output/images/`：

```bash
ls armbian-build/build/output/images/*.img*
```

**烧录单张 SD 卡**：

```bash
# 确认 SD 卡设备路径（绝对不要搞错！）
lsblk

# 烧录（以 /dev/sdb 为例，根据实际情况替换）
sudo dd if=armbian-build/build/output/images/Armbian_xxx.img \
    of=/dev/sdb bs=4M status=progress conv=fsync
```

**批量烧录 100 张 SD 卡**（使用多个读卡器并行）：

```bash
# 脚本示例：并行烧录到所有 /dev/sd[b-f]
IMG=$(ls armbian-build/build/output/images/*.img | head -1)
for DEV in /dev/sdb /dev/sdc /dev/sdd; do
    sudo dd if="$IMG" of="$DEV" bs=4M status=none conv=fsync &
done
wait
echo "所有 SD 卡烧录完成"
```

---

## 三、构建产物说明

| 路径 | 内容 |
|------|------|
| `output/images/*.img` | 可直接烧录的完整系统镜像 |
| `output/images/*.img.xz` | 压缩版（如开启 `COMPRESS_OUTPUTIMAGE=yes`） |
| `output/debs/` | 构建过程中产生的 .deb 包（含内核、驱动） |

---

## 四、镜像内容说明

烧录后的系统包含：

| 组件 | 版本/说明 |
|------|-----------|
| Debian | trixie (Debian 13) |
| Kernel | Rockchip vendor kernel（优化版） |
| nginx | 反向代理（监听 10077，WebSocket → xray） |
| xray | 最新 arm64 版（VLESS+WS，监听 10079） |
| cloudflared | 最新 arm64 版 |
| frpc | 0.67.0 arm64 |
| easytier-core | v2.4.5 arm64 |
| Tailscale | 官方 apt 源安装 |
| 防火墙 | UFW + fail2ban（UFW 日志默认关闭） |
| 监控 | Prometheus Node Exporter |
| ramlog | armbian-ramlog（日志写入 RAM，128M，rsync 落盘） |
| zram | armbian-zram-config（zstd 压缩 swap） |

**嵌入镜像的凭证**（来自 `.env`）：

```
/etc/hive/config.env    — CF Token、Tailscale OAuth、EasyTier 等
/etc/frp/frpc.toml      — FRP 服务端地址和认证
```

---

## 五、常见构建问题

### 构建中途失败

```bash
# 查看详细错误
cat armbian-build/build/output/debug/compilation.log | tail -100

# 清理后重试（保留 ccache 缓存）
rm -rf armbian-build/build/output/
./scripts/build.sh
```

### ccache 统计

```bash
ccache -s    # 查看命中率和缓存大小
ccache -C    # 清空缓存（通常不需要）
```

### 磁盘空间不足

Armbian 构建过程会缓存大量文件：

```bash
# 查看各目录占用
du -sh armbian-build/build/cache/
du -sh armbian-build/build/output/

# 清理下载缓存（会导致下次重新下载）
rm -rf armbian-build/build/cache/
```

---

## 六、二次构建（仅更新脚本）

如果只修改了脚本（不改内核或依赖），可以避免完整重编译：

```bash
# 更新 userpatches
rsync -a armbian-build/userpatches/ armbian-build/build/userpatches/

# 重跑 customize-image 阶段（Armbian 支持 --skip-kernel）
cd armbian-build/build
./compile.sh build BOARD=nanopi-zero2 BRANCH=vendor RELEASE=trixie \
    SKIP_EXTERNAL_TOOLCHAINS=yes \
    COMPRESS_OUTPUTIMAGE=yes
```

---

## 七、QEMU 验证（可选）

在实体硬件之前，可先在 QEMU 中验证镜像逻辑：

```bash
# 构建 QEMU 兼容镜像（UEFI arm64）
./scripts/build-qemu.sh

# 启动 QEMU 虚拟机
./scripts/run-qemu.sh
```

> QEMU 镜像仅用于测试 provision 脚本逻辑，硬件驱动（HDMI、USB、PWM 等）不可用。
