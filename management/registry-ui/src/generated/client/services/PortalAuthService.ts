/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_ForgotPasswordRequest } from '../models/handler_ForgotPasswordRequest';
import type { handler_PortalLoginRequest } from '../models/handler_PortalLoginRequest';
import type { handler_PortalRegisterRequest } from '../models/handler_PortalRegisterRequest';
import type { handler_ResetPasswordRequest } from '../models/handler_ResetPasswordRequest';
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PortalAuthService {
    /**
     * 发送密码重置验证码
     * 向指定邮箱发送 6 位验证码，15 分钟有效
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalForgotPassword({
        requestBody,
    }: {
        /**
         * 邮箱
         */
        requestBody: handler_ForgotPasswordRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/forgot-password',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
            },
        });
    }
    /**
     * 客户登录
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalLogin({
        requestBody,
    }: {
        /**
         * 登录凭证
         */
        requestBody: handler_PortalLoginRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/login',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                403: `Forbidden`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 客户登出
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalLogout(): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/logout',
        });
    }
    /**
     * 客户自助注册
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalRegister({
        requestBody,
    }: {
        /**
         * 注册信息
         */
        requestBody: handler_PortalRegisterRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/register',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                409: `Conflict`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 重置密码
     * 使用验证码重置客户密码
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalResetPassword({
        requestBody,
    }: {
        /**
         * 邮箱、验证码、新密码
         */
        requestBody: handler_ResetPasswordRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/reset-password',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
}
