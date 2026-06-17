# Hive OTA 升级方案调研

> 状态：调研 / 决策文档（非实现）
> 更新：2026-06-17
> 范围：Hive 边缘节点（NanoPi Zero2 / RK3528、NanoPi R3S / RK3566、Orange Pi 4 LTS / RK3399），约 11 节点，Tailscale 组网，已有 Go registry 后端。

## 1. 目标

为 Hive 节点设计一套可远程升级（OTA）的机制，要求：

- 能远程升级节点上的**业务二进制**（xray / cloudflared / frpc / easytier-core）与配置
- 能远程升级**系统层**（内核、系统包）——低频，可接受有人值守
- 失败可回滚、尽量不变砖
- 控制平面可观测：知道每个节点当前版本、谁需要升级、升级是否成功
- 改造成本与 11 节点（可扩展到几十/上百）的实际规模相匹配

## 2. 当前架构与升级现状（约束来源）

这一节决定了后续所有取舍，必须先讲清楚 Hive 现在长什么样。

### 2.1 镜像与文件系统

- 基于 **Armbian（Debian trixie，ARM64）** 构建，构建定制在 `armbian-build/userpatches/customize-image.sh`。
- **标准单 ext4 分区，可写，无 A/B、无只读 rootfs**。
- 业务负载是**裸二进制 + systemd**，不是容器：
  - `xray`（VLESS+WS 代理核心）`/usr/local/bin/xray`
  - `cloudflared`（CF Tunnel）
  - `frpc`（FRP 客户端 0.67.0）
  - `easytier-core`（P2P mesh v2.4.5）
  - `tailscaled`、`nginx`、`prometheus-node-exporter`
- 这些二进制在构建期按固定版本下载并烧入镜像。

> **关键结论：Hive 不是容器化负载。** 通用 OTA 调研中"用 watchtower / 自建 registry 做容器层 OTA"的路径在这里不直接适用——Hive 的"应用层 OTA"本质是**替换 `/usr/local/bin/` 下的二进制 + 重启对应 systemd 服务**。

### 2.2 首次部署（provisioning）

- `provision-node.service`（Type=oneshot，`ConditionPathExists=!/etc/hive/provisioned`）→ `/usr/local/bin/provision-node.sh`。
- 基于 MAC 确定性生成身份：hostname、SSH host key、xray UUID、FRP 端口、EasyTier IP。
- 创建 CF Tunnel / DNS、加入 Tailscale（OAuth → pre-auth key）、起核心服务、`POST /api/nodes/register` 上报，最后 `touch /etc/hive/provisioned` 自禁用。
- **重要复用点**：节点已有一套幂等的"下载二进制 → 配置 → 起服务"的 first-boot 编排逻辑。OTA 的二进制替换可沿用同一套模式。

### 2.3 当前升级机制

- 主要靠 **Ansible**（`ansible/`，Tailscale 动态 inventory，tag:hive，20 并发）。
- 已有 playbook：`ping`、`restart-services`、`service-status`、`upgrade-from-v1.0`（sysctl 去重 + 多镜像 apt 源）。
- 系统安全更新由镜像内 `unattended-upgrades` 自动处理。
- **没有持续运行的升级 agent，没有版本下发/灰度编排。** 升级 = 人工跑 ansible 推送。

### 2.4 registry 控制平面

- `management/registry`（Go 1.25 + GORM + MySQL），节点通过 `/api/nodes/register` 注册。
- **`nodes` 表没有版本字段**（无 `os_version` / `image_version` / 各业务二进制版本），不记录心跳上报的版本，没有任何"分发更新"相关端点。
- v1.0.0 节点不主动上报版本——这是控制平面的现有短板。

### 2.5 网络连通性

- 节点**无公网 IP**。管理面三层：**Tailscale（主，加密、可达 NAT 内网）**、EasyTier mesh（备）、FRP（应急 SSH）。
- CF Tunnel 仅用于把业务服务暴露给最终用户，不用于管理。
- OTA payload 必须走 Tailscale 分发（Ansible 已在用此通道）。

