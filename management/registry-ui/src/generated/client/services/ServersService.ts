/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_NodeAccountingRequest } from '../models/handler_NodeAccountingRequest';
import type { handler_NodeXrayUsersResponse } from '../models/handler_NodeXrayUsersResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ServersService {
    /**
     * Report trusted exit server traffic and renew subscription authorization
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
            url: '/servers/{mac}/accounting',
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
}
