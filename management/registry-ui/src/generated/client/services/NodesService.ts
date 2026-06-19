/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_NodeRegisterRequest } from '../models/handler_NodeRegisterRequest';
import type { handler_NodeRegisterResponse } from '../models/handler_NodeRegisterResponse';
import type { handler_NodeXrayUsersResponse } from '../models/handler_NodeXrayUsersResponse';
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { model_HeartbeatRequest } from '../models/model_HeartbeatRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NodesService {
    /**
     * Gateway Mihomo config for a node
     * Returns the full Mihomo (Clash.Meta) YAML config for this node's
     * transparent-proxy gateway role. The upstream proxy pool is every
     * enabled exit node in the cluster EXCEPT this node itself (no
     * self-routing loop); the CN split-routing rule is flipped according
     * to the node's gateway_direction. Device-authenticated (Bearer API_SECRET).
     * @returns string Mihomo YAML
     * @throws ApiError
     */
    public static nodeClashConfig({
        mac,
    }: {
        /**
         * node MAC
         */
        mac: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}/clash-config',
            path: {
                'mac': mac,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * List Xray users for a node
     * Returns the set of VLESS clients (uuid + email) that should be active
     * on this node's Xray inbound: all valid (active, non-expired, under-quota)
     * customer subscriptions whose plan grants access to a line containing this node.
     * @returns handler_NodeXrayUsersResponse OK
     * @throws ApiError
     */
    public static nodeXrayUsers({
        mac,
    }: {
        /**
         * node MAC
         */
        mac: string,
    }): CancelablePromise<handler_NodeXrayUsersResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}/xray-users',
            path: {
                'mac': mac,
            },
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Node heartbeat
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static nodeHeartbeat({
        requestBody,
    }: {
        /**
         * heartbeat data
         */
        requestBody: model_HeartbeatRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/nodes/heartbeat',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Register a node
     * Register a new node or update an existing one by MAC address
     * @returns handler_NodeRegisterResponse OK
     * @throws ApiError
     */
    public static nodeRegister({
        requestBody,
    }: {
        /**
         * node info
         */
        requestBody: handler_NodeRegisterRequest,
    }): CancelablePromise<handler_NodeRegisterResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/nodes/register',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
            },
        });
    }
}
