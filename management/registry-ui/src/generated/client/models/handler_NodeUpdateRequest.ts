/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type handler_NodeUpdateRequest = {
    /**
     * 网关计费绑定：设为某客户订阅 id 后本网关上游流量按该订阅计费；设为 null 解绑
     */
    bound_subscription_id?: number;
    easytier_ip?: string;
    enabled?: boolean;
    /**
     * 订阅方向：overseas（出海，节点在墙外，默认）/ domestic（回国，节点在墙内）
     */
    exit_direction?: string;
    /**
     * 管理员出口开关；默认 true。实际出口还需设备所有者的 owner_exit_enabled。
     */
    exit_enabled?: boolean;
    frp_port?: number;
    gateway_direction?: string;
    /**
     * 透明代理网关字段（此前 spec 漏标，前端靠 as 强转绕过）
     */
    gateway_enabled?: boolean;
    gateway_upstream_mode?: string;
    gateway_upstream_nodes?: string;
    location?: string;
    mesh_ip?: string;
    mesh_tunnel_id?: string;
    note?: string;
    region?: string;
    status?: string;
    tailscale_ip?: string;
    weight?: number;
};

