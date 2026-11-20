/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { model_DeviceEgress } from './model_DeviceEgress';
import type { model_LANAddress } from './model_LANAddress';
export type model_DeviceAddressSnapshot = {
    egress?: model_DeviceEgress;
    /**
     * HotspotCapable reports a Wi-Fi adapter that supports AP mode. Legacy
     * agents omit it; portal falls back to an observed hotspot address.
     */
    hotspot_capable?: boolean;
    lan?: Array<model_LANAddress>;
};

