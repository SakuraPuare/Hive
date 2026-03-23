/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { main_Node } from '../models/main_Node';
import type { main_NodeRegisterResponse } from '../models/main_NodeRegisterResponse';
import type { main_RegisterRequest } from '../models/main_RegisterRequest';
import type { main_StatusResponse } from '../models/main_StatusResponse';
import type { main_UpdateRequest } from '../models/main_UpdateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NodesService {
    /**
     * List nodes
     * @returns main_Node OK
     * @throws ApiError
     */
    public static nodesList(): CancelablePromise<Array<main_Node>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Delete node
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static nodeDelete({
        mac,
    }: {
        /**
         * node mac (12 hex, no colon)
         */
        mac: string,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/nodes/{mac}',
            path: {
                'mac': mac,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not Found`,
            },
        });
    }
    /**
     * Get node by MAC
     * @returns main_Node OK
     * @throws ApiError
     */
    public static nodeGet({
        mac,
    }: {
        /**
         * node mac (12 hex, no colon)
         */
        mac: string,
    }): CancelablePromise<main_Node> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}',
            path: {
                'mac': mac,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not Found`,
            },
        });
    }
    /**
     * Update node (partial)
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static nodeUpdate({
        mac,
        requestBody,
    }: {
        /**
         * node mac (12 hex, no colon)
         */
        mac: string,
        /**
         * node update payload
         */
        requestBody: main_UpdateRequest,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/nodes/{mac}',
            path: {
                'mac': mac,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                404: `Not Found`,
            },
        });
    }
    /**
     * Register node (idempotent)
     * @returns main_NodeRegisterResponse OK
     * @throws ApiError
     */
    public static nodeRegister({
        requestBody,
    }: {
        /**
         * node register payload
         */
        requestBody: main_RegisterRequest,
    }): CancelablePromise<main_NodeRegisterResponse> {
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
