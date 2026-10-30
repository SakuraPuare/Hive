# 已知问题清单（2026-10-29 状态核对）

范围：在 `8e4b904`（工作区干净、与 `origin/main` 一致）上重新核对代码、CI 运行记录与依赖状态，取代 2026-10-27 版本中的 CI 与依赖段落。此前内容（可信出口计费隔离、历史计数回收、OTA 存储回收、设备临时下载）保持不变，见"已实现"一节。

本次只做核对与文档更新，未改源码、未部署、未操作线上设备、未刷写 TF 卡。

## 上游变化（2026-10-27 推送之后）

2026-10-27 推送后的 `main` 新增 9 个提交，本次核对已包含：

| 提交 | 内容 |
|---|---|
| `b2743f1` / `8e4b904` | 新增 `management/registry{,-ui}` 的 K8s Dockerfile、`docs/DEPLOY-K8S.md`、`.dockerignore` |
| `a303035` / `335a9d1` | 容器基础镜像：Go 1.27.3、MySQL 8.4 |
| `57ba5e3` | `RequirePerm` 标记自动化凭证请求，`/subscription`、`/subscription/clash` 对自动化凭证导出全部节点 |
| `a4c392b` | 上述两条导出路由额外接受 `?token=`（仅这两条路径） |
| `76e3810` | 旧共享 `API_SECRET` 仅在这两条导出路由上继续可用，其他权限接口只认 `ADMIN_API_SECRET` |
| `5fda9e4` | `@testing-library/dom` 10.4.2 |
| `e04bb22` | 依赖总升级：Go 1.27、Next 16.4.3、React 19.3.1、TypeScript 7、Vitest 5、Node 24 镜像，actions 升到 v7/v8 |

## CI 状态（2026-10-29 核对）

