/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_enqueueCommandRequest } from '../models/handler_enqueueCommandRequest';
import type { handler_PortalClaimRequest } from '../models/handler_PortalClaimRequest';
import type { handler_PortalCreateOrderRequest } from '../models/handler_PortalCreateOrderRequest';
import type { handler_PortalCreateOrderResponse } from '../models/handler_PortalCreateOrderResponse';
import type { handler_PortalCreateTicketRequest } from '../models/handler_PortalCreateTicketRequest';
import type { handler_PortalCreateTicketResponse } from '../models/handler_PortalCreateTicketResponse';
import type { handler_PortalMeResponse } from '../models/handler_PortalMeResponse';
import type { handler_PortalOrderListResponse } from '../models/handler_PortalOrderListResponse';
import type { handler_PortalReferralRecordsResponse } from '../models/handler_PortalReferralRecordsResponse';
import type { handler_PortalReferralResponse } from '../models/handler_PortalReferralResponse';
import type { handler_PortalReplyTicketRequest } from '../models/handler_PortalReplyTicketRequest';
import type { handler_PortalSubscription } from '../models/handler_PortalSubscription';
import type { handler_PortalTicketDetail } from '../models/handler_PortalTicketDetail';
import type { handler_PortalTicketListResponse } from '../models/handler_PortalTicketListResponse';
import type { handler_PortalUpdateMeRequest } from '../models/handler_PortalUpdateMeRequest';
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { model_DeviceCommand } from '../models/model_DeviceCommand';
import type { model_Node } from '../models/model_Node';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PortalService {
    /**
     * 列出我的设备
     * 返回当前登录客户名下认领的所有设备
     * @returns model_Node OK
     * @throws ApiError
     */
    public static portalListDevices(): CancelablePromise<Array<model_Node>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/devices',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取我的单台设备详情
     * @returns model_Node OK
     * @throws ApiError
     */
    public static portalGetDevice({
        mac,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
    }): CancelablePromise<model_Node> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/devices/{mac}',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 我的设备命令历史
     * @returns model_DeviceCommand OK
     * @throws ApiError
     */
    public static portalListDeviceCommands({
        mac,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
    }): CancelablePromise<Array<model_DeviceCommand>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/devices/{mac}/commands',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 给我的设备下发命令
     * 客户对自己名下设备下发一条白名单命令（reboot/restart-xray/restart-mihomo/resync）。节点下次心跳周期拉取执行并回传结果。
     * @returns number OK
     * @throws ApiError
     */
    public static portalEnqueueDeviceCommand({
        mac,
        requestBody,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
        /**
         * 命令
         */
        requestBody: handler_enqueueCommandRequest,
    }): CancelablePromise<Record<string, number>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/devices/{mac}/commands',
            path: {
                'mac': mac,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
            },
        });
    }
    /**
     * 解绑我的设备
     * 客户把设备从自己名下解绑；解绑后设备恢复未认领状态，认领码重新生效。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalUnbindDevice({
        mac,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/devices/{mac}/unbind',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 认领设备
     * 客户输入设备认领码（MOTD/贴纸上显示）把设备绑定到自己名下。一次性：已被认领的设备无法再认领。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalClaimDevice({
        requestBody,
    }: {
        /**
         * 认领码
         */
        requestBody: handler_PortalClaimRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/devices/claim',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                409: `Conflict`,
            },
        });
    }
    /**
     * 获取当前客户信息
     * @returns handler_PortalMeResponse OK
     * @throws ApiError
     */
    public static portalMe(): CancelablePromise<handler_PortalMeResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/me',
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新当前客户资料
     * 客户更新自己的昵称等资料字段
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalUpdateMe({
        requestBody,
    }: {
        /**
         * 更新字段
         */
        requestBody: handler_PortalUpdateMeRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/portal/me',
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
     * 获取当前客户的订单列表
     * @returns handler_PortalOrderListResponse OK
     * @throws ApiError
     */
    public static portalOrders({
        page = 1,
        limit = 20,
    }: {
        /**
         * 页码
         */
        page?: number,
        /**
         * 每页数量
         */
        limit?: number,
    }): CancelablePromise<handler_PortalOrderListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/orders',
            query: {
                'page': page,
                'limit': limit,
            },
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 客户下单
     * @returns handler_PortalCreateOrderResponse OK
     * @throws ApiError
     */
    public static portalCreateOrder({
        requestBody,
    }: {
        /**
         * 下单信息
         */
        requestBody: handler_PortalCreateOrderRequest,
    }): CancelablePromise<handler_PortalCreateOrderResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/orders',
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
     * 获取我的邀请信息
     * 返回当前客户的邀请码、邀请链接、邀请人数、累计返利和余额
     * @returns handler_PortalReferralResponse OK
     * @throws ApiError
     */
    public static portalReferral(): CancelablePromise<handler_PortalReferralResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/referral',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取我的邀请记录
     * 分页返回当前客户的邀请记录列表
     * @returns handler_PortalReferralRecordsResponse OK
     * @throws ApiError
     */
    public static portalReferralRecords({
        page,
        limit,
    }: {
        /**
         * 页码（默认 1）
         */
        page?: number,
        /**
         * 每页数量（默认 20，最大 100）
         */
        limit?: number,
    }): CancelablePromise<handler_PortalReferralRecordsResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/referral/records',
            query: {
                'page': page,
                'limit': limit,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取当前客户的所有订阅
     * @returns handler_PortalSubscription OK
     * @throws ApiError
     */
    public static portalSubscriptions(): CancelablePromise<Array<handler_PortalSubscription>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/subscriptions',
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取当前客户的工单列表
     * @returns handler_PortalTicketListResponse OK
     * @throws ApiError
     */
    public static portalTickets({
        page = 1,
        limit = 20,
    }: {
        /**
         * 页码
         */
        page?: number,
        /**
         * 每页数量
         */
        limit?: number,
    }): CancelablePromise<handler_PortalTicketListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/tickets',
            query: {
                'page': page,
                'limit': limit,
            },
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 提交工单
     * @returns handler_PortalCreateTicketResponse OK
     * @throws ApiError
     */
    public static portalCreateTicket({
        requestBody,
    }: {
        /**
         * 工单内容
         */
        requestBody: handler_PortalCreateTicketRequest,
    }): CancelablePromise<handler_PortalCreateTicketResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/tickets',
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
     * 获取工单详情及回复
     * @returns handler_PortalTicketDetail OK
     * @throws ApiError
     */
    public static portalGetTicket({
        id,
    }: {
        /**
         * 工单 ID
         */
        id: number,
    }): CancelablePromise<handler_PortalTicketDetail> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/tickets/{id}',
            path: {
                'id': id,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 客户回复工单
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalReplyTicket({
        id,
        requestBody,
    }: {
        /**
         * 工单 ID
         */
        id: number,
        /**
         * 回复内容
         */
        requestBody: handler_PortalReplyTicketRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/portal/tickets/{id}/reply',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
}