### 2.6 约束汇总

| 维度 | 现状 | 对 OTA 的影响 |
|---|---|---|
| 分区布局 | 单分区，无 A/B | 系统级无缝 A/B 需重做分区表 + 改 U-Boot 引导链 |
| rootfs | 可写，非只读 | 可原地替换文件/包 |
| 负载形态 | 裸二进制 + systemd | "应用 OTA" = 换二进制 + restart，非容器 |
| 节点 agent | 无 | 需新增 agent 或继续用 ansible |
| 版本追踪 | registry 无版本字段 | 需先加字段/表 |
| 规模 | ~11，可扩展 | 并发压力小，可串行/轮询 |
| 网络 | 无公网 IP，Tailscale 主通道 | payload 走 Tailscale |
| 业务中断容忍 | 代理服务要高可用 | 优先 reload，必要时短重启 |

## 3. OTA 方案两大范式

- **系统级 / 镜像级（image-based）**：整 rootfs 当不可变工件替换。代表 RAUC、SWUpdate、Mender、OSTree、bootc、balenaOS。原子性强、整机可回滚、状态可重现；但**几乎都要求 A/B 双分区**，需改分区布局 + bootloader。
- **包级 / 应用级**：系统不变，只更新包或二进制/容器。代表 apt + 自建仓库、ansible、容器层工具。改造接近零、增量天然、回滚灵活；但系统层（内核 / bootloader / libc）升级无原子性，中断易变砖。

Armbian 默认 **单分区 ext4 + U-Boot/extlinux**，这一前提决定：系统级 A/B 方案都要重设计分区表并改造引导链（且 RK3528/RK3566 是非主流 BSP，每种板子分别适配），而应用层方案几乎可直接落地。

## 4. 候选方案对比

### 4.1 系统级 A/B / 原子方案

**RAUC**（LGPL-2.1，活跃）
- A/B 整分区镜像，签名 `.raucb` bundle，写非活动 slot 后重启切换。
- Rockchip 集成有 Konsulko 在 RK3399 的实战参照：A/B rootfs + data + boot 分区，`boot.scr` 处理切换并传参给 `extlinux.conf`，内核命令行带 `rauc.slot=`。支持 U-Boot/Barebox/GRUB/EFI Boot Guard；U-Boot 用 `bootcount`/`altbootcmd` 自动回退。
- **无内置服务端**，官方配 hawkBit；也可用任意 HTTP 服务器 + 自写编排（对"已有 Go registry"友好）。
- 改造 Armbian **难度高**：单分区镜像要重做分区表 + 改 U-Boot 脚本 + rootfs 无状态化；社区案例几乎全是 Yocto/Buildroot，纯 Debian 手工集成缺现成模板。
- 来源：rauc.io、konsulko.com/rauc-on-rockchip、rauc.readthedocs.io

**Mender**（Apache-2.0 open-core，Northern.tech）
- A/B rootfs，`.mender` Artifact。**delta 增量、RBAC、分批/分阶段编排、审计在商业/企业版**，开源版只有全量 A/B。
- **`mender-convert`** 可把现有 Debian 磁盘镜像转成双 rootfs + U-Boot 引导——在 A/B 方案里对"已有 Armbian 加 A/B"路径最短；但我们三块板（RK3528/RK3566/RK3399）全是 Rockchip，无 mender 官方现成路径，均需自适配 U-Boot。
- 自带服务端（开源 + hosted/enterprise）。收购后产品重心持续上移到企业资产管理（2026-06 发布 Steward）。

**SWUpdate**（GPLv2/LGPL，活跃，Debian 已打包）
- 工件 `.swu`（cpio）。支持双拷贝 A/B，也支持**单拷贝**（initrd 内原地刷，不强制双分区，但更新期不可用、回滚弱）。
- 内置 **suricatta** 守护，原生对接 hawkBit，支持断点续传。功能面最广（eMMC/UBI/单文件、压缩、加密、Lua handler、防降级）。
- 改造 Armbian **中到高**；sw-description 配置学习曲线比 RAUC 陡。

