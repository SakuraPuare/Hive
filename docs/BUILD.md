# 镜像构建指南

本文档描述如何从零开始构建 Hive Node 的 Armbian 镜像，并烧录到 SD 卡。

---

## 一、前提条件

### 构建主机要求

| 项目 | 最低要求 | 推荐 |
|------|----------|------|
| 操作系统 | Ubuntu 22.04 / Debian 12 | Ubuntu 22.04 LTS |
| CPU 核数 | 4 核 | 8 核以上（冷编译仍随核数变化） |
| 内存 | 8 GB | 16 GB（可启用 tmpfs 加速） |
| 磁盘空间 | 50 GB | 100 GB SSD |
| 网络 | 可访问 GitHub | 国际出口带宽越大越快 |

### 主机依赖

```bash
# Armbian 构建系统依赖（ccache 包在这里；能否加速取决于 build.sh 传入的扩展，见「ccache」）
sudo apt install -y \
    git curl wget jq \
    build-essential python3 \
    ccache unzip zip \
    qemu-user-static binfmt-support \
    debootstrap
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

NanoPi R3S LTS 要求框架包含以下上游文件；`build.sh` 会逐项检查，缺失时要求更新框架并停止构建，避免旧框架静默缺板：

- `config/boards/nanopi-r3s-lts.conf`
- `patch/kernel/archive/rockchip64-6.18/dt/rk3566-nanopi-r3s-lts.dts`
- `patch/u-boot/v2026.04/board_nanopi-r3s-lts/Add-board-NanoPi-R3S-LTS.patch`

LTS 设备树由 Armbian 的 6.18 patch 目录提供，不是 Linux 6.18 原生板级支持；U-Boot 沿用上游 LTS 的 v2026.04 板级补丁。

### 步骤 4：下载 arm64 二进制

```bash
./scripts/download-binaries.sh
```

脚本把 GitHub Releases 的当前 latest 放进 overlay，不接受 `XRAY_VER`、`CLOUDFLARED_VER` 这类版本变量：

| 落点 | 内容 |
|------|------|
| `overlay/usr/local/bin/` | `xray`、`frpc`、`easytier-core`、`mihomo`、`xray-exporter` |
| `overlay/var/www/metacubexd/` | metacubexd 静态面板 |
| `overlay/var/cache/hive-debs/` | cloudflared 与 Cloudflare WARP 的当前 arm64 deb（按官方 Packages 索引） |

xray、frpc、easytier、mihomo 先解析各仓库 `releases/latest` 的 tag，再按版本化文件名写入 `~/.cache/hive-binaries`（`BIN_CACHE_DIR` 可改目录，`BIN_CACHE_REFRESH=1` 强制重下）。tag 解析失败且没有缓存时，对应组件下载失败。cloudflared / WARP 的 deb 版本来自官方索引，不是写死的版本号。

### 构建下载加速（大陆网络）

构建期的下载分四类，前三类已自动走镜像：

| 内容 | 来源 | 处理 |
|------|------|------|
| apt / debootstrap 包 | `mirrors.tuna.tsinghua.edu.cn` | `REGIONAL_MIRROR=china`，本地构建默认开启 |
| mainline 内核 git 源 | `mirrors.tuna.tsinghua.edu.cn/git/linux-stable.git` | 同上（等价于 `MAINLINE_MIRROR=tuna`） |
| u-boot / kernel 裸树包 | `ghcr.io`（411 MiB / 331 MiB，full 3.7 GiB） | `scripts/fetch-gitballs.sh` 预取，走 `ghcr.nju.edu.cn` |
| rootfs 缓存包 | `ghcr.io/armbian/os/rootfs-arm64-trixie-cli`（约 252 MiB） | 同上，按框架打印的 tag 预取 |
| GitHub Releases 二进制（xray/mihomo/frp/easytier/xray-exporter/metacubexd）、厂商内核分支、rkbin | `github.com` | 直连；`download-binaries.sh` 用 `~/.cache/hive-binaries` 持久缓存（缓存键带版本） |
| Tailscale apt 源 | `pkgs.tailscale.com`（13 MiB） | `customize-image.sh` 改用 `mirrors.ustc.edu.cn/tailscale/debian`（备 `mirror.nju.edu.cn`），签名 keyring 仍取官方 3 KB |
| Cloudflare WARP | `pkg.cloudflareclient.com`（77 MiB，**没有任何国内镜像**） | `download-binaries.sh` 预取 deb 到 overlay，构建时本地安装 |
| cloudflared | `pkg.cloudflare.com/cloudflared`（18.3 MiB deb，**没有国内镜像**） | 优先 apt 装（`any` 套件）；apt 拉不到时回落到 `download-binaries.sh` 预取的同一份 deb |

实测（构建机 192.168.100.162）：`ghcr.io` 约 150 KB/s，u-boot 包要 45 min；`ghcr.nju.edu.cn` 同一个 blob 50 MB/s，约 8 s；TUNA apt 20 MB/s；GitHub Releases 约 0.4 MB/s。Tailscale 的 13 MiB deb：官方 457 KB/s（29 s）、USTC 3.2 MB/s（4 s）、NJU 19 MB/s（0.7 s）；Cloudflare WARP 77 MiB：官方约 478 KB/s（≈2.7 min），无镜像可换。

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
- Tailscale 源由 `customize-image.sh` 现场探测：USTC → NJU → 官方，取第一个能拉到 `dists/${RELEASE}/Release` 的；两个镜像的 `Packages.gz` 与官方逐字节一致（USTC 最新、NJU 快但滞后约两周），所以 apt 的签名校验不受影响。
- cloudflared 走官方 apt 源 `https://pkg.cloudflare.com/cloudflared`（套件用 `any`：该仓库只有 any/bookworm/jammy/noble/focal，没有 trixie；二进制是静态 Go）。deb 18.3 MiB，比 raw 二进制 37.7 MiB 少一半，且版本与校验和进 apt 索引；包内 postinst 会建 `/usr/local/bin/cloudflared` 软链，所以老路径仍可用（`cloudflared.service` 里的 ExecStart 已改为 `/usr/bin/cloudflared`）。实测 516 KB/s，没有国内镜像。
- cloudflared 的安装是「apt 优先、失败回落」：仓库密钥下载或校验失败时跳过该源，不中止构建；`customize-image.sh` 先尝试 `apt-get install cloudflared`，失败才用 `/var/cache/hive-debs/cloudflared_*_arm64.deb`（`download-binaries.sh` 按官方 Packages 预取、校验 sha256）；两者都没有才硬失败。
- 构建前只检查 overlay 预置的裸二进制，不要求 `overlay/usr/local/bin/cloudflared`；cloudflared 在 chroot 安装后由 `customize-image.sh` 校验 `/usr/bin/cloudflared`，缺失仍会中止构建。
- Cloudflare WARP 没有镜像：实测 TUNA / USTC / NJU / ZJU / CERNET / PKU / SJTU / SUSTech / aliyun / tencent / huawei 全 404。`./scripts/download-binaries.sh` 按官方 `Packages.gz` 解析当前 arm64 版本、校验 sha256 后放进 `userpatches/overlay/var/cache/hive-debs/`（已 gitignore），`customize-image.sh` 命中本地 deb 就不走官方源、装完删除；预取失败自动回落到官方源。
- Cloudflare 的 `Packages.gz` 索引每次预取都会刷新并校验 gzip，只有获取失败时才回退上一次的索引；deb 按版本化文件名长期缓存，因此能发现新版，也不会重复下载同版本包。
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
5. 调用 `compile.sh`，并传入 `ENABLE_EXTENSIONS=ccache`

