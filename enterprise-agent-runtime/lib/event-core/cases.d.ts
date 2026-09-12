import { type BusinessEvent, type CasePatch, type CaseRecord } from './contracts.js';
export declare class CaseStore {
    private readonly cases;
    createFromEvent(event: BusinessEvent, title: string, ownerId?: string | null): CaseRecord;
    patch(caseId: string, patch: CasePatch): CaseRecord;
    require(caseId: string): CaseRecord;
    list(tenantId?: string): readonly CaseRecord[];
}
