/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { handler_AdminLoginRequest } from '../models/handler_AdminLoginRequest';
import type { handler_AdminReferralListResponse } from '../models/handler_AdminReferralListResponse';
import type { handler_AnnouncementListResponse } from '../models/handler_AnnouncementListResponse';
import type { handler_AnnouncementRequest } from '../models/handler_AnnouncementRequest';
import type { handler_ChangePasswordRequest } from '../models/handler_ChangePasswordRequest';
import type { handler_CreateCustomerRequest } from '../models/handler_CreateCustomerRequest';
import type { handler_CreateGroupRequest } from '../models/handler_CreateGroupRequest';
import type { handler_CreateIDResponse } from '../models/handler_CreateIDResponse';
import type { handler_CreateLineRequest } from '../models/handler_CreateLineRequest';
import type { handler_CreateLineResponse } from '../models/handler_CreateLineResponse';
import type { handler_CreatePlanRequest } from '../models/handler_CreatePlanRequest';
import type { handler_CreatePlanResponse } from '../models/handler_CreatePlanResponse';
import type { handler_CreatePromoCodeRequest } from '../models/handler_CreatePromoCodeRequest';
import type { handler_CreateSubscriptionRequest } from '../models/handler_CreateSubscriptionRequest';
import type { handler_CreateSubscriptionResponse } from '../models/handler_CreateSubscriptionResponse';
import type { handler_CreateUserRequest } from '../models/handler_CreateUserRequest';
import type { handler_CustomerDetail } from '../models/handler_CustomerDetail';
import type { handler_CustomerListResponse } from '../models/handler_CustomerListResponse';
import type { handler_CustomerTrafficResponse } from '../models/handler_CustomerTrafficResponse';
import type { handler_MeResponse } from '../models/handler_MeResponse';
import type { handler_NodeUpdateRequest } from '../models/handler_NodeUpdateRequest';
import type { handler_OrderListResponse } from '../models/handler_OrderListResponse';
import type { handler_PermissionItem } from '../models/handler_PermissionItem';
import type { handler_PrometheusTarget } from '../models/handler_PrometheusTarget';
import type { handler_ResetCustomerPasswordRequest } from '../models/handler_ResetCustomerPasswordRequest';
import type { handler_ResetSubscriptionTokenResponse } from '../models/handler_ResetSubscriptionTokenResponse';
import type { handler_ResetTokenResponse } from '../models/handler_ResetTokenResponse';
import type { handler_RiskEventListResponse } from '../models/handler_RiskEventListResponse';
import type { handler_RoleDetail } from '../models/handler_RoleDetail';
import type { handler_SetGroupNodesRequest } from '../models/handler_SetGroupNodesRequest';
import type { handler_SetLineNodesRequest } from '../models/handler_SetLineNodesRequest';
import type { handler_SetPermissionsRequest } from '../models/handler_SetPermissionsRequest';
import type { handler_SetPlanLinesRequest } from '../models/handler_SetPlanLinesRequest';
import type { handler_SetRolesRequest } from '../models/handler_SetRolesRequest';
import type { handler_StatusResponse } from '../models/handler_StatusResponse';
import type { handler_TicketDetailResponse } from '../models/handler_TicketDetailResponse';
import type { handler_TicketListResponse } from '../models/handler_TicketListResponse';
import type { handler_TicketReplyRequest } from '../models/handler_TicketReplyRequest';
import type { handler_TrafficSummaryResponse } from '../models/handler_TrafficSummaryResponse';
import type { handler_UpdateCustomerRequest } from '../models/handler_UpdateCustomerRequest';
import type { handler_UpdateLineRequest } from '../models/handler_UpdateLineRequest';
import type { handler_UpdateOrderStatusRequest } from '../models/handler_UpdateOrderStatusRequest';
import type { handler_UpdatePlanRequest } from '../models/handler_UpdatePlanRequest';
import type { handler_UpdatePromoCodeRequest } from '../models/handler_UpdatePromoCodeRequest';
import type { handler_UpdateReferralRequest } from '../models/handler_UpdateReferralRequest';
import type { handler_UpdateSubscriptionRequest } from '../models/handler_UpdateSubscriptionRequest';
import type { handler_UserWithRoles } from '../models/handler_UserWithRoles';
import type { model_Announcement } from '../models/model_Announcement';
import type { model_AuditLog } from '../models/model_AuditLog';
import type { model_CustomerSubscription } from '../models/model_CustomerSubscription';
import type { model_Line } from '../models/model_Line';
import type { model_Node } from '../models/model_Node';
import type { model_NodeStatusCheck } from '../models/model_NodeStatusCheck';
import type { model_Order } from '../models/model_Order';
import type { model_Plan } from '../models/model_Plan';
import type { model_PromoCode } from '../models/model_PromoCode';
import type { model_SubscriptionGroup } from '../models/model_SubscriptionGroup';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminService {
    /**
     * 获取公告列表
     * 分页获取所有公告，按置顶和创建时间排序
     * @returns handler_AnnouncementListResponse OK
     * @throws ApiError
     */
    public static adminListAnnouncements({
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
    }): CancelablePromise<handler_AnnouncementListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/announcements',
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
     * 创建公告
     * 创建新公告，level 可选 info/warning/critical
     * @returns model_Announcement OK
     * @throws ApiError
     */
    public static adminCreateAnnouncement({
        requestBody,
    }: {
        /**
         * 公告信息
         */
        requestBody: handler_AnnouncementRequest,
    }): CancelablePromise<model_Announcement> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/announcements',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 删除公告
     * 根据 ID 删除公告
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteAnnouncement({
        id,
    }: {
        /**
         * 公告 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/announcements/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新公告
     * 根据 ID 更新公告字段（部分更新）
     * @returns model_Announcement OK
     * @throws ApiError
     */
    public static adminUpdateAnnouncement({
        id,
        requestBody,
    }: {
        /**
         * 公告 ID
         */
        id: number,
        /**
         * 更新字段
         */
        requestBody: handler_AnnouncementRequest,
    }): CancelablePromise<model_Announcement> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/announcements/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取审计日志
     * 分页查询审计日志，支持按操作类型、用户名、时间范围筛选
     * @returns model_AuditLog OK
     * @throws ApiError
     */
    public static adminAuditLogs({
        limit,
        offset,
        action,
        username,
        from,
        to,
    }: {
        /**
         * 每页条数（默认 50，最大 500）
         */
        limit?: number,
        /**
         * 偏移量
         */
        offset?: number,
        /**
         * 操作类型
         */
        action?: string,
        /**
         * 用户名
         */
        username?: string,
        /**
         * 起始时间（含）
         */
        from?: string,
        /**
         * 结束时间（含）
         */
        to?: string,
    }): CancelablePromise<Array<model_AuditLog>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/audit-logs',
            query: {
                'limit': limit,
                'offset': offset,
                'action': action,
                'username': username,
                'from': from,
                'to': to,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取客户列表
     * 分页查询客户，支持按状态、邮箱、关键词筛选
     * @returns handler_CustomerListResponse OK
     * @throws ApiError
     */
    public static adminListCustomers({
        status,
        email,
        search,
        page,
        limit,
    }: {
        /**
         * 按状态筛选
         */
        status?: string,
        /**
         * 按邮箱模糊搜索
         */
        email?: string,
        /**
         * 按邮箱或昵称模糊搜索
         */
        search?: string,
        /**
         * 页码（默认 1）
         */
        page?: number,
        /**
         * 每页条数（默认 20，最大 100）
         */
        limit?: number,
    }): CancelablePromise<handler_CustomerListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/customers',
            query: {
                'status': status,
                'email': email,
                'search': search,
                'page': page,
                'limit': limit,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建客户
     * 创建新客户账号
     * @returns handler_CreateIDResponse OK
     * @throws ApiError
     */
    public static adminCreateCustomer({
        requestBody,
    }: {
        /**
         * 客户信息
         */
        requestBody: handler_CreateCustomerRequest,
    }): CancelablePromise<handler_CreateIDResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/customers',
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
     * 删除客户
     * 删除指定客户
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteCustomer({
        id,
    }: {
        /**
         * 客户 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/customers/{id}',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取客户详情
     * 返回客户信息及其所有订阅
     * @returns handler_CustomerDetail OK
     * @throws ApiError
     */
    public static adminGetCustomer({
        id,
    }: {
        /**
         * 客户 ID
         */
        id: number,
    }): CancelablePromise<handler_CustomerDetail> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/customers/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新客户
     * 更新客户昵称或状态
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateCustomer({
        id,
        requestBody,
    }: {
        /**
         * 客户 ID
         */
        id: number,
        /**
         * 更新字段
         */
        requestBody: handler_UpdateCustomerRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/customers/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 封禁客户
     * 封禁客户并暂停其所有活跃订阅
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminBanCustomer({
        id,
    }: {
        /**
         * 客户 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/customers/{id}/ban',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 重置客户密码
     * 管理员重置客户登录密码
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminResetCustomerPassword({
        id,
        requestBody,
    }: {
        /**
         * 客户 ID
         */
        id: number,
        /**
         * 新密码
         */
        requestBody: handler_ResetCustomerPasswordRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/customers/{id}/password',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取客户订阅列表
     * 返回指定客户的所有订阅
     * @returns model_CustomerSubscription OK
     * @throws ApiError
     */
    public static adminListSubscriptions({
        id,
    }: {
        /**
         * 客户 ID
         */
        id: number,
    }): CancelablePromise<Array<model_CustomerSubscription>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/customers/{id}/subscriptions',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建订阅
     * 为客户创建新订阅，根据套餐自动设置流量和有效期
     * @returns handler_CreateSubscriptionResponse OK
     * @throws ApiError
     */
    public static adminCreateSubscription({
        id,
        requestBody,
    }: {
        /**
         * 客户 ID
         */
        id: number,
        /**
         * 订阅信息
         */
        requestBody: handler_CreateSubscriptionRequest,
    }): CancelablePromise<handler_CreateSubscriptionResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/customers/{id}/subscriptions',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取客户流量统计
     * 返回客户所有订阅的流量使用情况
     * @returns handler_CustomerTrafficResponse OK
     * @throws ApiError
     */
    public static adminGetCustomerTraffic({
        id,
    }: {
        /**
         * 客户 ID
         */
        id: number,
    }): CancelablePromise<handler_CustomerTrafficResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/customers/{id}/traffic',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 解封客户
     * 将已封禁的客户状态恢复为活跃
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUnbanCustomer({
        id,
    }: {
        /**
         * 客户 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/customers/{id}/unban',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取线路列表
     * 返回所有线路（含节点数量）
     * @returns model_Line OK
     * @throws ApiError
     */
    public static adminListLines(): CancelablePromise<Array<model_Line>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/lines',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建线路
     * 创建新线路并生成订阅 token
     * @returns handler_CreateLineResponse OK
     * @throws ApiError
     */
    public static adminCreateLine({
        requestBody,
    }: {
        /**
         * 线路信息
         */
        requestBody: handler_CreateLineRequest,
    }): CancelablePromise<handler_CreateLineResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/lines',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 删除线路
     * 删除指定线路
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteLine({
        id,
    }: {
        /**
         * 线路 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/lines/{id}',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新线路
     * 更新指定线路的属性
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateLine({
        id,
        requestBody,
    }: {
        /**
         * 线路 ID
         */
        id: number,
        /**
         * 更新字段
         */
        requestBody: handler_UpdateLineRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/lines/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取线路节点
     * 返回指定线路关联的节点 MAC 列表
     * @returns string OK
     * @throws ApiError
     */
    public static adminGetLineNodes({
        id,
    }: {
        /**
         * 线路 ID
         */
        id: number,
    }): CancelablePromise<Array<string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/lines/{id}/nodes',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
            },
        });
    }
    /**
     * 设置线路节点
     * 替换指定线路的节点列表
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetLineNodes({
        id,
        requestBody,
    }: {
        /**
         * 线路 ID
         */
        id: number,
        /**
         * 节点 MAC 列表
         */
        requestBody: handler_SetLineNodesRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/admin/lines/{id}/nodes',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 重置线路 token
     * 为指定线路生成新的订阅 token
     * @returns handler_ResetTokenResponse OK
     * @throws ApiError
     */
    public static adminResetLineToken({
        id,
    }: {
        /**
         * 线路 ID
         */
        id: number,
    }): CancelablePromise<handler_ResetTokenResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/lines/{id}/reset-token',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Admin login
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminLogin({
        requestBody,
    }: {
        /**
         * credentials
         */
        requestBody: handler_AdminLoginRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/login',
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
     * Admin logout
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminLogout(): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/logout',
        });
    }
    /**
     * Get current admin user info
     * @returns handler_MeResponse OK
     * @throws ApiError
     */
    public static adminMe(): CancelablePromise<handler_MeResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/me',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * 获取节点状态列表
     * 返回所有节点的最新探测状态（CPU、内存、磁盘、延迟等）
     * @returns model_NodeStatusCheck OK
     * @throws ApiError
     */
    public static adminNodeStatus(): CancelablePromise<Array<model_NodeStatusCheck>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/node-status',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取订单列表
     * 分页获取订单列表，支持按客户和状态筛选
     * @returns handler_OrderListResponse OK
     * @throws ApiError
     */
    public static adminListOrders({
        customerId,
        status,
        page,
        limit,
    }: {
        /**
         * 按客户 ID 筛选
         */
        customerId?: string,
        /**
         * 按状态筛选
         */
        status?: string,
        /**
         * 页码（默认 1）
         */
        page?: number,
        /**
         * 每页数量（默认 20，最大 100）
         */
        limit?: number,
    }): CancelablePromise<handler_OrderListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/orders',
            query: {
                'customer_id': customerId,
                'status': status,
                'page': page,
                'limit': limit,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取订单详情
     * 根据 ID 获取单个订单
     * @returns model_Order OK
     * @throws ApiError
     */
    public static adminGetOrder({
        id,
    }: {
        /**
         * 订单 ID
         */
        id: number,
    }): CancelablePromise<model_Order> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/orders/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新订单状态
     * 更新指定订单的状态，若改为 paid 则自动创建订阅
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateOrderStatus({
        id,
        requestBody,
    }: {
        /**
         * 订单 ID
         */
        id: number,
        /**
         * 新状态
         */
        requestBody: handler_UpdateOrderStatusRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/orders/{id}/status',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取所有权限
     * 返回所有可分配的权限列表（仅需有效会话）
     * @returns handler_PermissionItem OK
     * @throws ApiError
     */
    public static adminListPermissions(): CancelablePromise<Array<handler_PermissionItem>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/permissions',
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取套餐列表
     * 返回所有套餐
     * @returns model_Plan OK
     * @throws ApiError
     */
    public static adminListPlans(): CancelablePromise<Array<model_Plan>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/plans',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建套餐
     * 创建新的套餐
     * @returns handler_CreatePlanResponse OK
     * @throws ApiError
     */
    public static adminCreatePlan({
        requestBody,
    }: {
        /**
         * 套餐信息
         */
        requestBody: handler_CreatePlanRequest,
    }): CancelablePromise<handler_CreatePlanResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/plans',
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
     * 删除套餐
     * 根据 ID 删除套餐
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeletePlan({
        id,
    }: {
        /**
         * 套餐 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/plans/{id}',
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
     * 更新套餐
     * 根据 ID 更新套餐信息
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdatePlan({
        id,
        requestBody,
    }: {
        /**
         * 套餐 ID
         */
        id: number,
        /**
         * 更新字段
         */
        requestBody: handler_UpdatePlanRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/plans/{id}',
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
    /**
     * 获取套餐线路
     * 返回套餐关联的线路 ID 列表
     * @returns number OK
     * @throws ApiError
     */
    public static adminGetPlanLines({
        id,
    }: {
        /**
         * 套餐 ID
         */
        id: number,
    }): CancelablePromise<Array<number>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/plans/{id}/lines',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 设置套餐线路
     * 替换套餐关联的线路列表
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetPlanLines({
        id,
        requestBody,
    }: {
        /**
         * 套餐 ID
         */
        id: number,
        /**
         * 线路 ID 列表
         */
        requestBody: handler_SetPlanLinesRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/admin/plans/{id}/lines',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取优惠码列表
     * 获取所有优惠码，按 ID 倒序排列
     * @returns model_PromoCode OK
     * @throws ApiError
     */
    public static adminListPromoCodes(): CancelablePromise<Array<model_PromoCode>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/promo-codes',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建优惠码
     * 创建新的优惠码
     * @returns handler_CreateIDResponse OK
     * @throws ApiError
     */
    public static adminCreatePromoCode({
        requestBody,
    }: {
        /**
         * 优惠码信息
         */
        requestBody: handler_CreatePromoCodeRequest,
    }): CancelablePromise<handler_CreateIDResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/promo-codes',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 删除优惠码
     * 按 ID 删除优惠码
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeletePromoCode({
        id,
    }: {
        /**
         * 优惠码 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/promo-codes/{id}',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新优惠码
     * 按 ID 更新优惠码字段
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdatePromoCode({
        id,
        requestBody,
    }: {
        /**
         * 优惠码 ID
         */
        id: number,
        /**
         * 要更新的字段
         */
        requestBody: handler_UpdatePromoCodeRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/promo-codes/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取邀请记录列表
     * 分页获取全局邀请记录，支持按状态筛选
     * @returns handler_AdminReferralListResponse OK
     * @throws ApiError
     */
    public static adminListReferrals({
        page,
        limit,
        status,
    }: {
        /**
         * 页码（默认 1）
         */
        page?: number,
        /**
         * 每页数量（默认 20，最大 100）
         */
        limit?: number,
        /**
         * 按状态筛选
         */
        status?: string,
    }): CancelablePromise<handler_AdminReferralListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/referrals',
            query: {
                'page': page,
                'limit': limit,
                'status': status,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新邀请记录状态
     * 修改指定邀请记录的状态（pending/paid/cancelled），自动调整余额
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateReferral({
        id,
        requestBody,
    }: {
        /**
         * 邀请记录 ID
         */
        id: number,
        /**
         * 新状态
         */
        requestBody: handler_UpdateReferralRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/referrals/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取风控事件列表
     * 分页查询风控事件，支持按客户 ID 和事件类型筛选
     * @returns handler_RiskEventListResponse OK
     * @throws ApiError
     */
    public static adminListRiskEvents({
        customerId,
        eventType,
        page,
        limit,
    }: {
        /**
         * 按客户 ID 筛选
         */
        customerId?: string,
        /**
         * 按事件类型筛选
         */
        eventType?: string,
        /**
         * 页码（默认 1）
         */
        page?: number,
        /**
         * 每页数量（默认 20，最大 100）
         */
        limit?: number,
    }): CancelablePromise<handler_RiskEventListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/risk-events',
            query: {
                'customer_id': customerId,
                'event_type': eventType,
                'page': page,
                'limit': limit,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取所有角色
     * 返回所有角色及其权限列表
     * @returns handler_RoleDetail OK
     * @throws ApiError
     */
    public static adminListRoles(): CancelablePromise<Array<handler_RoleDetail>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/roles',
            errors: {
                401: `Unauthorized`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新角色权限
     * 替换指定角色的全部权限
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetRolePermissions({
        id,
        requestBody,
    }: {
        /**
         * 角色 ID
         */
        id: number,
        /**
         * 权限列表
         */
        requestBody: handler_SetPermissionsRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/admin/roles/{id}/permissions',
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
    /**
     * 获取订阅组列表
     * 返回所有订阅组
     * @returns model_SubscriptionGroup OK
     * @throws ApiError
     */
    public static adminListSubscriptionGroups(): CancelablePromise<Array<model_SubscriptionGroup>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/subscription-groups',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建订阅组
     * 创建新的订阅组
     * @returns model_SubscriptionGroup OK
     * @throws ApiError
     */
    public static adminCreateSubscriptionGroup({
        requestBody,
    }: {
        /**
         * 订阅组信息
         */
        requestBody: handler_CreateGroupRequest,
    }): CancelablePromise<model_SubscriptionGroup> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscription-groups',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 删除订阅组
     * 根据 ID 删除订阅组
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteSubscriptionGroup({
        id,
    }: {
        /**
         * 订阅组 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/subscription-groups/{id}',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取订阅组节点列表
     * 返回指定订阅组的节点 MAC 列表
     * @returns string OK
     * @throws ApiError
     */
    public static adminGetSubscriptionGroupNodes({
        id,
    }: {
        /**
         * 订阅组 ID
         */
        id: number,
    }): CancelablePromise<Array<string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/subscription-groups/{id}/nodes',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 设置订阅组节点
     * 替换指定订阅组的节点列表
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetSubscriptionGroupNodes({
        id,
        requestBody,
    }: {
        /**
         * 订阅组 ID
         */
        id: number,
        /**
         * 节点列表
         */
        requestBody: handler_SetGroupNodesRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/admin/subscription-groups/{id}/nodes',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 重置订阅组 Token
     * 为指定订阅组生成新的访问 Token
     * @returns handler_ResetTokenResponse OK
     * @throws ApiError
     */
    public static adminResetSubscriptionGroupToken({
        id,
    }: {
        /**
         * 订阅组 ID
         */
        id: number,
    }): CancelablePromise<handler_ResetTokenResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscription-groups/{id}/reset-token',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 删除订阅
     * 删除指定订阅
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteSubscription({
        id,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/subscriptions/{id}',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 更新订阅
     * 更新订阅状态、流量限制或到期时间
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateSubscription({
        id,
        requestBody,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
        /**
         * 更新字段
         */
        requestBody: handler_UpdateSubscriptionRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/subscriptions/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 激活订阅
     * 手动将订阅状态设为 active
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminActivateSubscription({
        id,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscriptions/{id}/activate',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 过期订阅
     * 手动将订阅状态设为 expired
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminExpireSubscription({
        id,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscriptions/{id}/expire',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 重置订阅 Token
     * 为订阅生成新的 Token
     * @returns handler_ResetSubscriptionTokenResponse OK
     * @throws ApiError
     */
    public static adminResetSubscriptionToken({
        id,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
    }): CancelablePromise<handler_ResetSubscriptionTokenResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscriptions/{id}/reset-token',
            path: {
                'id': id,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 重置订阅流量
     * 将指定订阅的 traffic_used 重置为 0
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminResetSubscriptionTraffic({
        id,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscriptions/{id}/reset-traffic',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 暂停订阅
     * 手动将订阅状态设为 suspended
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminSuspendSubscription({
        id,
    }: {
        /**
         * 订阅 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscriptions/{id}/suspend',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取工单列表
     * 分页获取工单列表，支持按状态和客户筛选
     * @returns handler_TicketListResponse OK
     * @throws ApiError
     */
    public static adminListTickets({
        status,
        customerId,
        page,
        limit,
    }: {
        /**
         * 按状态筛选
         */
        status?: string,
        /**
         * 按客户 ID 筛选
         */
        customerId?: string,
        /**
         * 页码（默认 1）
         */
        page?: number,
        /**
         * 每页数量（默认 20，最大 100）
         */
        limit?: number,
    }): CancelablePromise<handler_TicketListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/tickets',
            query: {
                'status': status,
                'customer_id': customerId,
                'page': page,
                'limit': limit,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 删除工单
     * 删除指定工单及其所有回复
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteTicket({
        id,
    }: {
        /**
         * 工单 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/tickets/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取工单详情
     * 根据 ID 获取工单及其所有回复
     * @returns handler_TicketDetailResponse OK
     * @throws ApiError
     */
    public static adminGetTicket({
        id,
    }: {
        /**
         * 工单 ID
         */
        id: number,
    }): CancelablePromise<handler_TicketDetailResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/tickets/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 关闭工单
     * 将指定工单状态设为 closed
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminCloseTicket({
        id,
    }: {
        /**
         * 工单 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/tickets/{id}/close',
            path: {
                'id': id,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 管理员回复工单
     * 为指定工单添加管理员回复，工单状态自动变为 replied
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminReplyTicket({
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
        requestBody: handler_TicketReplyRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/tickets/{id}/replies',
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
    /**
     * 获取流量汇总
     * 返回活跃订阅的流量使用总量、活跃数和超限数
     * @returns handler_TrafficSummaryResponse OK
     * @throws ApiError
     */
    public static adminTrafficSummary(): CancelablePromise<handler_TrafficSummaryResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/traffic/summary',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取用户列表
     * 返回所有用户及其角色
     * @returns handler_UserWithRoles OK
     * @throws ApiError
     */
    public static adminListUsers(): CancelablePromise<Array<handler_UserWithRoles>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/users',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 创建用户
     * 创建新的管理后台用户
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminCreateUser({
        requestBody,
    }: {
        /**
         * 用户信息
         */
        requestBody: handler_CreateUserRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/users',
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
     * 删除用户
     * 根据 ID 删除管理后台用户
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteUser({
        id,
    }: {
        /**
         * 用户 ID
         */
        id: number,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/users/{id}',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 修改用户密码
     * 修改指定用户的密码（可改自己或需要 user:write 权限）
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminChangePassword({
        id,
        requestBody,
    }: {
        /**
         * 用户 ID
         */
        id: number,
        /**
         * 新密码
         */
        requestBody: handler_ChangePasswordRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/users/{id}/password',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                403: `Forbidden`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取用户角色
     * 返回指定用户的角色名称列表
     * @returns string OK
     * @throws ApiError
     */
    public static adminGetUserRoles({
        id,
    }: {
        /**
         * 用户 ID
         */
        id: number,
    }): CancelablePromise<Array<string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/users/{id}/roles',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                404: `Not Found`,
            },
        });
    }
    /**
     * 设置用户角色
     * 替换指定用户的所有角色
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetUserRoles({
        id,
        requestBody,
    }: {
        /**
         * 用户 ID
         */
        id: number,
        /**
         * 角色列表
         */
        requestBody: handler_SetRolesRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/admin/users/{id}/roles',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 打印节点标签页面
     * 返回可打印的节点标签 HTML 页面
     * @returns string HTML page
     * @throws ApiError
     */
    public static labelsPrint(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/labels',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * List nodes
     * List all nodes with optional filters
     * @returns model_Node OK
     * @throws ApiError
     */
    public static nodesList({
        status,
        enabled,
        country,
        region,
        search,
        tags,
    }: {
        /**
         * filter by status
         */
        status?: string,
        /**
         * filter by enabled (0 or 1)
         */
        enabled?: string,
        /**
         * filter by country
         */
        country?: string,
        /**
         * filter by region
         */
        region?: string,
        /**
         * search hostname, location, note, or mac
         */
        search?: string,
        /**
         * filter by tags (comma-separated)
         */
        tags?: string,
    }): CancelablePromise<Array<model_Node>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes',
            query: {
                'status': status,
                'enabled': enabled,
                'country': country,
                'region': region,
                'search': search,
                'tags': tags,
            },
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Delete a node
     * Delete a node by MAC address
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static nodeDelete({
        mac,
    }: {
        /**
         * node MAC address
         */
        mac: string,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/nodes/{mac}',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
            },
        });
    }
    /**
     * Get a node
     * Get a single node by MAC address
     * @returns model_Node OK
     * @throws ApiError
     */
    public static nodeGet({
        mac,
    }: {
        /**
         * node MAC address
         */
        mac: string,
    }): CancelablePromise<model_Node> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/nodes/{mac}',
            path: {
                'mac': mac,
            },
            errors: {
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Update a node
     * Update allowed fields of a node by MAC address
     * @returns handler_StatusResponse OK
     * @throws ApiError
     */
    public static nodeUpdate({
        mac,
        requestBody,
    }: {
        /**
         * node MAC address
         */
        mac: string,
        /**
         * fields to update
         */
        requestBody: handler_NodeUpdateRequest,
    }): CancelablePromise<handler_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/nodes/{mac}',
            path: {
                'mac': mac,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取 Prometheus 抓取目标
     * 返回 file_sd 格式的节点列表，供 Prometheus 服务发现使用
     * @returns handler_PrometheusTarget OK
     * @throws ApiError
     */
    public static prometheusTargets(): CancelablePromise<Array<handler_PrometheusTarget>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/prometheus-targets',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
}
