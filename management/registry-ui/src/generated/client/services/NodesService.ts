/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_NodeRegisterRequest } from '../models/handler_NodeRegisterRequest';
import type { handler_NodeRegisterResponse } from '../models/handler_NodeRegisterResponse';
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { model_HeartbeatRequest } from '../models/model_HeartbeatRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NodesService {
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
