/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_DashboardEndpoint } from './handler_DashboardEndpoint';
import type { model_DeviceEgress } from './model_DeviceEgress';
export type handler_DashboardResponse = {
    egress?: model_DeviceEgress;
    endpoints?: Array<handler_DashboardEndpoint>;
    mac?: string;
    sampled_at?: string;
    secret?: string;
};

