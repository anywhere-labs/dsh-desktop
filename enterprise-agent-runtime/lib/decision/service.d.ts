export interface HumanDecision {
    readonly insightId: string;
    readonly decision: 'accept' | 'modify' | 'reject';
    readonly decidedBy: string;
    readonly note?: string;
}
export declare class HumanDecisionService {
    private readonly eventContext?;
    constructor(eventContext?: {
        readonly ledger: EventLedger;
        readonly tenantId: string;
        readonly enterpriseId: string;
        readonly brandId: string;
    } | undefined);
    record(decision: HumanDecision): {
        readonly status: 'recorded';
        readonly decision: HumanDecision;
        readonly externalActionExecuted: false;
    };
}
import type { EventLedger } from '../event-core/ledger.js';
