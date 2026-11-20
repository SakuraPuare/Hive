/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SubscriptionService {
    /**
     * 获取客户 Clash 订阅（出海）
     * 根据订阅 token 返回 Clash/Mihomo YAML 格式配置 (text/plain)。
     * 只包含 exit_direction=overseas 的出海节点，CN 直连、其余走代理。
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
     * 获取客户 Clash 订阅（回国）
     * 根据订阅 token 返回 Clash/Mihomo YAML 格式配置 (text/plain)。
     * 只包含 exit_direction=domestic 的回国节点，CN 走代理、其余直连。
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static customerSubscriptionDomesticClash({
        token,
    }: {
        /**
         * 订阅 token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/c/{token}/domestic',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 获取客户 VLESS 订阅（回国）
     * 根据订阅 token 返回 base64 编码的回国 VLESS 订阅链接 (text/plain)
     * @returns string VLESS subscription
     * @throws ApiError
     */
    public static customerSubscriptionDomesticVless({
        token,
    }: {
        /**
         * 订阅 token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/c/{token}/domestic/vless',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 获取客户 VLESS 订阅（出海）
     * 根据订阅 token 返回 base64 编码的出海 VLESS 订阅链接 (text/plain)
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
     * 获取自有设备免费 Clash 订阅
     * 仅当前有效归属的单台设备；按设备出口方向分流，不依赖付费套餐。出口关闭时返回无凭据直连配置。
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static ownerSubscriptionClash({
        token,
    }: {
        /**
         * 设备私密 token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/d/{token}',
            path: {
                'token': token,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 获取自有设备免费 VLESS 订阅
     * 返回单台自有设备的 base64 VLESS 链接；出口关闭时仅返回无凭据说明。
     * @returns string VLESS subscription
     * @throws ApiError
     */
    public static ownerSubscriptionVless({
        token,
    }: {
        /**
         * 设备私密 token
         */
        token: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/d/{token}/vless',
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
        subscription,
    }: {
        /**
         * 线路 token
         */
        token: string,
        /**
         * 客户订阅 Token（额度和有效期校验）
         */
        subscription: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/l/{token}',
            path: {
                'token': token,
            },
            query: {
                'subscription': subscription,
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
        subscription,
    }: {
        /**
         * 线路 token
         */
        token: string,
        /**
         * 客户订阅 Token（额度和有效期校验）
         */
        subscription: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/l/{token}/vless',
            path: {
                'token': token,
            },
            query: {
                'subscription': subscription,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 公开订阅组 Clash 配置
     * 通过 Token 获取订阅组的 Clash YAML 配置。客户订阅用 ?subscription=<客户 Token>；
     * 管理导出可改用 ?token=<ADMIN_API_SECRET 或该分组 token>，返回分组内全部节点（节点自身 UUID，不计客户额度）。
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static publicGroupClash({
        token,
        subscription,
    }: {
        /**
         * 订阅组 Token
         */
        token: string,
        /**
         * 客户订阅 Token（额度和有效期校验）
         */
        subscription: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/s/{token}',
            path: {
                'token': token,
            },
            query: {
                'subscription': subscription,
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
     * 管理导出可用 ?token=<ADMIN_API_SECRET|API_SECRET|分组 token>；分组 token 只导出该分组且不计客户额度。
     * @returns string VLESS subscription
     * @throws ApiError
     */
    public static subscriptionVless({
        subscription,
    }: {
        /**
         * 客户订阅 Token（额度和有效期校验）
         */
        subscription: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/subscription',
            query: {
                'subscription': subscription,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取 Clash 订阅
     * 返回 Clash/Mihomo YAML 格式订阅配置
     * 管理导出可用 ?token=<ADMIN_API_SECRET|API_SECRET|分组 token>；分组 token 只导出该分组且不计客户额度。
     * @returns string Clash subscription
     * @throws ApiError
     */
    public static subscriptionClash({
        subscription,
    }: {
        /**
         * 客户订阅 Token（额度和有效期校验）
         */
        subscription: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/subscription/clash',
            query: {
                'subscription': subscription,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
}
