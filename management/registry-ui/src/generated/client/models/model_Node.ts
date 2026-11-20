/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type model_Node = {
    /**
     * 网关设备计费绑定：非空时，本网关走上游 Hive 节点的流量按此客户订阅的
     * UUID 下发（email sub-<id>），由可信出口计入该订阅；未绑定或失效时拒绝转发。
     */
    bound_subscription_id?: number;
    cf_url?: string;
    claimed_at?: string;
    /**
     * Country 是节点出口所在国家（ISO-3166 alpha-2），由心跳上报；用于
     * gateway_direction=auto 时判定"在大陆就出海、不在大陆就回国"。
     */
    country?: string;
    /**
     * CountryOverride 非空时覆盖心跳上报的 Country（人工指定位置），
     * gateway_direction=auto 用它判定分流方向。空串表示跟随上报。
     */
    country_override?: string;
    easytier_ip?: string;
    enabled?: boolean;
    /**
     * ExitDirection 决定节点服务哪一类订阅，不参与"是否出口"的判定：
     * overseas（默认）节点在墙外，进"出海"订阅（国内用户翻墙）；
     * domestic 节点在墙内，进"回国"订阅（海外用户访问国内服务）。
     * 两类订阅使用不同的分流规则，因此不能混在同一份客户端配置里。
     */
    exit_direction?: string;
    /**
     * ── 出口开关（默认开启）──────────────────────────────────────────────
     * ExitEnabled 是管理员开关；OwnerExitEnabled 是设备所有者在客户门户的开关。
     * 实际是否作为 Xray 出口 = ExitEnabled && OwnerExitEnabled && Enabled && Status==active。
     */
    exit_enabled?: boolean;
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
     * 认领校验只认 claim_code_hash；claim_code 是管理员面板展示用的明文，
     * 不出现在节点 JSON 中（见 /admin/nodes/{mac}/claim-code）。
     */
    owner_customer_id?: number;
    owner_exit_enabled?: boolean;
    probe_status?: string;
    region?: string;
    registered_at?: string;
    /**
     * Only explicitly provisioned operator-controlled exit servers may meter traffic.
     */
    server_enabled?: boolean;
    status?: string;
    /**
     * SubscriptionSync 表示该节点的 Xray 会不会接受"订阅用户"的 UUID。
     * 新镜像由 hive-xray-sync 从 /nodes/{mac}/xray-users 拉取并写入 clients；
     * 旧镜像只有一个静态 client（节点自身 UUID），网关必须改用节点自身 UUID。
     * 节点首次 POST 计费快照时自动置 1，因此旧节点升级后无需人工干预。
     */
    subscription_sync?: boolean;
    tailscale_ip?: string;
    tunnel_id?: string;
    weight?: number;
    xray_uuid?: string;
};

