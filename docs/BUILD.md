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
| `CF_API_TOKEN` | Cloudflare Dashboard | 见服务端部署文档 |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard | 同上 |
| `CF_ZONE_ID` | Cloudflare Dashboard | 同上 |
| `CF_DOMAIN` | 你的域名 | 同上 |
| `TAILSCALE_OAUTH_SECRET` | Tailscale Admin Console | 见服务端部署文档 |
| `FRP_SERVER_ADDR` | 境外 VPS IP | 见服务端部署文档 |
| `FRP_AUTH_TOKEN` | frps.toml 里的 token | 同上 |
| `EASYTIER_PEERS` | 境外 VPS IP | 同上 |
| `EASYTIER_NETWORK_NAME` | 自定义 | — |
| `EASYTIER_SECRET` | 自定义 | — |
| `NODE_REGISTRY_URL` | 中国 VPS 域名 | 见服务端部署文档 |

---

## 二、首次构建流程

### 步骤 1：克隆仓库

```bash
git clone https://github.com/SakuraPuare/Hive hive
cd hive
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
| `xray` | WebSocket 流量转发核心 |
| `cloudflared` | Cloudflare Tunnel 客户端 |
| `frpc` | FRP 客户端（SSH 应急隧道） |
| `easytier-core` | P2P mesh 网络 |

下载均来自各项目 GitHub Releases，可通过环境变量指定版本：

```bash
XRAY_VER=v26.2.6 CLOUDFLARED_VER=2026.2.0 ./scripts/download-binaries.sh
```

### 构建下载加速（大陆网络）

构建期的下载分四类，前三类已自动走镜像：

| 内容 | 来源 | 处理 |
|------|------|------|
| apt / debootstrap 包 | `mirrors.tuna.tsinghua.edu.cn` | `REGIONAL_MIRROR=china`，本地构建默认开启 |
| mainline 内核 git 源 | `mirrors.tuna.tsinghua.edu.cn/git/linux-stable.git` | 同上（等价于 `MAINLINE_MIRROR=tuna`） |
| u-boot / kernel 裸树包 | `ghcr.io`（411 MiB / 331 MiB，full 3.7 GiB） | `scripts/fetch-gitballs.sh` 预取，走 `ghcr.nju.edu.cn` |
| rootfs 缓存包 | `ghcr.io/armbian/os/rootfs-arm64-trixie-cli`（约 252 MiB） | 同上，按框架打印的 tag 预取 |
| GitHub Releases 二进制、厂商内核分支、rkbin | `github.com` | 直连；`download-binaries.sh` 用 `~/.cache/hive-binaries` 持久缓存 |

实测（构建机 192.168.100.162）：`ghcr.io` 约 150 KB/s，u-boot 包要 45 min；`ghcr.nju.edu.cn` 同一个 blob 50 MB/s，约 8 s；TUNA apt 20 MB/s；GitHub Releases 约 0.4 MB/s。

如果构建机 IP 被 TUNA 封禁（表现为 apt 与 git 来源全部 `403 Forbidden`，本机正常），在 `.env` 里设 `REGIONAL_MIRROR=aliyun`：`build.sh` 会用 `scripts/armbian-mirror-preset.py` 幂等补一份 aliyun 预设进框架（Armbian 只内置 china/bfsu，框架重装后会自动补回），apt 走 `mirrors.aliyun.com`（实测 10 MB/s），mainline 内核 git 回落 `kernel.org`。

框架自带的镜像开关这三个都用不了，所以 `build.sh` 把它们钉在官方值，改用下面的预取：

- `GHCR_MIRROR=nju`：oras 要先向 `<mirror>/token` 换 token，nju 没有这个端点（404），oras 判 not_found 后仍回落到 `ghcr.io` 慢速直连。
- `UBOOT_MIRROR` 的 china 预设：把 u-boot 源换成第三方镜像，该镜像匿名克隆返回 401；`orangepi4-lts` 的 `BOOTSOURCE` 直接取自它，所以 `build.sh` 把这个值硬钉成 `github`（不可被 `.env` 覆盖）。
- `GITHUB_MIRROR=ghproxy`：ghfast.top 对 release 资产只回 302 指回 GitHub，实测 473 KB/s，直连 418 KB/s，等于没有加速。

`build.sh` 每次构建前都会预取（幂等，已就绪时只读标记文件）。也可以单独跑：

```bash
./scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current    # u-boot + kernel 6.18 shallow
./scripts/fetch-gitballs.sh --board nanopi-r28s  --branch vendor     # kernel 6.1
./scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current --kernel-git full
./scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current --dry-run
./scripts/fetch-gitballs.sh --board nanopi-zero2 --branch current \
    --rootfs-ref armbian/os/rootfs-arm64-trixie-cli:202611-93ad2762aa82-H6eccde-B5416c2   # rootfs 包显式 tag
