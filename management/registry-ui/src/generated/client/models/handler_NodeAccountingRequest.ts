/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_NodeOnlineDevice } from './handler_NodeOnlineDevice';
import type { handler_NodeTrafficCounter } from './handler_NodeTrafficCounter';
export type handler_NodeAccountingRequest = {
    counters?: Array<handler_NodeTrafficCounter>;
    /**
     * Xray systemd InvocationID
     */
    epoch?: string;
    /**
     * Monotonic per-node runtime, zero for legacy agents
     */
    generation?: string;
    online?: Array<handler_NodeOnlineDevice>;
    /**
     * Agent understands owner-* users; legacy agents default to paid users only
     */
    owner_access?: boolean;
};

