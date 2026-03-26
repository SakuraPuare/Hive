/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SubscriptionService {
    /**
     * Get VLESS subscription content for a line
     * @returns string OK
     * @throws ApiError
     */
    public static publicLineVless({
        token,
    }: {
        /**
         * Line subscription token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/l/{token}',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * Get Clash subscription content for a line
     * @returns string OK
     * @throws ApiError
     */
    public static publicLineClash({
        token,
    }: {
        /**
         * Line subscription token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/l/{token}/clash',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * VLESS subscription (base64)
     * @returns string base64 encoded subscription
     * @throws ApiError
     */
    public static subscriptionVless(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/subscription',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Clash/Mihomo subscription YAML
     * @returns string clash yaml content
     * @throws ApiError
     */
    public static subscriptionClash(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/subscription/clash',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
}
