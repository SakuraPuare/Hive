# 仓库审查修复与升级

本次对应 2026-10-26 审查中的 21 项问题。后续订阅与 OTA 修复合并后，代码包含数据库迁移 21–29；部署时自动执行。可信出口身份隔离与历史计数回收的配套升级步骤见 [订阅授权与计费](subscription-enforcement.md)。升级前备份数据库、节点运行配置和现有发布文件。

## 设备凭证与旧节点迁移

共享 `API_SECRET` / `REGISTRY_API_SECRET` 不再用于设备认证或管理认证。管理 Cookie 保持有效；自动化脚本改用单独的服务端 `ADMIN_API_SECRET`，不能复用旧设备密钥，也不接受 URL 中的 token。

由持有 `node:write` 权限的管理员为每台设备调用：

```http
POST /admin/nodes/aabbccddeeff/credential
Cookie: hive_admin_session=...
```

接口返回 `{ "mac": "aabbccddeeff", "token": "..." }`，明文只返回一次，数据库只存 SHA-256。MAC 使用无分隔符的小写 12 位十六进制。此接口可在首次注册前调用；再次调用立即撤销该设备的旧 token。设备 token 无法访问其他 MAC 或管理接口。

把 token 通过现有可信 SSH 通道或离线方式安装为该设备 `/etc/hive/device-token`，属主 root、权限 0600。共用镜像不包含任何 Registry token；单设备镜像可使用 `DEVICE_API_TOKEN`，该 token 仍然只匹配签发时的 MAC。重新刷机需要恢复该设备 token 或由管理员重新签发。

旧设备升级步骤：

1. 先部署新 Registry，使用管理会话逐台签发 token。
2. 通过现有可信 SSH 通道安装 token、更新后的设备脚本及 SSH host key 服务单元。旧共享凭证在新 Registry 上会被拒绝，因此首次迁移不能依赖旧命令代理或旧 OTA 轮询。
3. 在设备本地运行 `systemctl daemon-reload`，再运行 `/usr/local/bin/hive-migrate-identity`。脚本随机生成并持久化 Xray UUID，更新注册信息和本机配置，轮换旧 SSH Ed25519 主机密钥，更新默认热点密码与 Mihomo 控制密钥。重跑会保留新生成的身份。
4. 记录新 SSH 指纹及 Wi-Fi 密码，验证设备注册、命令轮询和网关配置。可信出口另按 [订阅升级说明](subscription-enforcement.md) 安装独立服务器密钥，验证 Xray 同步；普通客户网关应停止出口 Xray。用户主动设置的热点密码会保留；如需轮换此类密码，使用热点配置功能。
5. 管理服务及设备全部迁移后，撤销旧共享密钥及曾经暴露给旧镜像的管理自动化凭证。

SSH 指纹和默认 Wi-Fi 密码会变化。未迁移设备会失去 Registry API 访问能力；必须安排维护窗口并保留可信的本地/SSH 管理通道。这里提供的是迁移代码和步骤，仓库修改不会自动更新线上设备。

## 订单和客户状态

下单在事务中锁定余额及优惠码，持久化 `balance_deducted`。应付为零时立即完成支付和开通。支付、订阅、返利和状态一并提交；重复支付不会重复开通。状态转换为 `pending → paid/cancelled`、`paid → refunded`，相同状态可安全重试。

取消及超时取消只返还记录中的余额抵扣，且只返还一次。退款按购买时间记录重算订阅到期日，只撤回该订单的时长、返利与抵扣余额；外部付款的退款仍需支付渠道或人工执行，本仓库没有支付渠道退款接口。已花掉的返利被撤回时会显示负余额作为欠款，不会通过截断到零制造资金。

旧订单没有余额抵扣字段和开通关系，迁移不能可靠地从“原价减应付”反推出余额，因为其中可能包含优惠码。旧 pending 订单的历史扣款需要根据审计/支付记录核对后补录 `balance_deducted`；旧 paid 订单退款前须核对并补录 `order_fulfillments` 中的订阅和返利关联，接口在缺失关联时返回 409。不得凭金额差自动补录或退款。

订阅到期/超量不会禁用账号的门户访问；历史 `suspended` 客户仍可登录、续费和提交工单。`banned` 与 `deleted` 阻止门户访问。已归属客户或已绑定订阅的网关没有有效套餐时返回 REJECT 配置，不会切换到节点免费 UUID。

## OTA 与发布

默认 OTA 仅包含应用脚本、服务单元、网络调度脚本、MOTD 和静态资源；设备凭证与 Xray/Mihomo 等运行配置不直接打包，需要签名迁移 hook。更新器使用全设备安装锁和独立工作目录；安装结果保存在本地，直到 Registry 确认。每次分配有独立标识，旧回执无法完成新任务。同版本同 SHA 已安装时会直接确认新分配；同版本不同 SHA 会重新校验安装。

