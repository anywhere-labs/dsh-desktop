import { type BusinessEvent } from './contracts.js';
import type { EventStore } from './ledger.js';
export declare const SUPPORTED_SCHEMA_VERSIONS: readonly ["event.v1"];
export declare const DEFAULT_SCHEMA_VERSION = "event.v1";
/** Single JSONL event store with schema-version validation on read. */
export declare class JsonlEventStore implements EventStore {
    readonly filePath: string;
    readonly allowedSchemaVersions: readonly string[];
    constructor(filePath: string, allowedSchemaVersions?: readonly string[]);
    read(): readonly BusinessEvent[];
    append(event: BusinessEvent): void;
}
/** Tenant-partitioned JSONL store: one file per tenant, plus schema-version validation. */
export declare class PartitionedJsonlEventStore implements EventStore {
    readonly baseDir: string;
    readonly allowedSchemaVersions: readonly string[];
    constructor(baseDir: string, allowedSchemaVersions?: readonly string[]);
    private partition;
    read(): readonly BusinessEvent[];
    append(event: BusinessEvent): void;
}
