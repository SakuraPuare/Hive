# 订阅授权与计费更新

客户订阅继续使用 `/c/{token}`，每份订阅拥有独立的 Xray UUID。重置订阅链接现在同时轮换 UUID，已导入的旧配置也会被撤销。

自 migration 33 起，节点带 `exit_direction`（`overseas` 出海 / `domestic` 回国），客户订阅拆成两份**独立配置**，不能合并：

- `GET /c/{token}`、`/c/{token}/vless`：出海订阅，只含 `overseas` 节点，CN 直连、其余走代理（默认行为，旧链接不变）；
- `GET /c/{token}/domestic`、`/c/{token}/domestic/vless`：回国订阅，只含 `domestic` 节点，CN 走代理、其余直连。

两类节点的落地方向和 CN 分流规则相反，混在一份配置里会把一半流量送错方向。线路/分组导出用 `?direction=domestic` 切换；客户门户分别展示两份链接，套餐在某方向没有可用节点时该方向置灰。网关上游也按方向互补过滤，见 [GATEWAY.md](GATEWAY.md)。

## 当前行为

- 自 migration 31 起，**所有节点默认作为 Xray 出口**：普通设备、客户网关、可信出口都参与订阅和网关上游。管理员可在节点编辑里关闭「作为出口」，设备所有者也可在客户门户关闭自己设备的出口；实际出口 = `exit_enabled && owner_exit_enabled && enabled && status=active`。
- 订阅的设备数限制在出口侧执行：cloudflared → nginx → Xray，nginx 的 `/ray` 用 Cloudflare 权威的 `CF-Connecting-IP` 覆盖客户端自带的 `X-Forwarded-For`，Xray 的 WS 入站再用 `sockopt.trustedXForwardedFor: ["CF-Connecting-IP"]` 取真实客户端 IP，`statsUserOnline` 记录每个 `sub-<id>` 的在线源 IP；`hive-xray-sync` 每 15 秒把这些 IP 随计费上报一起发给 Registry。Registry 按订阅聚合各出口的不同 IP，最早出现的 `device_limit` 个 IP 保留名额，其余 IP 由出口用动态路由规则 `user=sub-<id> + source=<ip> → block` 拒绝新连接。`device_limit=0` 表示不限；在线 IP 2 分钟未上报即过期；只阻断新连接，已有连接继续到自然关闭；IPv4/IPv6 分别计数，NAT/CGNAT 会把多台设备合并成一个 IP。
- 恢复“开机即运行 Xray”的兼容模式：安装 `/etc/hive/server-token` 的可信出口通过独立接口 `POST /servers/{mac}/accounting` 计费；没有 server-token 的普通设备使用设备凭据走回退接口 `POST /nodes/{mac}/xray-users`，同样上报累计计数并取得自己线路上的有效用户。设备凭据不能冒充服务器凭据调用 `/servers`，但可以在回退接口参与自己线路的计费。
- 出口每约 15 秒通过 `POST /servers/{mac}/accounting` 同步 Xray 原始累计计数，再获得有效客户列表。上传和下载分别计费，多个出口的用量合并到同一订阅。服务端将身份校验、节点锁、计数更新配合处理，撤销或轮换密钥后，尚未提交的旧凭据请求不能继续入账。
- 所有节点的上报使用 Xray systemd InvocationID 和递增的 `generation` 区分计数器生命周期；服务器与设备凭据共用同一个节点周期，模式切换不会重置编号。migration 25 保存最大已确认值，migration 29 增加每节点一条周期状态；事务同时提交流量、计数位置及周期推进。响应丢失、同周期乱序、重试不会重复扣量。待确认快照保存在 `/var/lib/hive/traffic-pending/`，周期文件为 `/var/lib/hive/traffic-generation.json`，重启代理前尽量捕获最后一份快照。
- Prometheus 继续用于监控，不再修改计费用量。流量统计失败时节点停止 Xray，避免无法计量的持续访问。
- 每次授权最长 45 秒，且不超过本批用户最早的订阅到期时间。有效期用 `/proc/uptime` 计算，租约只保存在 `/run`，不受墙上时钟回拨影响，也不跨重启复用。
- 独立的 `hive-subscription-guard.timer` 每约 5 秒检查租约。Registry 失联、同步进程卡住或配置无效均不会续期；到期后关闭现有连接。
- 发现撤销、超额、到期或 UUID 变化时，设备重启 Xray，关闭已建立的连接，再恢复仍有效的用户。当前是整个节点的 Xray 重启，其他在线用户会短暂重连。网关配置变化也通过重启 Mihomo 关闭旧连接。
- 客户网关失效或租约超时后，同时安装 IPv4/IPv6 FORWARD 阻断规则并写入 REJECT 配置；避免 TUN 停止时被局域网 NAT 直连绕过。续期成功且代理配置应用成功才解除阻断。
- 显式设置 `GATEWAY_ENABLED=off`（也接受 `0/false/no`）时停止 Mihomo、清除网关租约及 Hive 自己添加的 `hive-subscription` FORWARD DROP，不改动其他转发/NAT 规则；服务启动条件和租约守护同样遵守此开关；`ExecCondition` 只有禁用网关（或首次启动时尚无配置）返回 1–254 跳过，清理失败或阻断规则写入失败返回 255，让单元失败并由 `Restart=on-failure` 重试，不会把故障静默当成“已禁用”。重新开启后必须取得新授权才放行。该开关不影响可信出口的 Xray 租约执行。
- Xray 启动前清空静态 VLESS 客户端，公共节点 UUID 不再提供代理访问。网关必须绑定有效客户订阅，无订阅的内部网关也不再提供免费出口。
- 线路和分组仍可组织节点，但导出需提供 `?subscription=<客户订阅Token>`。结果取线路/分组、客户套餐和已启用出口的交集，并使用客户 UUID。后台增加客户订阅链接输入框；未输入时不能复制或预览有效导出。

