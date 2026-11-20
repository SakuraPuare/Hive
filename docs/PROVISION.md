> 认证变更：共享 Registry 密钥已停用。设备需独立 MAC 凭证，管理自动化使用 `ADMIN_API_SECRET`；升级步骤见 [审查修复与迁移](review-remediation.md)。

# 首次启动配置（Provision）详解

本文档描述 Hive Node 首次上电后 `provision-node.sh` 执行的完整流程，以及各步骤的设计原理。

---

## 一、触发机制

`provision-node.service` 在系统启动时由 systemd 执行。

```ini
# /etc/systemd/system/provision-node.service
[Unit]
After=network-online.target systemd-remount-fs.service armbian-resize-filesystem.service systemd-hostnamed.service
Wants=network-online.target
ConditionPathExists=!/etc/hive/provisioned
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/usr/local/bin/provision-node.sh
Restart=on-failure
RestartSec=60
TimeoutStartSec=900
```

单元排在根分区重新挂载为可写、首启扩容和 `systemd-hostnamed` 之后，避免在根分区仍为只读时写 `/etc`。`ConditionPathExists` 与脚本内的标记文件一起保证只成功跑完一次。

**幂等与失败重试**：脚本首先检查 `/etc/hive/provisioned`。文件不存在时才会继续。可恢复的失败以非零退出，systemd 每 60 秒再拉起一次，并且关掉了默认的启动频率限制。入网被 409 拒绝时，脚本写入 `/etc/hive/provision-blocked` 后以 0 退出，不会进入这个重试循环。

```bash
DONE_MARKER="/etc/hive/provisioned"
[ -f "$DONE_MARKER" ] && exit 0
```

运行期间会留下 `/etc/hive/provisioning`，供依赖本脚本产物的服务判断“置备还在进行”。正常退出、失败退出和超出预算的退出都会经 trap 删掉它。这个文件在进程消失后仍然残留，说明进程是被 SIGKILL 打断的（例如 systemd 的 `TimeoutStartSec`）。

**时间预算**：默认 `PROVISION_BUDGET=600` 秒，用 `/proc/uptime` 计算，不用 bash 的 `SECONDS`。首启时 RTC 不可用，NTP 在入网之后把时钟从镜像构建时刻跳到当前时刻；`SECONDS` 按 `time()` 差值计算，会被这次跳变拉长（脚本注释里的实测是多出 94 分钟），也可能从环境里继承一个已经很大的值。进入 Cloudflare、Tailscale、Registry 上报之前会检查预算。超出则退出且不写完成标记，systemd 约 60 秒后重试；机器重启后只要完成标记还不在，也会再跑。systemd 的 900 秒超时只是这层守卫失效时的兜底。

**日志**：标准输出经 `tee` 追加到 `/var/log/provision-node.log`，单元同时把输出交给 journal：

```bash
journalctl -u provision-node.service
```

---

## 二、等待网络

单元已经 `Wants=network-online.target`。脚本里仍有一层兜底，最多等 60 秒：

```bash
for i in $(seq 1 30); do
    ip route get 8.8.8.8 &>/dev/null && break
    sleep 2
done
```

到点仍没有到 `8.8.8.8` 的路由时，脚本继续往下走。随后的 Registry 与 Cloudflare 调用会失败；可恢复的失败不写完成标记，由上一节的 `Restart=on-failure` 再试。客户先上电、后插网线时靠的就是这个重试。

---

## 三、加载共享配置

```bash
source /etc/hive/config.env
[ ! -s /etc/hive/device-token ] || NODE_REGISTRY_API_SECRET=$(cat /etc/hive/device-token)
```

`/etc/hive/config.env` 在构建时由 `scripts/build.sh` 用 `configs/hive/config.env.tpl` 渲染进镜像，包含 Cloudflare、Tailscale OAuth、EasyTier、FRP、`NODE_REGISTRY_URL`、伪装跳转和 `SSH_IMPORT_GITHUB`。模板里的 `NODE_REGISTRY_API_SECRET` 只接受构建参数 `DEVICE_API_TOKEN`。`.env.example` 要求共用镜像把 `DEVICE_API_TOKEN` 留空，每台设备自行入网；不要把已停用的共享 Registry 密钥写进镜像。

