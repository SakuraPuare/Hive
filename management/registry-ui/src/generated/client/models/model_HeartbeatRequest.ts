/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type model_HeartbeatRequest = {
    /**
     * Country is the node's egress country (ISO-3166 alpha-2). Empty on legacy
     * agents; the registry keeps the last known value.
     */
    country?: string;
    cpu_pct?: number;
    disk_pct?: number;
    mac?: string;
    mem_pct?: number;
    uptime_sec?: number;
};

