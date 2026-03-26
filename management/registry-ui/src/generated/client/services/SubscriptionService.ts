/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SubscriptionService {
    /**
     * 获取客户 Clash 订阅
     * 根据订阅 token 返回 Clash/Mihomo YAML 格式配置 (text/plain)
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static customerSubscriptionClash({
        token,
    }: {
        /**
         * 订阅 token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/c/{token}',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 获取客户 VLESS 订阅
     * 根据订阅 token 返回 base64 编码的 VLESS 订阅链接 (text/plain)
     * @returns string VLESS subscription
     * @throws ApiError
     */
    public static customerSubscriptionVless({
        token,
    }: {
        /**
         * 订阅 token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/c/{token}/vless',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 获取线路 VLESS 订阅
     * 返回 base64 编码的 VLESS 订阅链接
     * @returns string VLESS subscription
     * @throws ApiError
     */
    public static publicLineVless({
        token,
    }: {
        /**
         * 线路 token
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
     * 获取线路 Clash 订阅
     * 返回 Clash/Mihomo YAML 格式订阅配置
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static publicLineClash({
        token,
    }: {
        /**
         * 线路 token
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
     * 公开订阅组 Clash 配置
     * 通过 Token 获取订阅组的 Clash YAML 配置（无需认证）
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static publicGroupClash({
        token,
    }: {
        /**
         * 订阅组 Token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/s/{token}',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取 VLESS 订阅
     * 返回 base64 编码的 VLESS 订阅链接
     * @returns string VLESS subscription
     * @throws ApiError
     */
    public static subscriptionVless(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/subscription',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取 Clash 订阅
     * 返回 Clash/Mihomo YAML 格式订阅配置
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static subscriptionClash(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/subscription/clash',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
}
