# 首次启动配置（Provision）详解

本文档描述 Hive Node 首次上电后 `provision-node.sh` 执行的完整流程，以及各步骤的设计原理。

---

## 一、触发机制

`provision-node.service` 在系统启动时由 systemd 执行。

```ini
# /etc/systemd/system/provision-node.service
[Service]
ExecStart=/usr/local/bin/provision-node.sh
```

**幂等保证**：脚本首先检查 `/etc/hive/provisioned` 文件是否存在，若存在则立即退出，确保每台设备只执行一次。

```bash
DONE_MARKER="/etc/hive/provisioned"
[ -f "$DONE_MARKER" ] && exit 0
```

**日志**：所有输出写入 `/var/log/provision-node.log`，同时也通过 journald 可查：

```bash
journalctl -u provision-node.service
```

---

## 二、等待网络

```bash
for i in $(seq 1 30); do
    ip route get 8.8.8.8 &>/dev/null && break
    sleep 2
done
```

最多等待 60 秒。若网络一直不通，后续 API 调用会失败，provision 失败。

---

## 三、加载共享配置

```bash
source /etc/hive/config.env
```

从镜像内嵌的配置文件读取 CF Token、Tailscale OAuth 等凭证，这些凭证在构建时由 `scripts/build.sh` 渲染写入。

---

## 四、设备唯一标识生成

### 主机名和 MAC 地址

```bash
IFACE=$(ip -o link show | awk '$2 !~ /^lo:/ {gsub(/:$/,"",$2); print $2; exit}')
MAC=$(cat /sys/class/net/${IFACE}/address | tr -d ':')
MAC6="${MAC: -6}"          # MAC 末 6 位，如 a4b2c1
HOSTNAME="hive-${MAC6}"   # 如 hive-a4b2c1
```

- **网卡选择**：取第一块非 lo 接口（通常是 eth0）
- **主机名格式**：`hive-<mac6>`，全局唯一且可读
- **Machine ID**：`systemd-machine-id-setup --commit` 基于 MAC 等熵源生成

### 确定性 SSH Host Key（Ed25519）

每次重刷镜像后，同一台设备的 SSH fingerprint 保持不变，无需重新信任。

```
SHA-256("hive-ssh-ed25519:<MAC>") → 32字节 seed
→ PKCS8 DER → PEM → OpenSSH 私钥格式
```

**设计原理**：
- seed 基于 MAC 地址，确定性推导，不依赖随机数
- 重刷镜像不会改变 fingerprint，避免 `ssh known_hosts` 警告
- 前缀 `hive-ssh-ed25519:` 作为 domain separator，防止不同用途的 key 碰撞

RSA 和 ECDSA key 仍随机生成（仅用于兼容旧客户端，fingerprint 不关键）。

### xray UUID（确定性）

```
SHA-256("hive-xray-uuid:<MAC>") → UUID v4 格式
```

UUID 遵循 RFC 4122 v4 格式规范（version=4, variant=10xx）。

**设计原理**：
- 每台设备有独立的 UUID，一台泄露不影响其他节点
- 重刷镜像后 UUID 不变，已配置的 v2ray 客户端无需更新

---

## 五、FRP 端口分配

```bash
PORT_OFFSET=$(echo "$MAC" | md5sum | tr -dc '0-9' | cut -c1-4)
FRP_PORT=$((10000 + 10#$PORT_OFFSET % 50000))
```

端口范围：10000–60000，与 frps.toml 的 `allowPorts` 配置一致。

**碰撞概率**：50000 个端口分配给 N 台设备，N=100 时碰撞概率约 0.1%（生日问题）。实际发生碰撞时，FRP 连接会失败但不影响其他管理通道。

---

## 六、EasyTier IP 分配

```bash
ET_B1=$(printf "%d" "0x${MAC6:0:2}")
ET_B2=$(printf "%d" "0x${MAC6:2:2}")
ET_B3=$(printf "%d" "0x${MAC6:4:2}")
EASYTIER_IP="10.${ET_B1}.${ET_B2}.${ET_B3}"
```

示例：MAC6=`a4b2c1` → EasyTier IP=`10.164.178.193`

**注意**：EasyTier IP 仅在 `10.0.0.0/8` 内部使用，不对外暴露。理论碰撞风险与 MAC 末 6 位相同（2^24 ≈ 1600 万）。

---

## 七、Cloudflare Tunnel 创建（幂等）