`NODE_REGISTRY_URL` 要写到 `/api` 这一级、末尾不加斜杠（见 `.env.example`）。脚本请求的是 `${NODE_REGISTRY_URL}/nodes/...`。

`/etc/hive/device-token` 非空时覆盖 `NODE_REGISTRY_API_SECRET`。只有 URL 有值且这个变量仍为空时，才会进入下一节的入网。

---

## 四、设备唯一标识

### 主机名和网卡

```bash
source /usr/local/bin/hive-board
IFACE=$(hive_identity_interface) || { echo 'No physical Ethernet interface found'; exit 1; }
MAC=$(cat /sys/class/net/${IFACE}/address | tr -d ':')
MAC6="${MAC: -6}"
HOSTNAME="hive-${MAC6}"
```

`hive_identity_interface` 只考虑有 `device` 的有线网卡（sysfs `type` 为 1，排除无线和 tunnel）。优先设备树别名 `ethernet0`，否则用第一块符合条件的网卡。找不到物理以太网时脚本直接退出。主机名是 `hive-<mac6>`。随后把主机名写入 `/etc/hostname` 和 `/etc/hosts` 的 `127.0.1.1`，并执行 `systemd-machine-id-setup --commit`。`hostnamectl` 失败不会中止置备。

### SSH Host Key

SSH host key 由 `hive-regen-hostkeys.service` 在 sshd 之前生成，不依赖网络。镜像构建时会启用这个单元。`hive-regen-hostkeys.sh` 在缺少 `/etc/hive/random-hostkeys-v1` 或 ed25519 私钥为空时，用 `ssh-keygen -t ed25519` 生成随机密钥并写下标记，然后执行 `ssh-keygen -A` 补齐其余类型。旧的、由 MAC 推导的 Ed25519 密钥会在这一次被换掉。

`provision-node.sh` 只在 ed25519 私钥仍然缺失时再调用该脚本，并重启 ssh，避免 sshd 在密钥就绪前启动失败后一直停着。`hive-data` 把 `/etc/ssh` 和 `/etc/hive` 绑定到数据分区，所以换槽或重刷系统盘、但保留 `hive-data` 分区时，fingerprint 不变。清掉数据分区会生成新密钥。

### xray UUID

UUID 是随机的，不从 MAC 推导。已有 `/etc/hive/xray-uuid` 时沿用，因此同一次置备的重试不会换 UUID：

```bash
if [ ! -s /etc/hive/xray-uuid ]; then
    cat /proc/sys/kernel/random/uuid > /etc/hive/xray-uuid.new
    mv -f /etc/hive/xray-uuid.new /etc/hive/xray-uuid
fi
```

脚本会对 `/etc/xray/config.json` 做 `%%XRAY_UUID%%`、`%%NODE_MAC%%` 替换。当前镜像里的这份配置没有这两个占位符，`clients` 为空；UUID 只作为节点元数据写入 `/etc/hive/xray-uuid` 和 `node-info`，并在注册时上报。`/etc/hive` 与 `/etc/xray` 都由 `hive-data` 绑定到数据分区：保留该分区则重刷后 UUID 不变，清掉数据分区会得到新 UUID。

### 伪装跳转与 GitHub 公钥

`CAMOUFLAGE_URL` 默认 `https://www.cloudflare.com/`，替换 nginx 站点里的 `%%CAMOUFLAGE_URL%%` 后执行 `nginx -t` 并 reload。nginx 在镜像构建时已经 enable，监听 `127.0.0.1:10077`：`/ray` 反代到 xray 的 `127.0.0.1:10079`，其余路径 302 到伪装地址。

`SSH_IMPORT_GITHUB` 为逗号分隔的 GitHub 用户名时，脚本把 `https://github.com/<用户>.keys` 追加到 `/root/.ssh/authorized_keys`。拉取失败只告警。构建时若 `.env` 未设置该变量，`scripts/build.sh` 回退为 `SakuraPuare`。留空则跳过，root 仍使用镜像里的预设密码。重新执行会再次追加，不会先清空已有公钥。

