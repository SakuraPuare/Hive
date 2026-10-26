/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_ackCommandRequest } from '../models/handler_ackCommandRequest';
import type { handler_NodeAccountingRequest } from '../models/handler_NodeAccountingRequest';
import type { handler_NodeRegisterRequest } from '../models/handler_NodeRegisterRequest';
import type { handler_NodeRegisterResponse } from '../models/handler_NodeRegisterResponse';
import type { handler_NodeXrayUsersResponse } from '../models/handler_NodeXrayUsersResponse';
import type { handler_otaAckRequest } from '../models/handler_otaAckRequest';
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { model_DeviceCommand } from '../models/model_DeviceCommand';
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
     * 节点拉取待执行命令
     * 节点定时轮询本机 MAC 的 pending 命令。返回前把它们置为 sent 并记录 sent_at；超过 TTL 的 pending 惰性标记 expired、不再下发。设备鉴权（Bearer API_SECRET）。
     * @returns model_DeviceCommand OK
     * @throws ApiError
     */
    public static nodePullCommands({
        mac,
    }: {
        /**
         * node MAC
         */
        mac: string,
    }): CancelablePromise<Array<model_DeviceCommand>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}/commands',
            path: {
                'mac': mac,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * 节点回传命令执行结果
     * 节点执行完命令后回传 done/failed 与结果文本。仅能 ACK 本机 MAC 且处于 sent 的命令。设备鉴权（Bearer API_SECRET）。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static nodeAckCommand({
        mac,
        id,
        requestBody,
    }: {
        /**
         * node MAC
         */
        mac: string,
        /**
         * command id
         */
        id: number,
        /**
         * 执行结果
         */
        requestBody: handler_ackCommandRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/nodes/{mac}/commands/{id}/ack',
            path: {
                'mac': mac,
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * 节点回传 OTA 安装结果
     * 上报 installing、done、failed 或 rolled_back；仅当前分配任务可更新，终态不可覆盖。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static nodeOtaAck({
        mac,
        requestBody,
    }: {
        /**
         * node MAC
         */
        mac: string,
        /**
         * 结果
         */
        requestBody: handler_otaAckRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/nodes/{mac}/ota-ack',
            path: {
                'mac': mac,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
            },
        });
    }
    /**
     * Download the OTA bundle assigned to this device
     * @returns binary OK
     * @throws ApiError
     */
    public static nodeOtaBundle({
        mac,
        sha,
    }: {
        /**
         * node MAC
         */
        mac: string,
        /**
         * bundle SHA256
         */
        sha: string,
    }): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}/ota-bundle/{sha}',
            path: {
                'mac': mac,
                'sha': sha,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 节点查询待安装 OTA 版本
     * hive-updater.timer 定时调用，返回当前分配给本节点的 pending OTA bundle 信息。无分配或已完成时返回空 version。
     * @returns string OK
     * @throws ApiError
     */
    public static nodeOtaVersion({
        mac,
    }: {
        /**
         * node MAC
         */
        mac: string,
    }): CancelablePromise<Record<string, string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}/ota-version',
            path: {
                'mac': mac,
            },
        });
    }
    /**
     * Report node traffic and renew subscription authorization
     * @returns handler_NodeXrayUsersResponse OK
     * @throws ApiError
     */
    public static nodeAccounting({
        mac,
        requestBody,
    }: {
        /**
         * Node MAC
         */
        mac: string,
        /**
         * Cumulative traffic counters
         */
        requestBody: handler_NodeAccountingRequest,
    }): CancelablePromise<handler_NodeXrayUsersResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/nodes/{mac}/xray-users',
            path: {
                'mac': mac,
            },
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
     * Allocate EasyTier IP for a MAC
     * Idempotently allocates (or returns the existing) 172.20.0.0/16 EasyTier
     * IP for the given MAC. Called by provision-node.sh as its first step so the
     * device can start EasyTier with a stable, collision-free static IP.
     * @returns string OK
     * @throws ApiError
     */
    public static postNodesAllocateEasytier({
        requestBody,
    }: {
        /**
         * MAC only
         */
        requestBody: Record<string, any>,
    }): CancelablePromise<Record<string, string>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/nodes/allocate-easytier',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
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
