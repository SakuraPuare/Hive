/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type handler_DashboardResponse = {
    mac?: string;
    /**
     * 面板 API 密钥（per-node，HMAC(server key, mac)）
     */
    secret?: string;
    /**
     * 直接打开面板的候选地址（需在节点 LAN/mesh 内）
     */
    urls?: Array<string>;
};