**Eclipse hawkBit**：仅作 OTA 后端/部署服务器（配 SWUpdate/RAUC），灰度/分批管理强，但是重型 JVM 服务、官方 UI 已废弃。**Hive 已有 Go registry，重复造重型依赖，不推荐。**

**OSTree / bootc / rpm-ostree**：OSTree 类 git 的原子文件树升级，但 Debian 非主流、改造重；rpm-ostree/bootc 是 RPM 系，**Debian 不可用**。不适用。

**balenaOS / balenaCloud**：容器化整机管理体验好，但要**替换 Armbian**、RK 板需移植。不适用。

**fwup**：轻量固件刷写工具，常作上面方案的底层组件，本身不含编排。

### 4.2 应用级 / 包级方案（更贴合 Hive）

**Ansible（现有资产）**：Tailscale 动态 inventory 已就绪。换二进制 + restart 完全可做。缺点：推送式、无节点自报状态、无原子回滚、无灰度——但 11 节点可人工兜底。

**自建 APT 仓库 + apt**：把业务二进制打成 deb，节点 `apt upgrade`。增量天然、与 `unattended-upgrades` 一致。系统层升级仍无原子性（内核/libc 中断可变砖），需人工值守。

**容器层 OTA（watchtower / Diun / 自建拉取 / k3s+FluxCD）**：
- ⚠️ **watchtower 已于 2025-12 归档，不要采用。**
- **前提是业务容器化**。Hive 当前是裸二进制，要先把 xray/cloudflared/frpc/easytier 容器化才适用——这是一笔独立的改造账，不是免费的。
- k3s + FluxCD 编排天花板最高，但对当前 11 节点偏重，属"为扩展预留"的演进路径。

## 5. 对比表

| 方案 | 机制 | 防变砖/回滚 | 服务端/编排 | 改造 Armbian 难度 | 许可 | 适配 Hive |
|---|---|---|---|---|---|---|
| RAUC | 系统 A/B | 强（bootcount 自动回退） | 无（配 hawkBit / 自建） | 高 | LGPL-2.1 全开源 | 系统级，重 |
| Mender | 系统 A/B | 强 | 有（增量/编排在商业版） | 中（mender-convert） | Apache-2.0 open-core | 系统级最短路径 |
| SWUpdate | A/B 或单拷贝 | 中~强 | 配 hawkBit | 中~高 | GPLv2/LGPL | 系统级，灵活但陡 |
| hawkBit | 后端编排 | — | 强 | — | EPL | ✗ 与 registry 重复 |
| OSTree | 原子文件树 | 强 | 自建 | 高（Debian 非主流） | LGPL | ✗ |
| bootc/rpm-ostree | 镜像原子 | 强 | — | — | — | ✗ Debian 不可用 |
| balenaOS | 容器整机 | 强 | 强（balenaCloud） | 极高（换 OS） | 混合 | ✗ |
| Ansible（现有） | 推送换二进制 | 弱（人工） | 推送式无自报 | 零 | — | ✓ 立即可用 |
| 自建 APT | 包级 apt | 弱（系统层） | 无 | 低 | — | ✓ 增量友好 |
| 容器层（k3s/Flux） | 容器滚动 | 中~强 | 强 | 中（需先容器化） | OSS | △ 需先容器化 |

## 6. 推荐：分层混合策略

**核心判断**：在 ~11 节点、单分区 Armbian、非主流 RK BSP、且高频变更是业务二进制而非内核的前提下，**上来就做系统级 A/B OTA，改造成本与收益严重不成比例**（为每种 RK 板从单分区改造可靠的 A/B + bootcount 自动回滚是数周到数月的引导链工程）。应优先把工程投入花在"让 registry 成为部署编排中心 + 可靠地换业务二进制"上。

