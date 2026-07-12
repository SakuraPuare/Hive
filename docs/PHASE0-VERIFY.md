# Phase 0：新设备端到端验证清单

在开发计费闭环 / 订阅转换 / 第三方线路之前，**必须先在一台真机上证明底座链路是通的**。
线上 11 台仍是 `v1.0.0`，新镜像的 per-user 计费、网关代理、xray-exporter 从未在真机跑过。
本清单验证「烧一台新设备 → 上电注册 → 订阅下发 → 流量计费 → 超量踢人」全链路。

前置：已按 `README.md` 构建出新镜像；服务端（registry + Prometheus + Grafana）已部署（现网 `hive.sakurapuare.com` 已在线）。

以下 `<REGISTRY>` 指 `https://hive.sakurapuare.com/api`，`<SECRET>` 指 `.env` 里的 `REGISTRY_API_SECRET`。

---

## 0. 烧录并上电

```bash
xzcat armbian-build/build/output/images/*.img.xz | sudo dd of=/dev/sdX bs=4M status=progress conv=fsync
```
插卡上电，等约 2 分钟。

## 1. 确认注册成功

```bash
# 记下这台的 mac6（末6位），下面处处要用
tailscale status | grep hive-
# 该 MAC 应出现在节点列表，且 last_seen 是刚才
curl -s -H "Authorization: Bearer <SECRET>" "<REGISTRY>/nodes" | jq '.[] | select(.hostname|test("<mac6>")) | {hostname,last_seen,status}'
```
- [ ] 新节点出现在列表
- [ ] `last_seen` 是今天（注册那一刻写的）

## 2. 造测试订阅并确认下发（≤60s）

```bash
# 在管理 VPS 上（MYSQL_* 按实际填），NODE_MAC 用完整12位
NODE_MAC=<12位mac> bash management/registry/dev/phase0-verify-seed.sh
```
脚本会：把这台挂到 `P0-验证线路` → 建 `P0-验证套餐`(1 GiB) → 建客户 → 建订阅
（token `p0sub...verify`，xray_uuid `feedface-0000-4000-8000-000000000000`）。

```bash
# 节点每 60s 拉一次它该放的用户；确认这个订阅 UUID 出现了
curl -s -H "Authorization: Bearer <SECRET>" "<REGISTRY>/nodes/<12位mac>/xray-users" | jq
```
- [ ] `users[]` 里含 `feedface-0000-4000-8000-000000000000`（email `sub-<订阅id>`）
- [ ] 拿订阅链接导入客户端，选这台节点，**能连上、能上网**
      - Clash: `<REGISTRY>/c/p0sub00000000000000000000000000000000000000000000000000000verify`
      - VLESS: 同上 `+ /vless`

## 3. 确认流量计费（≤5min）

用客户端走这台节点跑一点流量（下个几十 MB）。等 5 分钟（`traffic.go` loop 周期）。

```bash
# traffic_used 应从 0 涨上来
curl -s -H "Authorization: Bearer <SECRET>" "<REGISTRY>/admin/traffic/summary" | jq
# 或直接查库
#   SELECT traffic_used FROM customer_subscriptions WHERE token LIKE 'p0sub%verify';
```
- [ ] 该订阅 `traffic_used` > 0（说明 xray stats → exporter → Prometheus → registry 链路通）
- [ ] Grafana 能看到该节点 xray per-user 指标

## 4. 确认超量踢人（≤60s）

```sql
-- 把额度调到已用尽
UPDATE customer_subscriptions SET traffic_limit = 1 WHERE token LIKE 'p0sub%verify';
```
```bash
# 下一轮 xray-users 该订阅应消失
curl -s -H "Authorization: Bearer <SECRET>" "<REGISTRY>/nodes/<12位mac>/xray-users" | jq
```
- [ ] `users[]` 里**不再有** `feedface-...`（超量被过滤）
- [ ] 客户端 ≤60s 内断线，重连失败

## 5. 网关 / 热点（视硬件）

**Zero2 + USB 无线网卡：**
```bash
ssh root@hive-<mac6> 'cat /etc/hive/node-info | grep WIFI_'
```
- [ ] `WIFI_SSID*` 有值，手机能搜到 `Hive-<MAC>` 并用派生密码连上、能上网

**R3S 双网口：**
```bash
ssh root@hive-<mac6> 'cat /etc/hive/node-info | grep GATEWAY_'
```
- [ ] `GATEWAY_LAN_IFACES` 有值；设备插 LAN 口能拿到 `10.42.2.x` 且能上网
- [ ] clash-config 拉到的是真配置（非兜底全直连）：
      `ssh root@hive-<mac6> 'grep -c proxies /etc/mihomo/config.yaml'` 且 proxies 段含上游节点

---

## 收尾：清理验证数据

```sql
DELETE FROM customer_subscriptions WHERE token LIKE 'p0sub%verify';
DELETE FROM customers WHERE email = 'p0-verify@hive.local';
DELETE FROM plan_lines WHERE plan_id = (SELECT id FROM plans WHERE name='P0-验证套餐');
DELETE FROM plans WHERE name = 'P0-验证套餐';
DELETE FROM line_nodes WHERE line_id = (SELECT id FROM lines WHERE token LIKE 'p0%verify');
DELETE FROM lines WHERE token LIKE 'p0%verify';
```

---

## 判定

- 1-4 全绿 → **计费底座可信**，可开工 Track 1（网关计费闭环）。
- 5 全绿 → 本地代理硬件可信，可开工 Track 2/3。
- 任一红 → 先修底座，别往上叠功能（详见各步骤对应的服务端/节点侧组件）。
