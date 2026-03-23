/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class LabelsService {
    /**
     * Print labels (HTML)
     * @returns string HTML content
     * @throws ApiError
     */
    public static labelsPrint(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/labels',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
}
