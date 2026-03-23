/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { main_AdminLoginRequest } from '../models/main_AdminLoginRequest';
import type { main_StatusResponse } from '../models/main_StatusResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminService {
    /**
     * Admin login
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminLogin({
        requestBody,
    }: {
        /**
         * admin login payload
         */
        requestBody: main_AdminLoginRequest,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/login',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Admin logout
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminLogout(): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/logout',
        });
    }
}
