/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_NodeDeviceLimit } from './handler_NodeDeviceLimit';
import type { handler_XrayUser } from './handler_XrayUser';
export type handler_NodeXrayUsersResponse = {
    device_limits?: Array<handler_NodeDeviceLimit>;
    lease_seconds?: number;
    mac?: string;
    users?: Array<handler_XrayUser>;
};

