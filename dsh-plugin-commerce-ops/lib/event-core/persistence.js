import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { businessEventSchema } from './contracts.js';
export const SUPPORTED_SCHEMA_VERSIONS = ['event.v1'];
export const DEFAULT_SCHEMA_VERSION = 'event.v1';
class SchemaVersionError extends Error {
    constructor(line, version) {
        super(`unsupported event schema version "${String(version)}" at line ${line}; supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
        this.name = 'SchemaVersionError';
    }
}
function parseLine(line, index, allowed) {
    if (!line)
        throw new Error(`empty event log line ${String(index + 1)}`);
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (cause) {
        throw new Error(`invalid event log line ${String(index + 1)}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error(`invalid event log line ${String(index + 1)}: not an object`);
    const version = parsed.schemaVersion;
    if (typeof version !== 'string' || !allowed.includes(version))
        throw new SchemaVersionError(index + 1, version);
    return businessEventSchema.parse(parsed);
}
function sanitizeTenant(tenantId) {
    return tenantId.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function readLines(filePath, allowed) {
    if (!existsSync(filePath))
        return [];
    const raw = readFileSync(filePath, 'utf8');
    if (!raw)
        return [];
    return raw.split('\n').filter(Boolean).map((line, index) => parseLine(line, index, allowed));
}
/** Single JSONL event store with schema-version validation on read. */
export class JsonlEventStore {
    filePath;
    allowedSchemaVersions;
    constructor(filePath, allowedSchemaVersions = SUPPORTED_SCHEMA_VERSIONS) {
        this.filePath = filePath;
        this.allowedSchemaVersions = allowedSchemaVersions;
    }
    read() {
        return readLines(this.filePath, this.allowedSchemaVersions);
    }
    append(event) {
        parseLine(JSON.stringify(event), 0, this.allowedSchemaVersions);
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
    }
}
/** Tenant-partitioned JSONL store: one file per tenant, plus schema-version validation. */
export class PartitionedJsonlEventStore {
    baseDir;
    allowedSchemaVersions;
    constructor(baseDir, allowedSchemaVersions = SUPPORTED_SCHEMA_VERSIONS) {
        this.baseDir = baseDir;
        this.allowedSchemaVersions = allowedSchemaVersions;
    }
    partition(event) {
        return join(this.baseDir, `${sanitizeTenant(event.tenantId)}.events.jsonl`);
    }
    read() {
        if (!existsSync(this.baseDir))
            return [];
        const events = [];
        for (const name of readdirSync(this.baseDir).filter(name => name.endsWith('.events.jsonl')).sort()) {
            events.push(...readLines(join(this.baseDir, name), this.allowedSchemaVersions));
        }
        return events;
    }
    append(event) {
        parseLine(JSON.stringify(event), 0, this.allowedSchemaVersions);
        const file = this.partition(event);
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
    }
}
