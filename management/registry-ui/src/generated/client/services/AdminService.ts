/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { main_AdminLoginRequest } from '../models/main_AdminLoginRequest';
import type { main_AuditLog } from '../models/main_AuditLog';
import type { main_ChangePasswordRequest } from '../models/main_ChangePasswordRequest';
import type { main_CreateGroupRequest } from '../models/main_CreateGroupRequest';
import type { main_CreateUserRequest } from '../models/main_CreateUserRequest';
import type { main_ResetTokenResponse } from '../models/main_ResetTokenResponse';
import type { main_Role } from '../models/main_Role';
import type { main_SetGroupNodesRequest } from '../models/main_SetGroupNodesRequest';
import type { main_SetPermissionsRequest } from '../models/main_SetPermissionsRequest';
import type { main_SetRolesRequest } from '../models/main_SetRolesRequest';
import type { main_StatusResponse } from '../models/main_StatusResponse';
import type { main_SubscriptionGroup } from '../models/main_SubscriptionGroup';
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
    }: {
        /**
         * limit (default 50)
         */
        limit?: number,
        /**
         * offset (default 0)
         */
        offset?: number,
    }): CancelablePromise<Array<main_AuditLog>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/admin/audit-logs',
            query: {
                'limit': limit,
                'offset': offset,
            },
            errors: {
                401: `Unauthorized`,
                403: `Forbidden`,
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
