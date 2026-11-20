import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HostListingRecord, RoomRecord } from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';
export declare class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private readonly appConfig;
    private db;
    constructor(appConfig: AppConfigService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private ensureOpen;
    private addColumnIfMissing;
    private initSchema;
    close(): void;
    getAllRoomIds(): Set<string>;
    getCompletedRoomIds(): Set<string>;
    upsertRoom(room: RoomRecord): void;
    upsertHostRoom(room: HostListingRecord): void;
    getRooms(params: {
        locationQuery?: string;
        search?: string;
        page?: number;
        limit?: number;
    }): {
        items: any;
        total: number;
        page: number;
        limit: number;
        stats: {
            totalRooms: number;
            uniqueHosts: number;
            avgPrice: number;
            totalHostRooms: number;
        };
    };
    getRoomCountForCity(locationQuery?: string): number;
    getAllRoomsForCity(locationQuery?: string): any[];
    getAllHostRoomsForCity(locationQuery?: string): any[];
    getOutOfTargetHostRooms(locationQuery?: string): any[];
    getAllCitiesSummary(): Array<{
        city: string;
        totalRooms: number;
        highRiseRooms: number;
        uniqueHosts: number;
        avgPrice: number;
        avgRating: number;
    }>;
    getTopHostsOverall(limit?: number): Array<{
        host_id: string;
        host_name: string;
        city: string;
        rooms_count: number;
        avg_price: number;
    }>;
    getRoomsWithValidCoords(cityName?: string): any[];
    countBuildingClusters(cityName?: string): number;
    replaceBuildingClusters(cityName: string, clusters: Array<{
        cluster_id: string;
        listing_ids: string[];
        center_lat: number;
        center_lng: number;
        building_name?: string;
        address_note?: string;
    }>): void;
    findCachedBuildingByCoords(lat: number, lng: number, radiusMeters?: number): {
        building_name: string;
        address_note: string;
    } | null;
    upsertGeoBuildingCache(centerLat: number, centerLng: number, buildingName: string, addressNote?: string): void;
    applyBuildingNameToCluster(params: {
        clusterId: string;
        buildingName: string;
        addressNote?: string;
        centerLat?: number | null;
        centerLng?: number | null;
        radiusMeters?: number;
    }): number;
}
