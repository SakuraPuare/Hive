-- Phase 0 端到端验证种子数据
-- 目的：为「烧好的第一台真机」造一条完整计费链路，验证注册→下发→计费→踢人闭环。
--
-- 用法（在管理 VPS 上，或本地连到 registry 的 MySQL）：
--   NODE_MAC=<真机12位MAC无冒号小写> envsubst < phase0-verify-seed.sql | mysql ...
-- 或先 `export NODE_MAC=...` 再用 phase0-verify-seed.sh 执行（推荐，见同目录脚本）。
--
-- 说明：
--   - 本脚本假定该 MAC 的节点【已经上电注册成功】（nodes 表里已有这台）。
--     若还没注册，先让设备上电注册，再跑本脚本。
--   - 幂等：可重复执行；靠固定 token/email 去重。
--   - 订阅额度默认 1 GiB，方便第 4 步「跑满即踢」验证。

SET @node_mac = '${NODE_MAC}';

-- 1. 把这台真机挂到一条测试线路上 ────────────────────────────────────────────
INSERT INTO `lines` (name, region, display_order, enabled, note, token, created_at, updated_at)
VALUES ('P0-验证线路', 'TEST', 99, 1, 'Phase0 e2e verify',
        'p000000000000000000000000000000000000000000000000000000000verify', NOW(), NOW())
ON DUPLICATE KEY UPDATE name = VALUES(name), enabled = 1, updated_at = NOW();

INSERT IGNORE INTO line_nodes (line_id, node_mac)
SELECT id, @node_mac FROM `lines`
WHERE token = 'p000000000000000000000000000000000000000000000000000000000verify';

-- 2. 套餐（1 GiB 额度，30 天）────────────────────────────────────────────────
INSERT INTO plans (name, traffic_limit, speed_limit, device_limit, duration_days, price, enabled, sort_order, created_at, updated_at)
VALUES ('P0-验证套餐', 1073741824, 0, 3, 30, 0, 1, 99, NOW(), NOW())
ON DUPLICATE KEY UPDATE traffic_limit = VALUES(traffic_limit), enabled = 1, updated_at = NOW();

-- 套餐授权该线路（plan_lines 复合主键，幂等）
INSERT IGNORE INTO plan_lines (plan_id, line_id)
SELECT p.id, l.id FROM plans p, `lines` l
WHERE p.name = 'P0-验证套餐'
  AND l.token = 'p000000000000000000000000000000000000000000000000000000000verify';

-- 3. 测试客户（密码 hash 是占位；本验证只用订阅 token，不走客户登录）──────────
INSERT INTO customers (email, password_hash, nickname, status, created_at, updated_at)
VALUES ('p0-verify@hive.local', 'x', 'P0 Verify', 'active', NOW(), NOW())
ON DUPLICATE KEY UPDATE status = 'active', updated_at = NOW();

-- 4. 订阅：固定 token + 固定 xray_uuid（方便脚本引用），额度 1 GiB，30 天后过期 ──
INSERT INTO customer_subscriptions
    (customer_id, plan_id, token, traffic_used, traffic_limit, device_limit,
     started_at, expires_at, status, xray_uuid, created_at, updated_at)
SELECT c.id, p.id,
       'p0sub00000000000000000000000000000000000000000000000000000verify',
       0, 1073741824, 3,
       NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), 'active',
       'feedface-0000-4000-8000-000000000000',
       NOW(), NOW()
FROM customers c, plans p
WHERE c.email = 'p0-verify@hive.local' AND p.name = 'P0-验证套餐'
ON DUPLICATE KEY UPDATE
    traffic_used = 0, status = 'active',
    expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY), updated_at = NOW();

-- 完成。订阅链接（把 <REGISTRY_URL> 换成你的，如 https://hive.sakurapuare.com/api）：
--   Clash : <REGISTRY_URL>/c/p0sub00000000000000000000000000000000000000000000000000000verify
--   VLESS : <REGISTRY_URL>/c/p0sub00000000000000000000000000000000000000000000000000000verify/vless
SELECT 'seed done. sub token = p0sub...verify, xray_uuid = feedface-0000-4000-8000-000000000000' AS result;
