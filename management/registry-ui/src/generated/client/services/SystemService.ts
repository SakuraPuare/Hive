/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SystemService {
    /**
     * 健康检查
     * 检查服务和数据库连接是否正常
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static health(): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
            errors: {
                503: `Service Unavailable`,
            },
        });
    }
}
