INSERT INTO nodes
    (mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, easytier_ip, frp_port, xray_uuid, location, note, registered_at, last_seen, enabled, status, weight, region, country, city, tags, offline_reason)
VALUES
    ('02aabbcc0001', 'cc0001', 'hive-cc0001', 'https://tokyo-demo.local', '11111111-1111-4111-8111-111111111111', '100.64.0.11', '10.170.1.1', 21001, '11111111-1111-4111-8111-111111111111', 'JP-Tokyo', 'Demo Residential', '2026-01-01 12:00:00', '2026-03-26 08:00:00', 1, 'active', 100, 'Asia', 'JP', 'Tokyo', 'residential', ''),
    ('02aabbcc0002', 'cc0002', 'hive-cc0002', 'https://hongkong-demo.local', '22222222-2222-4222-8222-222222222222', '100.64.0.12', '10.170.1.2', 21002, '22222222-2222-4222-8222-222222222222', 'HK-HongKong', 'Demo Optimized', '2026-01-02 12:00:00', '2026-03-26 08:05:00', 1, 'active', 200, 'Asia', 'HK', 'HongKong', 'optimized,premium', ''),
    ('02aabbcc0003', 'cc0003', 'hive-cc0003', 'https://singapore-demo.local', '33333333-3333-4333-8333-333333333333', '100.64.0.13', '10.170.1.3', 21003, '33333333-3333-4333-8333-333333333333', 'SG-Singapore', 'Demo Premium', '2026-01-03 12:00:00', '2026-03-26 08:10:00', 1, 'active', 150, 'Asia', 'SG', 'Singapore', 'premium', ''),
    ('02aabbcc0004', 'cc0004', 'hive-cc0004', 'https://losangeles-demo.local', '44444444-4444-4444-8444-444444444444', 'pending', '10.170.1.4', 21004, '44444444-4444-4444-8444-444444444444', 'US-LosAngeles', 'Demo Offline', '2026-01-04 12:00:00', '2026-03-20 08:00:00', 0, 'maintenance', 100, 'NorthAmerica', 'US', 'LosAngeles', '', 'Scheduled maintenance')
ON DUPLICATE KEY UPDATE
    mac6 = VALUES(mac6),
    hostname = VALUES(hostname),
    cf_url = VALUES(cf_url),
    tunnel_id = VALUES(tunnel_id),
    tailscale_ip = VALUES(tailscale_ip),
    easytier_ip = VALUES(easytier_ip),
    frp_port = VALUES(frp_port),
    xray_uuid = VALUES(xray_uuid),
    location = VALUES(location),
    note = VALUES(note),
    last_seen = VALUES(last_seen),
    enabled = VALUES(enabled),
    status = VALUES(status),
    weight = VALUES(weight),
    region = VALUES(region),
    country = VALUES(country),
    city = VALUES(city),
    tags = VALUES(tags),
    offline_reason = VALUES(offline_reason);

INSERT INTO subscription_groups
    (name, token, created_at, updated_at)
VALUES
    ('Demo Starter', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-01-01 12:00:00', '2026-03-26 08:00:00'),
    ('Demo Asia', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-01-01 12:00:00', '2026-03-26 08:00:00')
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    updated_at = VALUES(updated_at);

INSERT IGNORE INTO subscription_group_nodes (group_id, node_mac)
SELECT id, '02aabbcc0001' FROM subscription_groups
WHERE token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

INSERT IGNORE INTO subscription_group_nodes (group_id, node_mac)
SELECT id, '02aabbcc0002' FROM subscription_groups
WHERE token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

INSERT IGNORE INTO subscription_group_nodes (group_id, node_mac)
SELECT id, '02aabbcc0001' FROM subscription_groups
WHERE token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

INSERT IGNORE INTO subscription_group_nodes (group_id, node_mac)
SELECT id, '02aabbcc0002' FROM subscription_groups
WHERE token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

INSERT IGNORE INTO subscription_group_nodes (group_id, node_mac)
SELECT id, '02aabbcc0003' FROM subscription_groups
WHERE token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

-- ── Demo Lines ──────────────────────────────────────────────────────────────

INSERT INTO lines
    (name, region, display_order, enabled, note, token, created_at, updated_at)
VALUES
    ('日本家宽', 'JP', 1, 1, 'Demo residential line', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '2026-01-01 12:00:00', '2026-03-26 08:00:00'),
    ('亚洲优化', 'Asia', 2, 1, 'Demo optimized line', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '2026-01-01 12:00:00', '2026-03-26 08:00:00')
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    region = VALUES(region),
    display_order = VALUES(display_order),
    enabled = VALUES(enabled),
    note = VALUES(note),
    updated_at = VALUES(updated_at);

INSERT IGNORE INTO line_nodes (line_id, node_mac)
SELECT id, '02aabbcc0001' FROM lines
WHERE token = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

INSERT IGNORE INTO line_nodes (line_id, node_mac)
SELECT id, '02aabbcc0001' FROM lines
WHERE token = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

INSERT IGNORE INTO line_nodes (line_id, node_mac)
SELECT id, '02aabbcc0002' FROM lines
WHERE token = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

INSERT IGNORE INTO line_nodes (line_id, node_mac)
SELECT id, '02aabbcc0003' FROM lines
WHERE token = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