### 角色与信任边界

```mermaid
flowchart LR
    C[客户端 / NanoPi 客户网关] -->|订阅 UUID 连接| S[任一启用出口 Xray]
    S -->|服务器密钥 + 累计流量| R[Registry 面板]
    R -->|扣量后返回有效用户与短期租约| S
    C -->|设备凭据：心跳、网关配置、OTA| R
```

这是 v2board/v2node 的服务器计量思路：[v2node 读取出口内核流量](https://github.com/wyx2685/v2node/blob/main/node/user.go)，通过 [ReportUserTraffic 向面板发送用量](https://github.com/wyx2685/v2node/blob/main/api/v2board/user.go)，[v2board 的 UniProxy 接口](https://github.com/wyx2685/v2board/blob/master/app/Http/Controllers/V1/Server/UniProxyController.php)核验服务器密钥并处理用户授权和流量。这里的上报方是运营方服务器，不是用户客户端。本次参考职责划分，保留 Hive 自己的累计计数、去重和租约协议；**没有实现直接接入原版 v2node 的 UniProxy 兼容层**。

默认模型下所有节点都可能是出口，包括客户名下的设备；这是有意的共享出口池。客户设备作为出口时，其他订阅用户的流量会从该设备出网，设备所有者可在门户关闭自己的出口开关。管理员关闭 `exit_enabled` 后，即使所有者重新打开也无法恢复。可信计费密钥仍是独立信任层：普通设备凭据不能冒充服务器凭据调用 `/servers/{mac}/accounting`；安装 `/etc/hive/server-token` 的节点走可信出口接口，没有该文件的节点回退到设备凭据 `/nodes/{mac}/xray-users`。不要把客户可篡改的机器登记为可信计费出口；它仍可作为普通出口运行，但计量由设备凭据回退路径承担。

这些是周期性计量和短期授权，不是逐字节硬限额。实际超额量仍受 15 秒上报间隔、网络和节点负载影响。突然断电可能丢失最后一次采样之后的流量。正常到期可由本地短期租约截止，不必等待后台十分钟生命周期任务。

## 现有部署升级

后端和节点必须配套更新，仅更新网站不能撤销已经缓存到旧节点的公共凭证。

1. 备份数据库，并为出口节点安排短维护窗口。先停止旧节点代理，避免新旧计费同时运行。
2. 更新 Registry 和前端。Registry 自动执行待运行迁移（计费为 migration 25，续费与暂停原因为 migration 26，出口身份隔离为 migration 28，计数回收为 migration 29，出口开关为 migration 31）。migration 28 只把 `server_enabled` 作为可信计费开关；migration 31 增加默认开启的 `exit_enabled` / `owner_exit_enabled`，升级后所有存量节点立即作为出口，管理员或设备所有者可关闭。旧的 `GET /nodes/{mac}/xray-users` 仍返回 426；`POST` 作为设备凭据回退接口保留，供没有 server-token 的节点使用。migration 29 调整计数表主键，历史数据量大时应预留维护时间。
3. 「作为出口」默认开启，无需逐个启用。仅对运营方独占控制、需要可信计费的机器，在「节点详情 → 可信出口计费」生成服务器密钥；也可调用管理员接口 `POST /admin/nodes/{mac}/server-credential`。密钥只返回一次，单独通过可信 SSH 安装到对应出口 `/etc/hive/server-token`，root 所有、权限 `0600`，不要写进通用镜像、客户设备或日志。普通 `/etc/hive/device-token` 仍用于该机器的注册、心跳与 OTA。密钥轮换立即废弃旧密钥；同一路径 `DELETE` 只撤销可信计费密钥，是否继续作为普通出口由「作为出口」开关决定；撤销后现有连接在剩余租约结束后停止。客户设备无需此密钥。若撤销后改作客户网关，删除旧 `/etc/hive/server-token` 即可；Xray 会回退到 `/etc/hive/device-token` 继续运行（兼容模式），不再要求手动停用。
4. 安装本次设备脚本与 systemd 单元。默认 OTA 包已包含这些文件，并自动启用/启动租约守护与同步定时器。定制 OTA 包必须包含 `hive-subscription-state`、`hive-subscription-guard`、`hive-xray-prepare`、`hive-gateway-prepare`、两个同步脚本及相应服务/定时器。没有服务器密钥的设备仍启动 Xray，并用设备凭据走回退接口上报/续租；其 Mihomo 网关继续按绑定订阅工作。可信出口模式优先使用独立服务器密钥。
5. 手动安装时执行：

   ```sh
   systemctl daemon-reload
   systemctl enable --now hive-subscription-guard.timer
   systemctl enable --now hive-xray-sync.timer hive-clash-sync.timer
   systemctl restart hive-xray-sync.timer hive-clash-sync.timer
   systemctl start hive-xray-sync.service
   ```

6. 从 Prometheus 计费版本首次升级时，可信出口会重新启动 Xray，并写入 `/var/lib/hive/subscription-accounting-v1`。升级前运行周期的计数已经由旧 Prometheus 方案统计，不再整段补扣；切换前尚未采集的尾部流量需按业务需要核对。已使用 migration 25 累计计费的出口保持计数表、此标记和待确认快照，改用服务器凭据继续去重同步。不要删除这些数据来“清理缓存”。
7. 为需要提供网关服务的设备绑定客户订阅。向客户发送 `https://<面板域名>/api/c/<token>`（VLESS 为 `.../vless`；`/c/` 是 Registry 端点，nginx 只把 `/api/` 前缀转发给后端），或在后台输入客户订阅链接后生成新的线路/分组链接；历史裸 `/l/`、`/s/` 链接不再可用。
8. 验证普通设备 Token 调 `/servers/{mac}/accounting` 返回 401；调 `POST /nodes/{mac}/xray-users` 能取得自己线路上的用户并上报（回退模式）。验证普通节点和客户网关默认出现在订阅中；管理员关闭 `exit_enabled` 或设备所有者在门户关闭 `owner_exit_enabled` 后，节点应从订阅和网关上游候选中消失（最长等待一个 45 秒租约）。再验证有效订阅能连接出口；将测试订阅流量设为额度或到期后，确认现有长连接关闭；阻断出口到 Registry 的连接，确认租约到期后停止服务，再恢复网络验证恢复。

正常流量配额重置保留累计计数位置，不会把历史流量重新扣到新额度中。

## 历史计数回收

- 节点先按周期编号顺序确认全部待传快照，包括旧 Xray 停止前的最后用量；只有新的空白运行周期才读取后台编号并加一。可信出口通过服务器凭据调用 `GET /servers/{mac}/accounting/state`，普通设备通过设备凭据调用 `GET /nodes/{mac}/accounting/state`；两者读取同一个节点状态，只返回编号和 InvocationID，不返回用户或租约。凭据只能读取自己 MAC 和角色对应的接口。编号用十进制字符串传输，避免 JavaScript 数值精度丢失；本地周期文件原子写入并刷盘后才启用用户。
- 两个计费接口都只接受当前编号对应的 InvocationID，或恰好下一个编号的新 InvocationID。推进与计费同一事务提交；发生错误会一起回滚。较旧编号（包括已升级节点的无编号旧请求）返回 **410**，不给授权、不扣量，节点可删除该旧快照；同编号不同 InvocationID 或跳号返回 **409**，保留快照并停止推进，需排查重复运行的代理或状态恢复不一致。
- Registry 启动时及每小时清理一次，每个事务最多删除 1000 条已结束周期计数。清理与计费共用节点行锁，支持多个后台实例并发执行。当前周期计数不会因离线、额度重置或时间流逝而删除；每个出口的 `node_accounting_state` 始终保留最新编号，撤销/轮换密钥也不清除，防止旧请求在清理后重新入账。
- migration 29 将既有计数归到兼容周期 `0`。**先更新后台，再配套更新 `hive-subscription-state` 和 `hive-xray-sync`**；新脚本先补传旧快照和旧运行周期尾部用量，重启到空白 Xray 后再推进编号。尚未切换且后台编号为 `0` 的节点继续使用原计数去重，暂不回收其旧记录；完成切换后，下次清理自动回收历史记录。旧设备脚本留下的运行中周期 `0` 也按此流程迁移；若后台已有更大编号，旧快照会被 410 拒绝，不得改编号补传。
- 切换服务器/设备凭据时，已有运行周期和待确认快照保留原编号，使用新角色对应的接口补传；下一次空白运行周期从共用游标继续递增。切换后不能降级到不携带周期编号的同步脚本，旧请求会被拒绝。应用回滚包与下一次固件包也应带上支持本协议的脚本，再启用新周期；不能通过删除后台防重放状态来兼容降级。多个 Registry 实例需全部升级后再切换节点，旧后台不理解编号，不能混跑计费写入。
- 本地周期文件缺失时先重启到空白 Xray，再从后台取得下一编号，不能把旧累计量换个编号重新上报。损坏的周期文件或无法确认的快照会停止推进；丢失本地状态时，无法确认的尾部流量可能漏记，需要核对备份。不要手工清空后台周期状态或单独恢复旧数据库后直接放行新代理；恢复应保持数据库与出口待传状态一致。
- 回收删除的是去重计数，不是订阅已用流量。规模取决于当前运行周期内出现的计数器，以及两次清理之间产生的历史计数；不会为每个重启周期永久保留一条墓碑。数据库删除后的页通常由 InnoDB 复用，磁盘文件不一定立即缩小，本机制不自动执行锁表重建。

## 验证与实现依据

- Go 回归覆盖角色与凭据隔离、密钥轮换/撤销、客户认领/管理员分配与出口启用并发、订阅/网关出口筛选、事务计费、并发重试、运行周期变化、到期租约、节点禁用、跨套餐隔离、共享链接额度检查、UUID 轮换；另覆盖服务器/设备双向切换后的真实计数清理与重试、两个接口的旧周期拒绝，以及游标的跨 MAC/跨角色鉴权与无授权响应。
- `python3 scripts/test-subscriptions.py` 运行真实 Bash 同步/守护脚本，以隔离替身模拟 Registry、Xray、systemd 和防火墙，不修改测试主机网络；设备与服务器替身使用同一周期约束，覆盖热切换、响应丢失后跨角色重放、设备周期 `0` 迁移和 410 后重启恢复。
- `python3 scripts/test-remediation.py` 验证默认 OTA 包携带并启用租约守护，同时保留既有安全回归。
- Xray 统计读取使用官方 [statsquery 实现](https://github.com/XTLS/Xray-core/blob/main/main/commands/all/api/stats_query.go) 的非重置查询；运行时授权只写入内存，不把客户 UUID 持久化到启动配置。