安装后 hook、服务 enable 或 restart 失败会记录失败，不会报告安装成功。应用 OTA 现在先持久化受管文件及服务状态备份，失败或进程中断后执行恢复；恢复本身失败时保留备份并阻止新更新，需人工处理。具体范围与 A/B 固件机制见 [OTA 说明](OTA.md)。部署和回滚后端均先写同目录临时文件，再 rename 替换运行中的二进制。

## 验证

后端测试需要专用 MySQL/MariaDB 测试库，测试结束会清理该库：

```sh
cd management/registry
TEST_MYSQL_DB=hive_registry_test go test ./...
go vet ./...
```

前端使用锁文件安装依赖，执行 `npm test`、`npm run typecheck` 和 `npm run build`。`scripts/test-remediation.py` 使用临时目录及模拟设备命令测试注入、随机凭证、Xray 重试、OTA 签名安装/回执/互斥、打包范围和运行中二进制替换；需要 Bash、Python 3、jq、OpenSSL、flock。

2026-10-26 本地验证结果：Go 全量测试、竞态检测、vet 和 amd64/arm64 编译通过（临时 MariaDB 13.0.2）；前端 162 个测试、类型检查、Webpack 静态导出通过；`npm ci --offline` 可从缓存重复安装；10 项隔离脚本回归通过；三套 Nginx 配置共 18 个直接访问 URL 正确匹配导出页面。原依赖版本未升级，锁文件只补齐缺失的可选依赖/元数据。当前环境的 Turbopack 无法创建内部端口，因此静态导出使用 `npm run build -- --webpack` 验证。硬件无线行为、线上数据迁移和线上部署未执行。

## 订阅授权后续修复

订阅计费已改为可信出口服务器使用独立凭据同步实际用量，客户设备不参与计费上报；同时增加短期授权、旧连接关闭、共享订阅隔离和历史计数回收。部署时请同时执行 [订阅升级说明](subscription-enforcement.md)，不能仅升级管理后台。

## 完整范围审查修复（2026-11-11）

针对 `959c568^..428d5a1` 审查确认的十项问题，已完成以下修复：

| 问题 | 修复后的行为 |
|---|---|
| 固件试启动误判回退 | 从唯一有效的内核参数 `hive.slot=A|B` 识别运行字母，不把尚未翻转的 `hive_active` 当作当前字母。 |
| Gitea 制品上传拒绝运行 | 镜像工作流恢复固定 SHA 的 `actions/upload-artifact` v3，继续使用 Gitea 的旧版 artifact API。 |
| 禁用网关仍阻断转发 | off 停止 Mihomo、清理网关租约及 Hive 专属 DROP；同步、守护和服务启动条件一致，其他转发规则与 Xray 授权执行不变。 |
| 固件读回校验遗漏 | sync 后校验所有映射后的目的文件，包括 DTB、模块、firmware 和元数据；全部匹配才写 pending 和 U-Boot 环境。 |
| 删除推荐人阻断退款 | 退款允许历史关联的返利已被级联删除；其他数据库错误仍回滚，独立返利接口仍返回不存在错误。 |
| 上传完成失败删除分片 | 服务端复制/发布错误返回 5xx 并保留分片，可原会话重试；非法包及大小超限仍拒绝和清理。 |
| 重部署轮换默认管理密钥 | 显式 `ADMIN_API_SECRET` 优先，否则读取已安装 EnvironmentFile 的原值，仅首次缺失时生成；读取不执行环境文件内容。 |
| 热点启动失败却确认成功 | 已分配 AP 的 hostapd、DHCP/DNS 或 NM 激活失败返回非零，命令代理回传 failed；未分配或不支持的频段仍按设备能力跳过。 |
| 网关拓扑字段丢失 | node-info loader 接受 WAN 接口、LAN 接口列表和 LAN IP，继续按数据解析，保持命令替换等文本不执行。 |
| 启动条件吞掉真实故障 | `hive-gateway-prepare` 作为 `ExecCondition=` 时，退出码 1–254 表示条件不满足（systemd 跳过且判成功），255 表示失败。只有禁用网关和尚无配置可跳过；iptables 安装失败或阻断配置写入失败都返回 255，由 `Restart=on-failure` 重试。 |

验证：119 项固件测试、30 项订阅脚本测试、26 项硬件隔离测试、16 项设备/部署测试通过。Go 1.27.4 的 handler vet 及 amd64/arm64 编译通过；连到构建机 MySQL 完成退款、返利、上传与分片保留/清理的定向 `-race` 测试。固定 v3 action 在 Gitea hostname 环境下向隔离旧版 API 完成创建、逐字节上传和完成请求。变更脚本的 Bash 语法及替换本机不存在可执行路径后的 systemd 单元指令检查通过。

未运行真实 Gitea workflow、整盘镜像构建、真机启动或无线验收，也未部署线上。设备脚本和相应 systemd 单元需要配套安装并 reload。`hive-firmware` 与 `hive-node-info` 属受保护文件，普通应用 OTA 不会更新它们；当前 firmware 包也仅允许引导载荷与内核数据。存量设备须在维护窗口经可信管理通道安装这两项修复，或使用重建后的出厂镜像；本次没有放宽 OTA 路径保护。
