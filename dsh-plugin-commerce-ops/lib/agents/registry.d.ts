export type AgentDefinition = {
    readonly agentId: string;
    readonly role: string;
    readonly subscribesTo: readonly string[];
    readonly skillIds: readonly string[];
    readonly humanOwnerRole: string;
    readonly notResponsibleFor: readonly string[];
};
export declare const agentDefinitions: readonly AgentDefinition[];
export declare function getAgent(agentId: string): AgentDefinition;
