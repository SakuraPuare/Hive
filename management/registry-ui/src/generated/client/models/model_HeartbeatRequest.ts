/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { model_DeviceAddressSnapshot } from './model_DeviceAddressSnapshot';
import type { model_ServiceStatus } from './model_ServiceStatus';
export type model_HeartbeatRequest = {
    /**
     * Addresses is omitted by legacy agents; receipt time must remain unchanged.
     */
    addresses?: model_DeviceAddressSnapshot;
    /**
     * Country is the node's egress country (ISO-3166 alpha-2). Empty on legacy
     * agents; the registry keeps the last known value.
     */
    country?: string;
    cpu_pct?: number;
    disk_pct?: number;
    mac?: string;
    mem_pct?: number;
    /**
     * Services is omitted by legacy agents; nil must not invent a fresh sample.
     */
    services?: Array<model_ServiceStatus>;
    uptime_sec?: number;
};

