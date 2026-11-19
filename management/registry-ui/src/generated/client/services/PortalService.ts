/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_DashboardResponse } from '../models/handler_DashboardResponse';
import type { handler_enqueueCommandRequest } from '../models/handler_enqueueCommandRequest';
import type { handler_PortalBindSubscriptionRequest } from '../models/handler_PortalBindSubscriptionRequest';
import type { handler_PortalClaimRequest } from '../models/handler_PortalClaimRequest';
import type { handler_PortalCreateOrderRequest } from '../models/handler_PortalCreateOrderRequest';
import type { handler_PortalCreateOrderResponse } from '../models/handler_PortalCreateOrderResponse';
import type { handler_PortalCreateTicketRequest } from '../models/handler_PortalCreateTicketRequest';
import type { handler_PortalCreateTicketResponse } from '../models/handler_PortalCreateTicketResponse';
import type { handler_PortalDeviceExitRequest } from '../models/handler_PortalDeviceExitRequest';
import type { handler_PortalDeviceGatewayRequest } from '../models/handler_PortalDeviceGatewayRequest';
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
     * 客户对自己名下设备下发白名单命令（重启、配置同步、热点配置或 allowlisted service-control）。节点下次心跳周期拉取执行并回传结果。
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
     * 我的设备的 Mihomo 面板地址
     * 返回网关节点 Mihomo 面板的候选地址与 per-node secret。客户在节点
     * WiFi（10.42.x）、EasyTier（172.20.x）或 Tailscale（100.64.x）内时可直接打开。
     * @returns handler_DashboardResponse OK
     * @throws ApiError
     */
    public static portalDeviceDashboard({
        mac,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
    }): CancelablePromise<handler_DashboardResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/devices/{mac}/dashboard',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 设置我的设备是否作为 Xray 出口
     * 设备所有者关闭后，该设备立即从订阅与网关上游候选中移除；管理员开关仍然优先。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalSetDeviceExit({
        mac,
        requestBody,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
        /**
         * 出口开关
         */
        requestBody: handler_PortalDeviceExitRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/portal/devices/{mac}/exit',
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
     * 设置我的网关设备的分流方向
     * auto 会按节点上报的国家自动判定：在大陆 → 出海（CN 直连、其余代理）；不在大陆 → 回国（CN 走回国节点、其余直连）。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalSetDeviceGateway({
        mac,
        requestBody,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
        /**
         * 分流方向
         */
        requestBody: handler_PortalDeviceGatewayRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/portal/devices/{mac}/gateway',
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
     * 代理节点 Mihomo API（只读）
     * 把门户会话换成节点侧 per-node secret，向节点 :9090 取只读数据。
     * 用于门户里展示实时速率与活跃会话，客户无需在节点的 LAN/mesh 内。
     * @returns any OK
     * @throws ApiError
     */
    public static portalDeviceMihomo({
        mac,
        path,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
        /**
         * version|connections
         */
        path: string,
    }): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/devices/{mac}/mihomo/{path}',
            path: {
                'mac': mac,
                'path': path,
            },
            errors: {
                404: `Not Found`,
                502: `Bad Gateway`,
                503: `Service Unavailable`,
            },
        });
    }
    /**
     * 解绑网关设备的订阅配置
     * 客户解除网关设备与订阅的绑定；设备下一次同步后去掉全部代理，退化为直连兜底。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalUnbindDeviceSubscription({
        mac,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/portal/devices/{mac}/subscription',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * 给网关设备下发订阅配置
     * 客户把自己名下有效的订阅绑定到自己的网关设备。设备在下一次 hive-clash-sync 周期拉取该订阅的 Mihomo 配置。
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static portalBindDeviceSubscription({
        mac,
        requestBody,
    }: {
        /**
         * 设备 MAC
         */
        mac: string,
        /**
         * 订阅 ID
         */
        requestBody: handler_PortalBindSubscriptionRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/portal/devices/{mac}/subscription',
            path: {
                'mac': mac,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                409: `Conflict`,
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
