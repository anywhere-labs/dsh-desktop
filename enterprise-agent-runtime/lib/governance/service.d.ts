import type { EventLedger } from '../event-core/ledger.js';
type GovernanceContext = {
    readonly ledger: EventLedger;
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly brandId: string;
};
export declare class PermissionService {
    private readonly context?;
    private readonly members;
    constructor(context?: GovernanceContext | undefined);
    registerMember(userId: string, tenantId: string, roles: readonly string[], options?: {
        readonly persist?: boolean;
    }): void;
    can(userId: string, tenantId: string, permission: string): boolean;
    assertCan(userId: string, tenantId: string, permission: string): void;
    private rehydrate;
}
export interface ResponsibilityRecord {
    readonly caseId: string;
    readonly ownerId: string;
    readonly status: 'UNASSIGNED' | 'CLAIMED' | 'ACCEPTED' | 'RELEASED';
    readonly assignedAt: string;
}
export declare class ResponsibilityService {
    private readonly context;
    private readonly permissions;
    private readonly records;
    constructor(context: GovernanceContext, permissions: PermissionService);
    claim(caseId: string, actorId: string): ResponsibilityRecord;
    accept(caseId: string, actorId: string): ResponsibilityRecord;
    release(caseId: string, ownerId: string): ResponsibilityRecord;
    transfer(caseId: string, fromUserId: string, toUserId: string): ResponsibilityRecord;
    private apply;
    get(caseId: string): ResponsibilityRecord | undefined;
    private rehydrate;
    private emit;
}
export interface SlaRecord {
    readonly caseId: string;
    readonly ownerId: string;
    readonly dueAt: string;
    readonly status: 'OPEN' | 'ESCALATED' | 'MET';
}
export declare class SlaService {
    private readonly context;
    private readonly notifications;
    private readonly records;
    constructor(context: GovernanceContext, notifications: NotificationService);
    start(caseId: string, ownerId: string, durationMs: number, now?: Date): SlaRecord;
    evaluate(now?: Date): readonly SlaRecord[];
    list(): readonly SlaRecord[];
    private emit;
    private rehydrate;
}
export interface NotificationRecord {
    readonly notificationId: string;
    readonly recipientId: string;
    readonly kind: string;
    readonly caseId: string;
    readonly message: string;
    readonly status: 'queued';
}
export declare class NotificationService {
    private readonly context;
    private readonly records;
    constructor(context: GovernanceContext);
    send(input: Omit<NotificationRecord, 'notificationId' | 'status'>): NotificationRecord;
    list(): readonly NotificationRecord[];
    private rehydrate;
}
export {};