---

## 五、设备入网

发号、注册、心跳都要求 `device_credentials` 里该 MAC 的 token。`RequireDeviceAuth` 不接受共享密钥，也不接受只有 MAC、没有 Bearer 的请求。入网本身不带 Authorization 头，token 在 JSON 正文里。

没有本机凭证时，脚本用 `openssl rand -hex 32` 生成 64 位十六进制 token，以 `umask 077` 写入临时文件，按 **sync 文件 → rename → sync 目录** 落到 `/etc/hive/enrollment-token`，然后才发请求。文件已存在则读取重试，不会重新生成。格式不对则退出并保留原文件，交给管理员处理。请求使用 `curl -4`（避开 IPv6 与 Mihomo 的半开路径），最多 6 次，间隔 5 秒，单次 `--max-time 15`。

```bash
curl -4 -s -o "$enroll_body" -w '%{http_code}' --max-time 15 \
  -X POST "${NODE_REGISTRY_URL}/nodes/enroll" \
  -H 'Content-Type: application/json' \
  -d "{\"mac\":\"${MAC}\",\"mac6\":\"${MAC6}\",\"hostname\":\"${HOSTNAME}\",\"token\":\"${enrollment_token}\"}"
```

成功时 HTTP 200 且响应里的 `token` 等于请求 token。响应形状示例：`{"mac":"...","token":"<原请求 token>","claim_code":"K7QF-2M9X"}`。脚本先按同样的原子顺序写 `/etc/hive/claim-code`，最后写 `/etc/hive/device-token`。响应丢失，或在写完 `device-token` 之前掉电，下次仍用原来的 `enrollment-token` 重试。`/etc/hive` 由 `hive-data` 绑定到数据分区；换槽、OTA 或重刷系统盘都不丢，清除数据分区则会丢失。

| 文件 | 内容 | 用途 |
|------|------|------|
| `/etc/hive/enrollment-token` | 入网前持久化的 64 位十六进制随机秘密 | 丢响应或掉电后证明同一次入网；它存在不代表入网已完成 |
| `/etc/hive/device-token` | 服务端确认后的本机凭证（每 MAC 一把） | 发号、注册、心跳、命令、OTA、订阅拉取 |
| `/etc/hive/claim-code` | 认领码（registry 同时存 sha256 与管理员视图明文） | MOTD 展示，客户在门户「我的设备 → 认领」绑定；管理员可在节点详情查看 |

服务端只存 token 哈希。相同 token 的重试返回 200，不轮换凭证，也不重置归属或节点配置。认领码是 `SHA-256("hive:enrollment-claim:v1" + NUL + MAC + NUL + token)` 的前 8 个字节各自取低 5 位，再编成 Crockford `XXXX-XXXX`。重试只有在推导值仍等于库内认领码哈希时才回传明文。已有的历史认领码不会被覆盖。成功入网会留下节点行（`registered_at` / `last_seen`），不必等 Cloudflare 或 Tailscale 完成。之后的 `register` 再补 `cf_url`、`tailscale_ip`、`tunnel_id` 等字段。

缺失或格式错误的 token 返回 400。不同 token、管理员轮换前的旧 token，以及没有本机凭证的已认领或服务器节点，返回 409。409 时脚本把原因写入 `/etc/hive/provision-blocked` 并以 0 退出，systemd 不再重试。仅凭 MAC 不能取回秘密。尚未发证、也未认领的旧节点可以入网，并保留原认领码和注册元数据。六次都失败且仍没有凭证时，脚本以非零退出，systemd 约 60 秒后重试。凭证已经到手后，旧的 `provision-blocked` 会被删掉。

持久化秘密丢失（换卡或清盘）时，由管理员轮换。这个接口接受 `ADMIN_API_SECRET` 的 Bearer，或带 `node:write` 的管理会话：

