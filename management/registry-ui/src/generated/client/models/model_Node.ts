/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type model_Node = {
    /**
     * 网关设备计费绑定：非空时，本网关走上游 Hive 节点的流量按此客户订阅的
     * UUID 下发（email sub-<id>），被 traffic.go 计入该订阅；为空则沿用节点级
     * UUID（node-*，不计费）。
     */
    bound_subscription_id?: number;
    cf_url?: string;
    claimed_at?: string;
    easytier_ip?: string;
    enabled?: boolean;
    frp_port?: number;
    /**
     * 分流方向：domestic（境内,墙外走代理）/ overseas（境外,墙内走代理）/ global（全走代理）/ direct（全直连）
     */
    gateway_direction?: string;
    /**
     * ── 透明代理网关角色（gateway）──────────────────────────────────────
     * 节点作为"梯子入口"：LAN/WiFi 设备连上后流量经本机 Mihomo 透明代理。
     */
    gateway_enabled?: boolean;
    /**
     * 上游选择：auto（url-test 自动选最快）/ manual（手选）
     */
    gateway_upstream_mode?: string;
    /**
     * manual 模式下选定的上游节点 MAC，逗号分隔
     */
    gateway_upstream_nodes?: string;
    hostname?: string;
    last_seen?: string;
    location?: string;
    mac?: string;
    mac6?: string;
    mesh_ip?: string;
    mesh_tunnel_id?: string;
    note?: string;
    /**
     * 设备归属：owner_customer_id 非空即"这台设备属于某客户"，客户可在门户查看/管理。
     * claim_code_hash 只存哈希、不出 JSON（明文仅在注册响应回传一次）。
     */
    owner_customer_id?: number;
    probe_status?: string;
    region?: string;
    registered_at?: string;
    status?: string;
    tailscale_ip?: string;
    tunnel_id?: string;
    weight?: number;
    xray_uuid?: string;
};