| 工作流 | 结论 |
|---|---|
| Registry CI/CD | `8e4b904` **通过**（[run 40862465908](https://github.com/SakuraPuare/Hive/actions/runs/40862465908)）。自分支恢复以来 `57ba5e3`、`a4c392b`、`76e3810`、`335a9d1`、`e04bb22`、`8e4b904` 全部通过；失败集中在 2026-10-27 那批，已由 `18a2a20` 修复。 |
| Deploy Docs | 通过（同 SHA）。 |
| Cleanup Gitea Build Refs | **仍然每跑必失败**：2026-09-20 起 53 次运行全部失败，本轮 `5fda9e4` 同样失败。见下方 P2。 |
| Build Image | 最后一次 GitHub 运行在 2026-06-27（9 失败 / 3 成功）。该 workflow 现只在 Gitea 执行（`github.server_url != 'https://github.com'`），GitHub 侧的红叉是历史遗留。 |
| Request Image Build | 自加入以来 **没有任何运行记录**，从未被 dispatch 过，也没有发布过 release。 |

`CI (Frontend) Node 22` 里 "Pin npm 10" 一步显示 skipped，属预期（条件为 `matrix.node-version >= 24`，且 GitHub 的 skipped 步骤不影响 job 结论）。

## 依赖安全（2026-10-29 实测）

- 根目录 `npm audit`：**0 条漏洞**；`management/registry-ui` `npm audit`：**0 条漏洞**（Node 24.15.0 / npm 10.9.9，当前锁文件）。
- Go 侧对 `management/registry/go.mod` 做 OSV 批量查询，唯一命中 **GO-2026-5932**：`golang.org/x/crypto/openpgp` 已被上游标记为不再维护、设计上不安全，且公告覆盖全部版本（无修复版本）。本仓库只从该模块引用 `bcrypt`，未 import `openpgp`，因此当前代码路径不受影响；不要为了消警去替换整个 x/crypto。
- GitHub Dependabot 页面需要登录，匿名 API 返回 401，**本次无法核对那 66 条仓库级告警是否已随 `e04bb22` 刷新**。仍待登录确认后逐条比对来源。

## 仍未解决的已知问题

| 优先级 | 问题及触发条件 | 当前影响与后续工作 |
|---|---|---|
| P1，上线前阻断 | 完整 Armbian 镜像尚未构建，三组设备未真机验收 | Zero2 1 GB/2 GB、R28S 1 GB 的 U-Boot 编译和隔离测试不能证明完整系统可启动。需在足够磁盘空间的构建机实编译，再用 32/64 GB TF 卡验证冷启动、网络、内存负载、A/B 升降级与断电恢复。R28S 的厂商内核/AIC8800 集成尤其需要实机验证。`Request Image Build` 至今零运行，说明这条链路从未在 GitHub 侧走通一次。 |
| P1，无人值守恢复限制 | 内核或引导阶段硬锁死，无法触发下一次重启 | **已在用户态与内核态补齐硬件看门狗**：RK3528 片上 DesignWare 看门狗（`watchdog@ffac0000`，`snps,dw-wdt`）主线 DTS 与内核基线（`CONFIG_DW_WATCHDOG=y`）本来就支持，此前只是没有任何用户态使用者。现在 `etc/systemd/system.conf.d/10-hive-watchdog.conf` 让 PID 1 以 `RuntimeWatchdogSec=30s` 打开 `/dev/watchdog0`，systemd 主进程死锁即由 SoC 硬复位；内核侧补 `CONFIG_DEBUG_KERNEL`/`SOFTLOCKUP_DETECTOR`/`HARDLOCKUP_DETECTOR` 与 `irqchip.gicv3_pseudo_nmi=1`，使 boot.cmd 的 `softlockup_panic=1`/`hardlockup_panic=1`/`panic=10` 真正生效。仍存在的缺口：U-Boot 自身损坏或卡死（U-Boot 的 DTS 副本没有 wdt 节点、defconfig 未开 `CONFIG_WDT`，SPL→U-Boot 阶段无保护）、TF 卡物理损坏、U-Boot 环境区损坏需 USB/rockusb 人工救援。这些不属于 A/B 或 OTA 能覆盖的范围。 |
| P1，存量升级要求 | 升级共享凭证/旧代理，或首次从单系统迁移到 A/B | 新后台拒绝旧凭证和旧 `GET/POST /nodes/{mac}/xray-users` 计费接口；migration 28 默认关闭所有出口权限，需逐台核对控制权、签发独立服务器密钥。仅升级后台会中断旧设备服务。需维护窗口和可信 SSH 安装独立 token/新版代理；A/B 首刷必须离线备份、整盘刷写后恢复身份。 |
| P1，计费协议与回滚兼容 | 启用 migration 29 的递增周期后，回滚到无周期编号的出口脚本或混跑旧后台 | 旧请求会被拒绝；回滚包、备用槽及全部 Registry 写入实例须支持新协议。数据库恢复须与出口待传状态一致。旧出口在配套升级前继续保留历史计数，不能手动删除去重状态。 |
| P2，**文档与实现漂移**（本次新增） | 运维按文档操作 | 见下方"文档漂移清单"，其中 `NODE-OPERATIONS.md` 的 `Bearer <API_SECRET>` 调用 `/prometheus-targets` 在 `76e3810` 之后会直接 401。 |
| P2，**定时清理工作流长期失败**（本次新增） | `cleanup-gitea-build-refs.yml` | 53/53 次失败，`ci/build/*` 一次性 ref 从未被回收。页面只暴露 "exit code 1"，完整日志需登录；匿名访问 `gitea.sakurapuare.com` API 返回 403，最可能是 `GITEA_TOKEN` secret 缺失或失效。需补 token，或加失败 annotation 把异常原因打到页面上。 |
| P2，套餐执行不完整 | 设置套餐速度或并发设备数限制 | `plans.speed_limit` / `device_limit` 仅存库并透传到 API 与导出，设备脚本中没有任何强制实现；不能按"已强制执行"售卖这两项保证。 |
| P2，计量与连接影响 | 到达额度、撤销 UUID、采样期间断电或失联 | 按约 15 秒周期计量，最长 45 秒授权加守护调度延迟，不是逐字节硬限额；突然断电可能丢失末次采样后的用量。撤销会重启整台节点的 Xray，其他用户也会短暂重连。 |
| P2，OTA 管理记录与扩展能力 | 同一节点重新分配任务或多实例并发上传 | `ota_assignments` 主键为 `node_mac`，每节点只有当前分配，重新分配会覆盖旧任务状态；尚无完整升级历史表。OTA 文件操作现使用跨进程文件锁；多实例仍要求同一数据库、共享制品目录、全部写入进程升级，并验证共享存储的锁语义。 |
| P2，管理端存储总额 | 大量近期上传或长期被任务引用的包 | 后台已按 30 天保留期回收，但 **无总容量额度**（配置里只有 `OTA_RETENTION_DAYS` / `OTA_ARTIFACT_DIR`）；设备按需下载、不长期保存包，不限制后台目录。 |
| P2，初始安装及数据回滚范围 | 首次安装 OTA 客户端时断电，或 hook/新固件修改共享数据格式 | 首次安装器有普通失败恢复，断电仍需从保留备份人工恢复/重跑。下载/解压空间检查不等于安装、备份及 hook 的完整磁盘预算。应用事务只恢复声明文件与服务状态，不能撤销远程副作用/数据库迁移；固件共享数据必须兼容旧版本。 |
| P2，历史订单与迁移 | 对旧订单退款、人工修改到期日，或执行 SQL 迁移中断 | 无法可靠推断历史余额抵扣与开通关系，需核对补录；有歧义的退款返回 409。MySQL DDL 非完整事务，迁移中断可能留下部分结构，需备份及人工核对后恢复。外部渠道资金退款仍需渠道或人工执行。 |

## 文档漂移清单（本次核对发现，尚未修改）

| 文件 | 现状 | 与实现不符处 |
|---|---|---|
| `docs/NODE-REGISTRY-API.md` 认证一节 | 称"`Authorization: Bearer <API_SECRET>`（同时兼容 `?token=`）"可用于节点/订阅管理接口，且"留空则关闭认证" | `76e3810` 之后旧 `API_SECRET` 只在 `/subscription`、`/subscription/clash` 上有效；管理接口需会话 cookie 或 `ADMIN_API_SECRET`。`APISecret` 为空时 `checkAPISecret` 直接返回 false，不再放行。 |
| `docs/NODE-REGISTRY-API.md:277`、`docs/NODE-OPERATIONS.md:278` | 示例用 `Bearer <API_SECRET>` 调 `/prometheus-targets` | 该路由受 `prometheus:read` 保护，需 `ADMIN_API_SECRET` 或带该权限的会话，按文档照抄会 401。 |
| `docs/DEPLOY-K8S.md:32,37` | 称 `API_SECRET` 是管理 API 的 Bearer 密钥、非 dev 必填 | `main.go` 只强制 `ADMIN_SESSION_SECRET` 存在、并要求 `ADMIN_API_SECRET != API_SECRET`；没有"缺 `API_SECRET` 即退出"的逻辑。 |
| `docs/review-remediation.md:7` | 称自动化凭证"不接受 URL 中的 token" | `a4c392b` 起，两条导出路由明确接受 `?token=`。 |
| `management/registry/internal/handler/device_commands.go:270,275,324` | Swagger 注释写"设备鉴权（Bearer API_SECRET）" | 实际是 `RequireDeviceAuth` 的每机 `device_credentials` token；生成的 `openapi.yaml` 与前端 client 也带着这句旧文案。 |

## 已实现（2026-10-27 版本保留）

| 项目 | 当前结果 |
|---|---|
| 客户设备提交计费用量 | 管理员启用的可信出口、独立服务器密钥和专用接口；客户凭据不能计费或获取出口用户列表，撤销与计费事务串行核验。 |
| 历史流量计数持续增长 | migration 29 保存每出口一个周期水位；旧请求永久拒绝，启动时及每小时按 1000 条分批回收旧周期计数。 |
| 服务器 OTA 包持续积累 | 默认 30 天、每类型/板型最近 3 个版本、全部当前任务引用保护；启动/每小时清理及后台预览/手动清理。 |
| NanoPi 下载包保存策略 | 按需从服务器下载，成功/失败退出清理，断电残留下次启动清理；不长期缓存包。 |
| 订阅授权与续费 | 到期/超额撤销授权并断连、15 秒计量上报、45 秒授权上限、同套餐续费复用原订阅链接与设备绑定、月度重置恢复额度。 |

## 部署要点

1. 备份数据库和设备状态；先更新所有 Registry 实例，再配套更新运营方出口脚本与独立服务器密钥。migration 28 默认关闭存量出口角色；migration 29 调整计数表主键，大表应预留维护时间。
2. 核对客户端与可信出口的实际控制权。出口 root 仍在计费信任范围内；不能把客户控制的网关登记为可信出口。本项目未实现原版 v2node 的 UniProxy 接口兼容。
3. A/B 备用槽与应用回滚包应支持新计费周期协议；保留当前计数水位及出口待传数据。密钥轮换、额度重置均不能清空这些数据。
4. `ADMIN_API_SECRET` 必须与 `API_SECRET` 不同，否则进程启动时直接退出（`main.go` 的 fail-fast 检查）。
5. OTA 设备侧按需下载；管理后台继续执行 30 天保留规则，但没有总容量额度。删除数据库记录后的 InnoDB 空间通常可复用，不保证磁盘文件立即缩小。

迁移与验收细节见 [审查修复说明](review-remediation.md)、[订阅授权与计费](subscription-enforcement.md)、[OTA 与 A/B](OTA.md)、[端到端验收](PHASE0-VERIFY.md)。
