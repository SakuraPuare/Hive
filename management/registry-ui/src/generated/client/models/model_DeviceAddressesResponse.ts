/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { model_DeviceEgress } from './model_DeviceEgress';
import type { model_LANAddress } from './model_LANAddress';
export type model_DeviceAddressesResponse = {
    egress?: model_DeviceEgress;
    hostname?: string;
    lan?: Array<model_LANAddress>;
    last_seen?: string;
    mac?: string;
    sampled_at?: string;
};

