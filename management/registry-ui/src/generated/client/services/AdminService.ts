/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { main_AdminLoginRequest } from '../models/main_AdminLoginRequest';
import type { main_AuditLog } from '../models/main_AuditLog';
import type { main_ChangePasswordRequest } from '../models/main_ChangePasswordRequest';
import type { main_CreateCustomerRequest } from '../models/main_CreateCustomerRequest';
import type { main_CreateGroupRequest } from '../models/main_CreateGroupRequest';
import type { main_CreateLineRequest } from '../models/main_CreateLineRequest';
import type { main_CreatePlanRequest } from '../models/main_CreatePlanRequest';
import type { main_CreatePromoCodeRequest } from '../models/main_CreatePromoCodeRequest';
import type { main_CreateSubscriptionRequest } from '../models/main_CreateSubscriptionRequest';
import type { main_CreateUserRequest } from '../models/main_CreateUserRequest';
import type { main_Customer } from '../models/main_Customer';
import type { main_CustomerDetail } from '../models/main_CustomerDetail';
import type { main_CustomerSubscription } from '../models/main_CustomerSubscription';
import type { main_CustomerTrafficResponse } from '../models/main_CustomerTrafficResponse';
import type { main_Line } from '../models/main_Line';
import type { main_NodeStatusCheck } from '../models/main_NodeStatusCheck';
import type { main_Order } from '../models/main_Order';
import type { main_OrderListResponse } from '../models/main_OrderListResponse';
import type { main_Plan } from '../models/main_Plan';
import type { main_PromoCode } from '../models/main_PromoCode';
import type { main_ResetCustomerPasswordRequest } from '../models/main_ResetCustomerPasswordRequest';
import type { main_ResetTokenResponse } from '../models/main_ResetTokenResponse';
import type { main_RiskEventListResponse } from '../models/main_RiskEventListResponse';
import type { main_Role } from '../models/main_Role';
import type { main_SetGroupNodesRequest } from '../models/main_SetGroupNodesRequest';
import type { main_SetLineNodesRequest } from '../models/main_SetLineNodesRequest';
import type { main_SetPermissionsRequest } from '../models/main_SetPermissionsRequest';
import type { main_SetPlanLinesRequest } from '../models/main_SetPlanLinesRequest';
import type { main_SetRolesRequest } from '../models/main_SetRolesRequest';
import type { main_StatusResponse } from '../models/main_StatusResponse';
import type { main_SubscriptionGroup } from '../models/main_SubscriptionGroup';
import type { main_TicketDetailResponse } from '../models/main_TicketDetailResponse';
import type { main_TicketListResponse } from '../models/main_TicketListResponse';
import type { main_TicketReplyRequest } from '../models/main_TicketReplyRequest';
import type { main_UpdateCustomerRequest } from '../models/main_UpdateCustomerRequest';
import type { main_UpdateLineRequest } from '../models/main_UpdateLineRequest';
import type { main_UpdateOrderStatusRequest } from '../models/main_UpdateOrderStatusRequest';
import type { main_UpdatePlanRequest } from '../models/main_UpdatePlanRequest';
import type { main_UpdatePromoCodeRequest } from '../models/main_UpdatePromoCodeRequest';
import type { main_UpdateSubscriptionRequest } from '../models/main_UpdateSubscriptionRequest';
import type { main_User } from '../models/main_User';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminService {
    /**
     * List audit logs
     * @returns main_AuditLog OK
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
         * limit (default 50)
         */
        limit?: number,
        /**
         * offset (default 0)
         */
        offset?: number,
        /**
         * filter by action
         */
        action?: string,
        /**
         * filter by username
         */
        username?: string,
        /**
         * filter from date (ISO 8601)
         */
        from?: string,
        /**
         * filter to date (ISO 8601)
         */
        to?: string,
    }): CancelablePromise<Array<main_AuditLog>> {
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
                401: `Unauthorized`,
                403: `Forbidden`,
            },
        });
    }
    /**
     * List customers
     * Paginated list of customers with optional status/email/search filters
     * @returns any OK
     * @throws ApiError
     */
    public static adminListCustomers({
        status,
        email,
        search,
        page = 1,
        limit = 20,
    }: {
        /**
         * Filter by status
         */
        status?: string,
        /**
         * Filter by email (partial match)
         */
        email?: string,
        /**
         * Search email or nickname
         */
        search?: string,
        /**
         * Page number
         */
        page?: number,
        /**
         * Items per page
         */
        limit?: number,
    }): CancelablePromise<{
        items?: Array<main_Customer>;
        limit?: number;
        page?: number;
        total?: number;
    }> {
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
     * Create customer
     * Create a new customer with email, password, and optional nickname
     * @returns main_Customer OK
     * @throws ApiError
     */
    public static adminCreateCustomer({
        requestBody,
    }: {
        /**
         * Customer info
         */
        requestBody: main_CreateCustomerRequest,
    }): CancelablePromise<main_Customer> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/customers',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Delete customer
     * Permanently delete a customer account
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteCustomer({
        id,
    }: {
        /**
         * Customer ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
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
     * Get customer
     * Get customer details including all subscriptions
     * @returns main_CustomerDetail OK
     * @throws ApiError
     */
    public static adminGetCustomer({
        id,
    }: {
        /**
         * Customer ID
         */
        id: number,
    }): CancelablePromise<main_CustomerDetail> {
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
     * Update customer
     * Update customer nickname and/or status
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateCustomer({
        id,
        requestBody,
    }: {
        /**
         * Customer ID
         */
        id: number,
        /**
         * Fields to update
         */
        requestBody: main_UpdateCustomerRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Reset customer password
     * Set a new password for the customer
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminResetCustomerPassword({
        id,
        requestBody,
    }: {
        /**
         * Customer ID
         */
        id: number,
        /**
         * New password
         */
        requestBody: main_ResetCustomerPasswordRequest,
    }): CancelablePromise<main_StatusResponse> {
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
     * List subscriptions
     * Get all subscriptions belonging to a customer
     * @returns main_CustomerSubscription OK
     * @throws ApiError
     */
    public static adminListSubscriptions({
        id,
    }: {
        /**
         * Customer ID
         */
        id: number,
    }): CancelablePromise<Array<main_CustomerSubscription>> {
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
     * Create subscription
     * Create a new subscription for a customer based on a plan
     * @returns main_CustomerSubscription OK
     * @throws ApiError
     */
    public static adminCreateSubscription({
        id,
        requestBody,
    }: {
        /**
         * Customer ID
         */
        id: number,
        /**
         * Subscription info
         */
        requestBody: main_CreateSubscriptionRequest,
    }): CancelablePromise<main_CustomerSubscription> {
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
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Get customer traffic
     * Per-subscription traffic summary with upload/download totals
     * @returns main_CustomerTrafficResponse OK
     * @throws ApiError
     */
    public static adminGetCustomerTraffic({
        id,
    }: {
        /**
         * Customer ID
         */
        id: number,
    }): CancelablePromise<main_CustomerTrafficResponse> {
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
     * List all lines
     * @returns main_Line OK
     * @throws ApiError
     */
    public static adminListLines(): CancelablePromise<Array<main_Line>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/lines',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Create a new line
     * @returns any OK
     * @throws ApiError
     */
    public static adminCreateLine({
        requestBody,
    }: {
        /**
         * Line to create
         */
        requestBody: main_CreateLineRequest,
    }): CancelablePromise<{
        id?: number;
        token?: string;
    }> {
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
     * Delete a line
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteLine({
        id,
    }: {
        /**
         * Line ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
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
     * Update a line
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateLine({
        id,
        requestBody,
    }: {
        /**
         * Line ID
         */
        id: number,
        /**
         * Fields to update
         */
        requestBody: main_UpdateLineRequest,
    }): CancelablePromise<main_StatusResponse> {
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
     * Get MAC addresses of nodes assigned to a line
     * @returns string OK
     * @throws ApiError
     */
    public static adminGetLineNodes({
        id,
    }: {
        /**
         * Line ID
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
     * Set nodes assigned to a line
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetLineNodes({
        id,
        requestBody,
    }: {
        /**
         * Line ID
         */
        id: number,
        /**
         * Node MAC addresses
         */
        requestBody: main_SetLineNodesRequest,
    }): CancelablePromise<main_StatusResponse> {
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
     * Reset the subscription token for a line
     * @returns main_ResetTokenResponse OK
     * @throws ApiError
     */
    public static adminResetLineToken({
        id,
    }: {
        /**
         * Line ID
         */
        id: number,
    }): CancelablePromise<main_ResetTokenResponse> {
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
    /**
     * Get current logged-in user info
     * @returns main_User OK
     * @throws ApiError
     */
    public static adminMe(): CancelablePromise<main_User> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/me',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * List node status checks
     * @returns main_NodeStatusCheck OK
     * @throws ApiError
     */
    public static adminNodeStatus(): CancelablePromise<Array<main_NodeStatusCheck>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/node-status',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * List orders
     * @returns main_OrderListResponse OK
     * @throws ApiError
     */
    public static adminListOrders({
        customerId,
        status,
        page,
        limit,
    }: {
        /**
         * filter by customer ID
         */
        customerId?: number,
        /**
         * filter by order status
         */
        status?: string,
        /**
         * page number (default 1)
         */
        page?: number,
        /**
         * page size (default 20, max 100)
         */
        limit?: number,
    }): CancelablePromise<main_OrderListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/orders',
            query: {
                'customer_id': customerId,
                'status': status,
                'page': page,
                'limit': limit,
            },
        });
    }
    /**
     * Get order by ID
     * @returns main_Order OK
     * @throws ApiError
     */
    public static adminGetOrder({
        id,
    }: {
        /**
         * order ID
         */
        id: number,
    }): CancelablePromise<main_Order> {
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
     * Update order status
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateOrderStatus({
        id,
        requestBody,
    }: {
        /**
         * order ID
         */
        id: number,
        /**
         * new status
         */
        requestBody: main_UpdateOrderStatusRequest,
    }): CancelablePromise<main_StatusResponse> {
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
     * List all available permissions
     * @returns any OK
     * @throws ApiError
     */
    public static adminListPermissions(): CancelablePromise<Array<Record<string, any>>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/permissions',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * List all plans
     * @returns main_Plan OK
     * @throws ApiError
     */
    public static adminListPlans(): CancelablePromise<Array<main_Plan>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/plans',
        });
    }
    /**
     * Create a plan
     * @returns any OK
     * @throws ApiError
     */
    public static adminCreatePlan({
        requestBody,
    }: {
        /**
         * Plan to create
         */
        requestBody: main_CreatePlanRequest,
    }): CancelablePromise<{
        id?: number;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/plans',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Delete a plan
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeletePlan({
        id,
    }: {
        /**
         * Plan ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/plans/{id}',
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
     * Update a plan
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdatePlan({
        id,
        requestBody,
    }: {
        /**
         * Plan ID
         */
        id: number,
        /**
         * Fields to update
         */
        requestBody: main_UpdatePlanRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Get line IDs for a plan
     * @returns number OK
     * @throws ApiError
     */
    public static adminGetPlanLines({
        id,
    }: {
        /**
         * Plan ID
         */
        id: number,
    }): CancelablePromise<Array<number>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/plans/{id}/lines',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Set line IDs for a plan
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetPlanLines({
        id,
        requestBody,
    }: {
        /**
         * Plan ID
         */
        id: number,
        /**
         * Line IDs to associate
         */
        requestBody: main_SetPlanLinesRequest,
    }): CancelablePromise<main_StatusResponse> {
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
     * List promo codes
     * @returns main_PromoCode OK
     * @throws ApiError
     */
    public static adminListPromoCodes(): CancelablePromise<Array<main_PromoCode>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/promo-codes',
        });
    }
    /**
     * Create promo code
     * @returns main_PromoCode OK
     * @throws ApiError
     */
    public static adminCreatePromoCode({
        requestBody,
    }: {
        /**
         * promo code payload
         */
        requestBody: main_CreatePromoCodeRequest,
    }): CancelablePromise<main_PromoCode> {
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
     * Delete promo code
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeletePromoCode({
        id,
    }: {
        /**
         * promo code ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
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
     * Update promo code
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdatePromoCode({
        id,
        requestBody,
    }: {
        /**
         * promo code ID
         */
        id: number,
        /**
         * fields to update
         */
        requestBody: main_UpdatePromoCodeRequest,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/promo-codes/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * List risk events
     * @returns main_RiskEventListResponse OK
     * @throws ApiError
     */
    public static adminListRiskEvents({
        customerId,
        eventType,
        page,
        limit,
    }: {
        /**
         * filter by customer ID
         */
        customerId?: number,
        /**
         * filter by event type
         */
        eventType?: string,
        /**
         * page number (default 1)
         */
        page?: number,
        /**
         * page size (default 20, max 100)
         */
        limit?: number,
    }): CancelablePromise<main_RiskEventListResponse> {
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
     * List all roles with their permissions
     * @returns main_Role OK
     * @throws ApiError
     */
    public static adminListRoles(): CancelablePromise<Array<main_Role>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/roles',
            errors: {
                401: `Unauthorized`,
                403: `Forbidden`,
            },
        });
    }
    /**
     * Replace role permissions
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetRolePermissions({
        id,
        requestBody,
    }: {
        /**
         * role id
         */
        id: number,
        /**
         * permissions list
         */
        requestBody: main_SetPermissionsRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                403: `Forbidden`,
                404: `Not Found`,
            },
        });
    }
    /**
     * List subscription groups
     * @returns main_SubscriptionGroup OK
     * @throws ApiError
     */
    public static adminListSubscriptionGroups(): CancelablePromise<Array<main_SubscriptionGroup>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/subscription-groups',
            errors: {
                401: `Unauthorized`,
                403: `Forbidden`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Create subscription group
     * @returns main_SubscriptionGroup OK
     * @throws ApiError
     */
    public static adminCreateSubscriptionGroup({
        requestBody,
    }: {
        /**
         * group name
         */
        requestBody: main_CreateGroupRequest,
    }): CancelablePromise<main_SubscriptionGroup> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscription-groups',
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
     * Delete subscription group
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteSubscriptionGroup({
        id,
    }: {
        /**
         * group id
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/subscription-groups/{id}',
            path: {
                'id': id,
            },
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
     * List node MACs in a subscription group
     * @returns string OK
     * @throws ApiError
     */
    public static adminGetSubscriptionGroupNodes({
        id,
    }: {
        /**
         * group id
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
                401: `Unauthorized`,
                403: `Forbidden`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Replace node MACs in a subscription group
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetSubscriptionGroupNodes({
        id,
        requestBody,
    }: {
        /**
         * group id
         */
        id: number,
        /**
         * node MAC list
         */
        requestBody: main_SetGroupNodesRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                401: `Unauthorized`,
                403: `Forbidden`,
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Reset subscription group token
     * @returns main_ResetTokenResponse OK
     * @throws ApiError
     */
    public static adminResetSubscriptionGroupToken({
        id,
    }: {
        /**
         * group id
         */
        id: number,
    }): CancelablePromise<main_ResetTokenResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscription-groups/{id}/reset-token',
            path: {
                'id': id,
            },
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
     * Delete subscription
     * Permanently delete a customer subscription
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteSubscription({
        id,
    }: {
        /**
         * Subscription ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/subscriptions/{id}',
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
     * Update subscription
     * Update subscription status, traffic limit, or expiry
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminUpdateSubscription({
        id,
        requestBody,
    }: {
        /**
         * Subscription ID
         */
        id: number,
        /**
         * Fields to update
         */
        requestBody: main_UpdateSubscriptionRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * Reset subscription token
     * Generate a new random token for the subscription
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminResetSubscriptionToken({
        id,
    }: {
        /**
         * Subscription ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/subscriptions/{id}/reset-token',
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
     * List tickets
     * @returns main_TicketListResponse OK
     * @throws ApiError
     */
    public static adminListTickets({
        status,
        customerId,
        page,
        limit,
    }: {
        /**
         * filter by ticket status
         */
        status?: string,
        /**
         * filter by customer ID
         */
        customerId?: number,
        /**
         * page number (default 1)
         */
        page?: number,
        /**
         * page size (default 20, max 100)
         */
        limit?: number,
    }): CancelablePromise<main_TicketListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/tickets',
            query: {
                'status': status,
                'customer_id': customerId,
                'page': page,
                'limit': limit,
            },
        });
    }
    /**
     * Delete a ticket
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteTicket({
        id,
    }: {
        /**
         * ticket ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
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
     * Get ticket by ID
     * @returns main_TicketDetailResponse OK
     * @throws ApiError
     */
    public static adminGetTicket({
        id,
    }: {
        /**
         * ticket ID
         */
        id: number,
    }): CancelablePromise<main_TicketDetailResponse> {
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
     * Close a ticket
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminCloseTicket({
        id,
    }: {
        /**
         * ticket ID
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
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
     * Reply to a ticket
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminReplyTicket({
        id,
        requestBody,
    }: {
        /**
         * ticket ID
         */
        id: number,
        /**
         * reply content
         */
        requestBody: main_TicketReplyRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                404: `Not Found`,
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * List all users
     * @returns main_User OK
     * @throws ApiError
     */
    public static adminListUsers(): CancelablePromise<Array<main_User>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/users',
            errors: {
                401: `Unauthorized`,
                403: `Forbidden`,
            },
        });
    }
    /**
     * Create a new user
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminCreateUser({
        requestBody,
    }: {
        /**
         * create user payload
         */
        requestBody: main_CreateUserRequest,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/users',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                403: `Forbidden`,
            },
        });
    }
    /**
     * Delete a user
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminDeleteUser({
        id,
    }: {
        /**
         * user id
         */
        id: number,
    }): CancelablePromise<main_StatusResponse> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/users/{id}',
            path: {
                'id': id,
            },
            errors: {
                400: `Bad Request`,
                401: `Unauthorized`,
                403: `Forbidden`,
                404: `Not Found`,
            },
        });
    }
    /**
     * Change user password (superadmin for others, any user for self)
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminChangePassword({
        id,
        requestBody,
    }: {
        /**
         * user id
         */
        id: number,
        /**
         * new password
         */
        requestBody: main_ChangePasswordRequest,
    }): CancelablePromise<main_StatusResponse> {
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
            },
        });
    }
    /**
     * Get user roles
     * @returns string OK
     * @throws ApiError
     */
    public static adminGetUserRoles({
        id,
    }: {
        /**
         * user id
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
                401: `Unauthorized`,
                403: `Forbidden`,
                404: `Not Found`,
            },
        });
    }
    /**
     * Replace user roles
     * @returns main_StatusResponse OK
     * @throws ApiError
     */
    public static adminSetUserRoles({
        id,
        requestBody,
    }: {
        /**
         * user id
         */
        id: number,
        /**
         * roles list
         */
        requestBody: main_SetRolesRequest,
    }): CancelablePromise<main_StatusResponse> {
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
                401: `Unauthorized`,
                403: `Forbidden`,
                404: `Not Found`,
            },
        });
    }
}