内核在 ccache 没有命中时，脚本注释里的一次实测大约 66 分钟。`build.sh` 现已传入 `ENABLE_EXTENSIONS=ccache`，缓存开始命中之后编译段会缩短。只安装 ccache、仍传 `USE_CCACHE=yes` 时，编译不会进缓存。

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
./scripts/build.sh nanopi-r3s-lts # NanoPi R3S LTS (RK3566，独立板型)
./scripts/build.sh orangepi4-lts  # 香橙派 Pi 4 LTS (RK3399)

# 内核源码获取方式（默认 shallow；需要完整历史/bisect 时才用 full）
KERNEL_GIT=full ./scripts/build.sh nanopi-zero2
```

NanoPi R3S LTS 的 canonical profile 是 `nanopi-r3s-lts`，与 `nanopi-r3s` 不同；镜像和固件包不可混刷。它使用 `current` / `linux-rockchip64-current`（6.18），Cortex-A55 编译优化，独立 DTB `rockchip/rk3566-nanopi-r3s-lts.dtb`，串口为 `ttyS2,1500000`。内核配置映射到现有 `configs/kernel/nanopi-r3s.sh`，沿用 headless 裁剪（无显示、音频和媒体子系统）。此适配尚未完成 R3S LTS 真机启动、双网口及 OTA 回切验收。

```bash
make build-r3s-lts                         # 普通镜像
make build-ab-r3s-lts VERSION=1.0.0        # 独立引导载荷 A/B 出厂镜像 + 系统 OTA 包
make build-all                            # 包含 R3S LTS 的所有普通板型镜像
```

A/B 构建仍需先生成并保留 OTA 签名密钥（`make gen-ota-keys`），`VERSION` 必填。R3S LTS 沿用 Hive 单根分区、独立数据分区和 `/boot` 内双份引导载荷的 A/B 方案，不是整套双 rootfs；首次接入需离线整盘刷写对应板型的出厂镜像。普通镜像 CI 的 `build-image.yml` 与 GitHub 分发入口 `request-image-build.yml` 均可选择 `nanopi-r3s-lts`，`all` 包含该板型。

适配验证：R3S LTS 独立固件打包、写入校验、试启动确认与回滚，以及 Zero2/R28S 兼容回归共 85 项通过；板型识别、DTB/串口渲染与 WAN 选择共 5 项通过。隔离交叉编译的 U-Boot v2026.04（叠加 Armbian LTS 补丁和 Hive A/B hook）通过非空 FIT 与冗余 MMC 环境门禁；6.18 LTS DTB 编译通过，看门狗节点可用。这不代表完整出厂镜像已构建或真机已验收。

> 内核精简 config 由 `configs/kernel/` 下映射的脚本在构建时生成（R3S LTS 复用 `nanopi-r3s.sh`），写入
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
| Kernel | 随 profile：`nanopi-zero2`、`nanopi-r3s`、`nanopi-r3s-lts`、`orangepi4-lts` 为 `current`（`linux-rockchip64-current`，6.18）；只有 `nanopi-r28s` 为 `vendor`（`linux-rk35xx-vendor`，6.1） |
| nginx | 反向代理（监听 10077，WebSocket → xray） |
| xray | WebSocket 转发，监听 10079；版本是 `download-binaries.sh` 解析到的 GitHub Releases latest |
| frpc、easytier-core、mihomo、xray-exporter | 同样取 GitHub Releases latest |
| cloudflared | 官方 apt（套件 `any`）；apt 失败时用预取的 deb |
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

### ccache

`./scripts/build.sh` 调用 `compile.sh` 时传入 `ENABLE_EXTENSIONS=ccache`，并在每次构建前把同一份配置写到两处：

- `armbian-build/build/cache/ccache/ccache.conf`
- root 的 ccache 目录（`compile.sh` 提权后，内核和 u-boot 读的是 `${CCACHE_DIR:-$HOME/.cache/ccache}/ccache.conf`，默认即 `/root/.cache/ccache`）

配置为 `max_size = 30G`、`sloppiness = time_macros,include_file_mtime,include_file_ctime,file_macro,locale`、`hash_dir = false`、`compiler_check = content`。Armbian 26.11 把入口从 `USE_CCACHE` 换成 compile-cache 扩展：`USE_CCACHE=yes` 只会打出 `USE_CCACHE / PRIVATE_CCACHE are ignored`，编译不经过 ccache，只剩链接。没有扩展时，`cache/ccache` 里测到 2668 次调用全部 uncacheable、命中 0。换上扩展后，u-boot 编译的 731 次调用走 ccache（首轮全 miss，65s→48s），之后的构建才会开始命中。

```bash
ccache -s -d armbian-build/build/cache/ccache
sudo ccache -s -d /root/.cache/ccache
```

对不带 `-d` 的默认目录执行 `ccache -C` 清不到这两处。

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

## 六、再次构建

改过 userpatches 或脚本后，直接再跑 `build.sh`。它会 `rsync -a --delete` 把 `armbian-build/userpatches/` 同步进框架，并带上 `ENABLE_EXTENSIONS=ccache`、`KERNEL_CONFIGURE=no`、`BUILD_DESKTOP=no`。

```bash
./scripts/build.sh nanopi-zero2
```

板型和分支由 profile 决定。额外参数里如果出现 `BOARD=`、`BRANCH=` 或 `HIVE_AB=`，脚本会退出。默认的 `nanopi-zero2` 是 `BRANCH=current`；只有 `./scripts/build.sh nanopi-r28s` 使用 `vendor`。

手工调用 `compile.sh` 时也要带 `ENABLE_EXTENSIONS=ccache`。`USE_CCACHE=yes` 在 Armbian 26.11 上不会让编译进入 ccache。

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
