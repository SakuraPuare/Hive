/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { main_StatusResponse } from '../models/main_StatusResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HealthService {
    /**
     * Health check
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static health(): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
            errors: {
                503: `Service Unavailable`,
            },
        });
    }
}