```

- 包按 manifest 的 sha256 校验后放进 `cache/git-bundles/{u-boot,kernel}/`；框架在 `lib/functions/general/git-oras-tree.sh` 里见到该文件存在就完全不联网。
- 主拷贝留在 `~/.cache/hive-gitballs`（`HIVE_GITBALL_CACHE` 可改）。框架提取完会删掉 `cache/git-bundles` 下那份，下次从主拷贝直接装回。
- 内核版本不硬编码：脚本用 `compile.sh configdump` 读 `KERNEL_MAJOR_MINOR`，与框架实际判定一致。
- 镜像默认 `ghcr.nju.edu.cn`；换镜像或强制直连用 `HIVE_GHCR_MIRROR=<host>|direct`。
- rootfs 缓存包也是 ghcr.io 上的 OCI 工件，走 oras，失败会直接让构建以 `ERROR 43` 中止（`ARTIFACT_IGNORE_CACHE=yes` 能绕过，但会把内核一起重编）。框架的本地缓存判定只看 `cache/rootfs/rootfs-<arch>-<release>-<type>_<tag>.tar.zst` 是否存在，所以脚本按同样方式预取；tag 由框架的 `rootfs_cache_id` + `yyyymm` 决定，框架升级会变（26.08→26.11 时 `…-Bc08fea` 变成 `…-B5416c2`），默认从框架自己打印的日志里取（顶层日志没有就扫最近的归档），全新机器没有历史日志时用 `--rootfs-ref` 显式给 tag（`./compile.sh rootfs` 或 registry 的 tags 列表都能看到）。
- 预取失败不会让构建失败，只是回落到 ghcr.io 慢速直连。
- 境内/境外的判断看 `GITHUB_SERVER_URL`（只有 GitHub 官方 runner 是 `https://github.com`），不看 `GITHUB_ACTIONS`：自托管 `develop` runner 同样会导出 `GITHUB_ACTIONS=true`，按它判断会让境内 CI 走官方源。

仍直连的部分：Docker 基础镜像 `ghcr.io/armbian/docker-armbian-build:*`（仅首次）、GitHub Releases 上的 xray/mihomo/frp 等（有持久缓存）、`rockchip-linux/rkbin`、R28S 的厂商内核分支 `github.com/armbian/linux-rockchip`。确实慢时给 `git`/`curl` 设 `https_proxy`（框架用 `env -i` 跑 oras 时也会透传 `http_proxy`/`https_proxy`/`HTTP_PROXY`/`HTTPS_PROXY`）；Docker 守护进程拉镜像要另外在 `/etc/docker/daemon.json` 或 systemd drop-in 里配代理。

### 步骤 5：构建镜像

```bash
./scripts/build.sh
```

构建脚本会：
1. 根据 CPU 核数自动设置并行编译线程
2. 渲染配置模板（`config.env`, `frpc.toml`）
3. 同步 userpatches 到 Armbian build 目录
4. 预取 GHCR 上的 u-boot / kernel 裸树包与 rootfs 缓存包（见上节，幂等）
5. 调用 `compile.sh` 完成完整构建

首次构建约需 30-90 分钟（视机器性能）。后续构建因 ccache 缓存通常只需 10-20 分钟。

> **A/B 构建（`HIVE_AB=yes`）的两条缓存陷阱**，改构建流程前先看：
> 1. `u-boot` 的 artifact 缓存键里没有 `HIVE_AB`（`lib/functions/artifacts/artifact-uboot.sh` 的
>    `artifact_input_variables` 只含 BOOT* 与 BOARD/BRANCH/ARCH），所以同一工作区里先跑过普通构建，
>    A/B 构建就会复用一个**没有 A/B 环境**的 bootloader。`build.sh` 在建厂阶段前会检查
>    `userpatches/overlay/usr/lib/hive/uboot-env`（u-boot 编译 hook 的产物）是否还在：不在就删掉该板子的
>    u-boot deb 强制重编。少了这条，问题要到出厂镜像阶段才由 `check-uboot-env.sh` 暴露，前面两小时白做。
> 2. 上面那次 `rsync --delete` 每次构建都会清掉框架 `userpatches/`（包括上面的 stamp），所以 stamp 的
>    生命周期只有一次构建；命中缓存的 u-boot 不会重新生成它。

**自定义构建参数**：

```bash
# 指定开发板 profile（默认 nanopi-zero2）
./scripts/build.sh nanopi-zero2   # NanoPi Zero2  (RK3528)
./scripts/build.sh nanopi-r3s     # NanoPi R3S    (RK3566)
./scripts/build.sh orangepi4-lts  # 香橙派 Pi 4 LTS (RK3399)

# 内核源码获取方式（默认 shallow；需要完整历史/bisect 时才用 full）
KERNEL_GIT=full ./scripts/build.sh nanopi-zero2
```

> 内核精简 config 由 `configs/kernel/<profile>.sh` 在构建时生成，写入
> `userpatches/config/kernel/<LINUXCONFIG>.config`，Armbian 按文件名自动优先采用。
> 如需交互式调整内核选项，用 Armbian CLI 独立命令（`KERNEL_CONFIGURE=yes` 旧用法已废弃）：
>
> ```bash
> cd armbian-build/build
> ./compile.sh kernel-config BOARD=orangepi4-lts BRANCH=current   # 进 menuconfig
> ./compile.sh config-dump   BOARD=orangepi4-lts BRANCH=current   # 查看解析后的全部变量
> ```

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
| `output/images/*.img.xz` | 压缩版（CI 默认 `COMPRESS_OUTPUTIMAGE=sha,xz`，balenaEtcher / rpi-imager 可直接烧录，无需解压）|
| `output/debs/` | 构建过程中产生的 .deb 包（含内核、驱动） |

---

## 四、镜像内容说明

烧录后的系统包含：

| 组件 | 版本/说明 |
|------|-----------|
| Debian | trixie (Debian 13) |
| Kernel | Rockchip vendor kernel（优化版） |
| nginx | 反向代理（监听 10077，WebSocket → xray） |
| xray | 最新 arm64 版（WebSocket 转发，监听 10079） |
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