```bash
curl -fsS -X POST "${NODE_REGISTRY_URL}/admin/nodes/${MAC}/credential" \
  -H "Authorization: Bearer ${ADMIN_API_SECRET}"
# → {"mac":"...","token":"..."}；把 token 写进 /etc/hive/device-token 后重跑 provision
```

`hive-command-agent.timer` 在镜像构建时启用，开机约 90 秒后首次运行，之后每 60 秒一次（另有 15 秒抖动）。它 `POST /nodes/heartbeat`，正文含 `cpu_pct`、`mem_pct`、`disk_pct`、`uptime_sec`、`services`，能采集到时还有地址快照和 `country`。心跳失败只记日志，不影响命令通道。这不是 `provision-node.sh` 里的一步。

---

## 六、FRP 端口

```bash
PORT_HEX=$(printf '%s' "$MAC" | md5sum | cut -c1-8)
FRP_PORT=$((10000 + 0x${PORT_HEX} % 50000))
```

结果落在 10000–59999。`docs/management/01-foreign-vps.md` 里 frps 的 `allowPorts` 是 10000–60000。端口和主机名会写入 `/etc/frp/frpc.toml` 的 `%%FRP_PORT%%`、`%%HOSTNAME%%`。

100 台设备共享 50000 个端口时，至少两台撞号的概率大约是 10%（生日问题近似 \(n(n-1)/(2\times50000)\)）。碰撞只让 FRP 连不上，不影响 EasyTier 和 Tailscale。早先只截 MD5 里的十进制数字，端口实际挤在 10000–19999；当前脚本已经改成上面的 8 位十六进制取模。

---

## 七、EasyTier IP

入网拿到本机凭证之后，向 registry 做静态发号。同一 MAC 重复调用返回已落库的地址：

```bash
curl -4 -s -o /tmp/easytier-alloc.json -w '%{http_code}' --max-time 15 \
  -X POST "${NODE_REGISTRY_URL}/nodes/allocate-easytier" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${NODE_REGISTRY_API_SECRET}" \
  -d "{\"mac\": \"${MAC}\"}"
```

最多 6 次，间隔 5 秒。401 或 403 表示凭证缺失或已轮换，立即失败，不再空等。最终没有 `easytier_ip` 则退出且不写完成标记，systemd 约 60 秒后重试。

地址池是 `172.20.0.0/16`：

- `172.20.0.0/24` 是基础设施保留段（relay、阿里云、集群 pod 等手动占位），发号器跳过。
- 自动分配从 `172.20.1.0` 到 `172.20.255.254`。
- `easytier_allocations.ip_int` 是主键，`mac` 唯一，避免重号和一机多号。
- 旧的按 MAC 自算 `10.x` 会落在 `10.0.0.0/8`，与 Kubernetes 的 Pod/Service 网段重叠，已经废弃。

---

## 八、Cloudflare Tunnel

这一段失败不会中止置备。Tailscale 和 EasyTier 仍可继续，并写下空文件 `/etc/hive/cloudflare-unavailable`。

```
1. 查询未删除的同名 tunnel（hive-<mac6>）
   ├── 存在且本地 /etc/cloudflared/cert.json 也在 → 复用
   └── 存在但没有 cert.json → 删除旧 tunnel 后重建（secret 只在创建时返回）
2. 创建失败或传输失败 → 跳过 DNS 与 cloudflared，继续后面的步骤
3. 创建或更新 DNS CNAME：hive-<mac6>.<CF_DOMAIN>
   → <TUNNEL_ID>.cfargotunnel.com，proxied=true
4. 写入 /etc/cloudflared/config.yml（protocol: http2）
   ingress：该主机名 → http://localhost:10077，其余 → http_status:404
```

查询或删除的单次 API 抖动按“可以继续”处理，不会因为一次 Cloudflare 失败让整次首启退出。没有 `config.yml` 时，后面不会 `enable cloudflared`，避免固件试启动一直等一个没有配置的服务。

---

## 九、节点信息与核心服务

