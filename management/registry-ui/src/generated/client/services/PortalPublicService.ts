/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { model_Announcement } from '../models/model_Announcement';
import type { model_Plan } from '../models/model_Plan';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PortalPublicService {
    /**
     * 获取公开公告列表
     * @returns model_Announcement OK
     * @throws ApiError
     */
    public static portalAnnouncements(): CancelablePromise<Array<model_Announcement>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/announcements',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
    /**
     * 获取公开套餐列表
     * @returns model_Plan OK
     * @throws ApiError
     */
    public static portalPlans(): CancelablePromise<Array<model_Plan>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/portal/plans',
            errors: {
                500: `Internal Server Error`,
            },
        });
    }
}
