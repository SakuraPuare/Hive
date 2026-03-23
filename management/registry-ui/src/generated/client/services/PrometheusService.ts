/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { main_PrometheusTarget } from '../models/main_PrometheusTarget';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PrometheusService {
    /**
     * Prometheus file_sd targets
     * @returns main_PrometheusTarget OK
     * @throws ApiError
     */
    public static prometheusTargets(): CancelablePromise<Array<main_PrometheusTarget>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/prometheus-targets',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
}