Cloudflare 步骤之后、Tailscale 之前，脚本写入 `/etc/hive/node-info`：主机名、MAC、EasyTier IP、FRP 端口、计划中的 `CF_URL`、xray UUID、Tunnel ID。此时 Mesh 字段还是 `none` / `pending`；Mesh 跑完后脚本只把结果打到日志，不会回写这两行。Tailscale 拿到 IPv4 后，会在 `TAILSCALE_HOST` 那一行下面补上 `TAILSCALE_IP`。

随后按顺序拉起服务。没有 `||` 的 `systemctl enable` 失败会因为 `set -e` 中止本次置备，并且不写完成标记：

| 动作 | 失败时 |
|------|--------|
| `hive-subscription-guard.timer` | 中止 |
| `hive-xray-prepare.service`、`hive-gateway-route.service`（只 enable） | 继续 |
| `xray` | 继续；`hive-xray-sync.timer` 下一轮再拉 |
| `cloudflared`（仅当已有 `config.yml`） | 中止 |
| `frpc`、`easytier` | 中止 |
| `hive-xray-sync.timer`、`xray-exporter` | 继续 |
| `hive-hotspot.sh` | 继续；无无线网卡时脚本自己成功退出。细节见 [WiFi 热点](HOTSPOT.md)。成功后向 `node-info` 追加 `WIFI_PSK`、`WIFI_SSID`、`WIFI_IFACE`，双频时还有 `WIFI_SSID_2G` / `WIFI_SSID_5G` |
| `hive-gateway.sh`、`hive-mihomo.service`、`hive-clash-sync.timer` | 继续。细节见 [透明代理网关](GATEWAY.md)。网关脚本会写入 `GATEWAY_WAN_IFACE`、`GATEWAY_LAN_IFACES`、`GATEWAY_LAN_IP` |
| `hive-firewall`、`hive-fail2ban` | 继续 |

---

## 十、Tailscale

先 `systemctl enable --now tailscaled`。OAuth client secret 的形式是 `tskey-client-<ID>-<SECRET>`，脚本取出 client ID，再 `POST /api/v2/oauth/token` 换 access token，然后 `POST /api/v2/tailnet/-/keys` 签发一把 300 秒有效、不可复用、非临时、已预授权、带 `tag:hive` 的 auth key。签发失败时，退回直接使用 `TAILSCALE_OAUTH_SECRET`。

在 `tailscale up` 之前，脚本用同一 access token 列出 tailnet 设备，删掉 hostname 等于本机 `hive-<mac6>` 的旧节点，避免重刷后出现 `-1`、`-2` 后缀。删除失败只记日志。

```bash
tailscale up \
    --timeout=30s \
    --authkey="${TS_AUTHKEY}" \
    --hostname="${HOSTNAME}" \
    --accept-dns=false \
    || echo ">>> Tailscale up failed/timed out (tailscaled 会后台重试，non-fatal)"
```

`--timeout=30s` 避免代理路径异常时 `tailscale up` 一直堵住，直到 systemd 杀掉整个置备。超时或失败不中止后续步骤，tailscaled 在后台继续尝试上线。

---

## 十一、Cloudflare Mesh（WARP Connector）

Mesh 是可选通道，失败不中止置备。名称同样是 `hive-<mac6>`：

1. 已有未删除的同名 WARP Connector 则复用其 ID。
2. 否则先硬删除同名的已软删除残留（软删除后名字仍被占用，直接创建会返回 code 1013），再 `POST /warp_connector`。
3. 创建后取 token，执行 `warp-cli connector new` 和 `warp-cli connect`。
4. `warp-cli status` 里解析出的地址记入变量 `MESH_IP`，供最后的注册正文使用。

镜像构建时已经 enable `warp-svc`。`/var/lib/cloudflare-warp` 也在 `hive-data` 的绑定列表里。

---

## 十二、上报 Node Registry

```bash
curl -4 -sf --max-time 15 -X POST "${NODE_REGISTRY_URL}/nodes/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${NODE_REGISTRY_API_SECRET}" \
    -d "${REG_JSON}"
```

