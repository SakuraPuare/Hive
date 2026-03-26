INSERT INTO nodes
    (mac, mac6, hostname, cf_url, tunnel_id, tailscale_ip, easytier_ip, frp_port, xray_uuid, location, note, registered_at, last_seen)
VALUES
    ('02aabbcc0001', 'cc0001', 'hive-cc0001', 'https://tokyo-demo.local', '11111111-1111-4111-8111-111111111111', '100.64.0.11', '10.170.1.1', 21001, '11111111-1111-4111-8111-111111111111', 'JP-Tokyo', 'Demo Residential', '2026-01-01 12:00:00', '2026-03-26 08:00:00'),
    ('02aabbcc0002', 'cc0002', 'hive-cc0002', 'https://hongkong-demo.local', '22222222-2222-4222-8222-222222222222', '100.64.0.12', '10.170.1.2', 21002, '22222222-2222-4222-8222-222222222222', 'HK-HongKong', 'Demo Optimized', '2026-01-02 12:00:00', '2026-03-26 08:05:00'),
    ('02aabbcc0003', 'cc0003', 'hive-cc0003', 'https://singapore-demo.local', '33333333-3333-4333-8333-333333333333', '100.64.0.13', '10.170.1.3', 21003, '33333333-3333-4333-8333-333333333333', 'SG-Singapore', 'Demo Premium', '2026-01-03 12:00:00', '2026-03-26 08:10:00'),
    ('02aabbcc0004', 'cc0004', 'hive-cc0004', 'https://losangeles-demo.local', '44444444-4444-4444-8444-444444444444', 'pending', '10.170.1.4', 21004, '44444444-4444-4444-8444-444444444444', 'US-LosAngeles', 'Demo Offline', '2026-01-04 12:00:00', '2026-03-20 08:00:00')
AS new_nodes
ON DUPLICATE KEY UPDATE
    mac6 = new_nodes.mac6,
    hostname = new_nodes.hostname,
    cf_url = new_nodes.cf_url,
    tunnel_id = new_nodes.tunnel_id,
    tailscale_ip = new_nodes.tailscale_ip,
    easytier_ip = new_nodes.easytier_ip,
    frp_port = new_nodes.frp_port,
    xray_uuid = new_nodes.xray_uuid,
    location = new_nodes.location,
    note = new_nodes.note,
    last_seen = new_nodes.last_seen;

INSERT INTO subscription_groups
    (name, token, created_at, updated_at)
VALUES
    ('Demo Starter', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-01-01 12:00:00', '2026-03-26 08:00:00'),
    ('Demo Asia', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-01-01 12:00:00', '2026-03-26 08:00:00')
AS new_groups
ON DUPLICATE KEY UPDATE
    name = new_groups.name,
    updated_at = new_groups.updated_at;

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
