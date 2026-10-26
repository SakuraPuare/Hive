# 订阅授权与计费更新

客户订阅继续使用 `/c/{token}`，每份订阅拥有独立的 Xray UUID。重置订阅链接现在同时轮换 UUID，已导入的旧配置也会被撤销。

## 当前行为

- 节点每约 15 秒通过 `POST /nodes/{mac}/xray-users` 上报 Xray 原始累计计数，再获得有效客户列表。上传和下载分别计费，多个出口节点的用量合并到同一订阅。
- 上报使用 Xray systemd InvocationID 区分计数器生命周期。数据库 migration 25 保存每个节点、运行周期和计数器的最大已确认值；事务同时提交流量和计数位置。响应丢失、乱序、重试不会重复扣量。待确认快照保存在 `/var/lib/hive/traffic-pending/`，重启代理前尽量捕获最后一份快照。
- Prometheus 继续用于监控，不再修改计费用量。流量统计失败时节点停止 Xray，避免无法计量的持续访问。
- 每次授权最长 45 秒，且不超过本批用户最早的订阅到期时间。有效期用 `/proc/uptime` 计算，租约只保存在 `/run`，不受墙上时钟回拨影响，也不跨重启复用。
- 独立的 `hive-subscription-guard.timer` 每约 5 秒检查租约。Registry 失联、同步进程卡住或配置无效均不会续期；到期后关闭现有连接。
- 发现撤销、超额、到期或 UUID 变化时，设备重启 Xray，关闭已建立的连接，再恢复仍有效的用户。当前是整个节点的 Xray 重启，其他在线用户会短暂重连。网关配置变化也通过重启 Mihomo 关闭旧连接。
- 客户网关失效或租约超时后，同时安装 IPv4/IPv6 FORWARD 阻断规则并写入 REJECT 配置；避免 TUN 停止时被局域网 NAT 直连绕过。续期成功且代理配置应用成功才解除阻断。
- Xray 启动前清空静态 VLESS 客户端，公共节点 UUID 不再提供代理访问。网关必须绑定有效客户订阅，无订阅的内部网关也不再提供免费出口。
- 线路和分组仍可组织节点，但导出需提供 `?subscription=<客户订阅Token>`。结果取线路/分组与客户套餐允许节点的交集，并使用客户 UUID。后台增加客户订阅链接输入框；未输入时不能复制或预览有效导出。

这些是周期性计量和短期授权，不是逐字节硬限额。实际超额量仍受 15 秒上报间隔、网络和节点负载影响。突然断电可能丢失最后一次采样之后的流量。正常到期可由本地短期租约截止，不必等待后台十分钟生命周期任务。

## 现有部署升级

后端和节点必须配套更新，仅更新网站不能撤销已经缓存到旧节点的公共凭证。

1. 备份数据库，并为出口节点安排短维护窗口。先停止旧节点代理，避免新旧计费同时运行。
2. 更新 Registry 和前端。Registry 自动执行待运行迁移（计费为 migration 25，续费与暂停原因为 migration 26）。旧的 `GET /nodes/{mac}/xray-users` 返回 426，必须升级设备代理。
3. 安装本次节点脚本与 systemd 单元。默认 OTA 包已包含这些文件，并自动启用/启动租约守护与同步定时器。定制 OTA 包必须包含 `hive-subscription-state`、`hive-subscription-guard`、`hive-xray-prepare`、`hive-gateway-prepare`、两个同步脚本及相应服务/定时器。
4. 手动安装时执行：

   ```sh
   systemctl daemon-reload
   systemctl enable --now hive-subscription-guard.timer
   systemctl enable --now hive-xray-sync.timer hive-clash-sync.timer
   systemctl restart hive-xray-sync.timer hive-clash-sync.timer
   ```

5. 首次运行新版同步程序会重新启动 Xray，并写入 `/var/lib/hive/subscription-accounting-v1`。升级前运行周期的计数已经由旧 Prometheus 方案统计，不再整段补扣；升级切换前尚未采集的尾部流量需按业务需要核对。不要删除这个标记或计数器表来“清理缓存”。
6. 为需要提供网关服务的设备绑定客户订阅。向客户发送 `/c/` 链接，或在后台输入客户订阅链接后生成新的线路/分组链接；历史裸 `/l/`、`/s/` 链接不再可用。
7. 验证有效订阅能够连接；将测试订阅流量设为额度或到期后，确认现有长连接关闭；阻断设备到 Registry 的连接，确认租约到期后代理和网关停止服务，再恢复网络验证恢复。

正常流量配额重置保留累计计数位置，不会把历史流量重新扣到新额度中。

## 验证与实现依据

- Go 回归覆盖事务计费、并发重试、运行周期变化、到期租约、节点禁用、跨套餐隔离、共享链接额度检查、UUID 轮换。
- `python3 scripts/test-subscriptions.py` 运行真实 Bash 同步/守护脚本，以隔离替身模拟 Registry、Xray、systemd 和防火墙，不修改测试主机网络。
- `python3 scripts/test-remediation.py` 验证默认 OTA 包携带并启用租约守护，同时保留既有安全回归。
- Xray 统计读取使用官方 [statsquery 实现](https://github.com/XTLS/Xray-core/blob/main/main/commands/all/api/stats_query.go) 的非重置查询；运行时授权只写入内存，不把客户 UUID 持久化到启动配置。