`REG_JSON` 含 `mac`、`mac6`、`hostname`、`cf_url`、`tunnel_id`、`tailscale_ip`、`easytier_ip`、`frp_port`、`xray_uuid`、`mesh_tunnel_id`、`mesh_ip`。服务端要求设备 Bearer，并且 `mac`、`hostname`、`cf_url`、`xray_uuid` 非空。解码时不读取正文里的 `easytier_ip`；地址以第七节发号时落库的值为准，注册时若库里仍为空会再补分配一次。`tailscale_ip` 非空才会覆盖库里的值。

最多 6 次，间隔 5 秒。六次都失败也不会中止：脚本接着写完成标记并禁用自己，因此漏注册不会在下次开机自动补，需要去掉完成标记后重跑，或等其他运维路径再次调用注册。Cloudflare 不可用时 `cf_url` 仍是 `https://hive-<mac6>.<CF_DOMAIN>`，`tunnel_id` 可以为空。

---

## 十三、自我禁用

```bash
touch /etc/hive/provisioned
systemctl disable provision-node.service
```

完成后该单元不再随开机启动。结束日志会打印 Tailscale MagicDNS 名、EasyTier 地址、FRP 端口、CF 主机名和 Mesh 地址。

---

## 十四、Provision 时序图

```
设备上电
    │
    ▼
hive-data 绑定 /etc/hive、/etc/ssh、/etc/cloudflared 等
hive-regen-hostkeys（随机 SSH host key，在 sshd 之前）
    │
    ▼
provision-node（等网络最多 60 秒，预算默认 600 秒）
    │
    ├─► 加载 config.env；已有 device-token 则跳过入网
    ├─► 以太网身份、主机名、随机 xray UUID、伪装 URL、GitHub 公钥
    ├─► POST /nodes/enroll（无凭证时）
    ├─► 计算 FRP 端口
    ├─► POST /nodes/allocate-easytier（失败则整次中止）
    │
    ├─► Cloudflare Tunnel + DNS（失败只标记不可用）
    ├─► 写 /etc/hive/node-info
    ├─► 启动 frpc、easytier、xray、热点、网关、防火墙等
    │
    ├─► Tailscale：OAuth → 清理同名旧节点 → tailscale up（超时非致命）
    ├─► Cloudflare Mesh / WARP Connector（非致命）
    ├─► POST /nodes/register（最多 6 次；失败仍会完成）
    │
    └─► touch /etc/hive/provisioned
        systemctl disable provision-node.service
```

---

## 十五、Provision 状态查看

```bash
# 是否完成
ls -la /etc/hive/provisioned

# 409 后停止自动重试的原因
cat /etc/hive/provision-blocked

# Cloudflare 这一段是否被跳过
ls -la /etc/hive/cloudflare-unavailable

# 实时跟踪（设备刚上电时）
journalctl -u provision-node.service -f

# 完整日志与节点信息
cat /var/log/provision-node.log
cat /etc/hive/node-info
```

---

## 十六、重新 Provision

删除完成标记会再跑一整轮。数据分区还在时，下面这些材料会被沿用，而不是重新生成：

| 仍存在的文件 | 重跑时的行为 |
|--------------|----------------|
| `/etc/hive/device-token` | 跳过入网 |
| `/etc/hive/xray-uuid` | UUID 不变 |
| `/etc/ssh/ssh_host_ed25519_key` 且 `/etc/hive/random-hostkeys-v1` 存在 | 不更换 SSH host key |
| 同名 tunnel 仍在，且 `/etc/cloudflared/cert.json` 存在 | 复用 Tunnel，不新建 |
| `/etc/hive/enrollment-token` 还在、但 `device-token` 还没写成功 | 用原 token 继续入网，不新生成 |

只有本地没有 `cert.json` 时，才会删掉云上的同名 tunnel 再创建。清除 `hive-data` 分区后，凭证、UUID、SSH host key、Tunnel secret 和 Tailscale 状态都会丢失。

```bash
rm /etc/hive/provisioned
systemctl enable provision-node.service
/usr/local/bin/provision-node.sh
```