```
1. 查询同名 tunnel 是否已存在
   ├── 存在 + 本地 cert.json 也存在 → 直接复用
   └── 存在 + 无 cert.json → 删除旧 tunnel（无法拿到 secret）→ 重建
2. 创建 tunnel，获取 TUNNEL_ID + TUNNEL_SECRET
3. 写入 /etc/cloudflared/cert.json
4. 创建/更新 DNS CNAME 记录（hive-<mac6>.yourdomain.com → tunnel.cfargotunnel.com）
5. 写入 /etc/cloudflared/config.yml
```

**幂等设计要点**：
- CF API 的 tunnel secret 仅在创建时返回一次，之后无法查询
- 本地 `cert.json` 是 secret 的唯一保存位置
- 如 cert.json 丢失（重刷镜像），必须删除旧 tunnel 后重建

---

## 八、启动核心服务

按顺序 enable 并立即启动：

```
nginx         — 反向代理（监听 127.0.0.1:10077，WebSocket /ray → xray）
xray          — VLESS+WS 代理（监听 127.0.0.1:10079）
cloudflared   — CF Tunnel（连接到 CF edge）
frpc          — FRP 客户端（SSH 应急隧道）
easytier      — P2P mesh 网络
```

防火墙和 fail2ban 标记为非致命（失败不中止 provision）：

```bash
systemctl enable --now hive-firewall || echo "non-fatal"
systemctl enable --now hive-fail2ban || echo "non-fatal"
```

---

## 九、Tailscale 加入

使用 OAuth Client Secret 自动生成一次性 auth key，避免 auth key 过期问题：

```
1. 从 TAILSCALE_OAUTH_SECRET 提取 client ID
2. POST /api/v2/oauth/token → access token
3. POST /api/v2/tailnet/-/keys → 生成 5 分钟有效期的 pre-auth key
4. tailscale up --authkey=<生成的 key>
5. 清理同名 stale 节点（重刷镜像后可能残留旧记录）
```

**Stale 节点清理**：`tailscale up` 完成后，脚本会查询 tailnet 中所有同 hostname 的设备，删除非当前设备的旧记录，防止 Tailscale 控制台出现重复条目。

**回退机制**：若 OAuth 流程失败，直接使用 OAUTH_SECRET 尝试（旧版行为）。

---

## 十、上报 Node Registry

```bash
curl -X POST "${NODE_REGISTRY_URL}/api/nodes/register" \
    -d "{mac, mac6, hostname, cf_url, tailscale_ip, easytier_ip, frp_port, xray_uuid}"
```

此步骤非关键，失败不影响节点正常运行。

---

## 十一、自我禁用

```bash
touch /etc/hive/provisioned
systemctl disable provision-node.service
```

完成后 provision-node.service 从自启动中移除，下次重启不再执行。

---

## 十二、Provision 时序图

```
设备上电
    │
    ▼
等待网络（最多 60 秒）
    │
    ▼
加载 /etc/hive/config.env
    │
    ├─► 生成 HOSTNAME / MAC / MAC6
    ├─► 生成确定性 SSH host key（Ed25519）
    ├─► 生成确定性 xray UUID
    ├─► 计算 FRP 端口 + EasyTier IP
    │
    ├─► Cloudflare API：创建 Tunnel + DNS 记录
    │
    ├─► 写入 /etc/hive/node-info
    │
    ├─► systemctl enable --now nginx xray cloudflared frpc easytier
    ├─► systemctl enable --now hive-firewall hive-fail2ban（非致命）
    │
    ├─► Tailscale：OAuth → auth key → tailscale up → 清理 stale 节点
    │
    ├─► 上报 Node Registry（非致命）
    │
    └─► touch /etc/hive/provisioned
        systemctl disable provision-node.service
            │
            ▼
        设备就绪（约 60-120 秒）
```

---

## 十三、Provision 状态查看

```bash
# 查看 provision 是否完成
ls -la /etc/hive/provisioned

# 实时跟踪 provision 日志（设备刚上电时）
journalctl -u provision-node.service -f

# 查看完整 provision 日志
cat /var/log/provision-node.log

# 查看节点信息汇总
cat /etc/hive/node-info
```

---

## 十四、重新 Provision（手动触发）

> **警告**：重新 provision 会重建 CF Tunnel（新的 Tunnel ID），旧 DNS 记录会被更新。xray UUID 和 SSH key 因为是确定性生成，不会改变。

```bash
# 删除完成标记
rm /etc/hive/provisioned

# 重新 enable 服务
systemctl enable provision-node.service

# 手动执行（或重启系统）
/usr/local/bin/provision-node.sh
```