### 第 1 选择（推荐先做）：业务二进制 OTA + registry 编排 + ansible 兜底

- **控制平面**：给 `nodes` 表加版本字段（`image_version` + 各业务二进制版本），registry 新增"期望版本（desired）"配置与"当前版本上报（actual）"端点。registry 已在做节点管理，扩展自然。
- **节点侧 agent**：轻量 `hive-agent`（systemd timer 周期触发，沿用 provision 脚本的下载-校验-原子替换-重启模式）向 registry 拉取期望版本，比对后下载（走 Tailscale）、**校验签名/哈希**、原子替换 `/usr/local/bin/<bin>`（写临时文件 + rename）、`systemctl reload-or-restart`，上报结果。失败保留旧二进制即回滚。
- **系统层**：继续用现有 **ansible + unattended-upgrades** 维护内核/系统包，低频、有人值守，接受其无原子性（11 节点可人工修砖）。
- 理由：改造成本接近零、复用 registry + Tailscale + ansible 全部现有资产、业务迭代快且失败不变砖、可平滑扩展。
- ⚠️ **安全要点**：OTA 通道必须做**工件签名校验**（节点内置公钥，registry 侧签名），否则下发二进制等于远程任意代码执行。Tailscale 加密传输不能替代工件完整性校验。

### 第 2 选择（扩展期演进）：k3s + FluxCD / Rancher Fleet

- 当节点数与应用复杂度上升、需要声明式灰度/健康检查/自动回滚时，先把业务**容器化**，再纳入轻量 k3s + GitOps。编排天花板最高。
- 代价：需先容器化 + k3s 运维复杂度，对当前规模偏重，作为未来路径而非现在上。

### 第 3 选择（若确需系统级原子升级）：Mender 开源版（走 mender-convert）

- A/B 方案里对"已有 Armbian 加 A/B"路径最短，自带服务端。
- 坑：① 增量/精细编排在商业版，开源版只全量 A/B；② RK3528/RK3566/RK3399 均需自适配 U-Boot（三块全是 Rockchip，无 mender 现成路径）。
- 仅当确认未来会频繁推送内核/整机更新且必须原子可回滚时投入。

### 第 4 选择：RAUC + 让 registry 充当分发/编排后端

- 坚持系统级 A/B 且要完全开源无商业 gate、愿投引导链工程时，技术上最干净，且 Go registry 可直接当 bundle 分发后端（替代 hawkBit）。
- 排 Mender 之后仅因无 mender-convert 那样的现成 Debian 镜像转换，Armbian 起步成本更高。

**不推荐**：hawkBit（与 registry 重复、UI 废弃）、balenaOS（换 OS）、bootc/rpm-ostree/OSTree（Debian 不适用/改造重）、watchtower（已归档）。

## 7. 一句话结论

**先做"业务二进制 OTA（hive-agent 向 Go registry 拉取期望版本、签名校验、原子替换、上报）+ 系统层 ansible/apt 兜底"的混合方案**，把投入花在让 registry 成为编排中心；**系统级 A/B（Mender 开源版优先，其次 RAUC）作为后续可选演进**，仅在确需内核/整机原子回滚时再上。这样既规避单分区 Armbian + 杂牌 RK 板做 A/B 的高成本，又复用了 registry/Tailscale/ansible 资产，并保留向 k3s/FluxCD 扩展的空间。

## 8. 落地需要的最小改动（供后续实现参考，本文不实现）

1. `nodes` 表加版本字段；registry 加 desired/actual 版本端点与签名分发端点。
2. 节点侧 `hive-agent`（systemd timer）：拉取 → 校验签名 → 原子替换 → reload-or-restart → 上报。
3. 构建期内置 OTA 公钥；发布流程对二进制签名。
4. registry-ui 加节点版本视图与"设置期望版本"操作（支持按节点/分批灰度）。

