async function json(response) {
    if (!response.ok)
        throw new Error(`agent space request failed: HTTP ${String(response.status)}`);
    return await response.json();
}
export async function getAgentSpaceSnapshot() {
    return json(await fetch('/api/commerce-ops/agent-space'));
}
export async function getHumanBoard(actorId = 'local-user') {
    return json(await fetch('/api/commerce-ops/agent-space/board?actorId=' + encodeURIComponent(actorId)));
}
export async function decideApproval(approvalId, decision) {
    return json(await fetch(`/api/commerce-ops/approvals/${encodeURIComponent(approvalId)}/${decision}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operatorId: 'local-user' }) }));
}
export async function decideResponsibility(caseId, action, actorId = 'local-user', toUserId) {
    return json(await fetch(`/api/commerce-ops/agent-space/responsibilities/${encodeURIComponent(caseId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId, ...(toUserId ? { toUserId } : {}) }) }));
}
export async function seedAgentSpaceDemo() {
    return json(await fetch('/api/commerce-ops/agent-space/demo', { method: 'POST' }));
}
export async function runInventoryAlertDemo(scenario = 'normal') {
    return json(await fetch('/api/commerce-ops/inventory-alert/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) }));
}
export async function runPlatformSandboxDemo(platformId, environment = 'demo', scenario = 'success') {
    return json(await fetch('/api/commerce-ops/platform-sandbox/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platformId, environment, scenario }) }));
}
export async function runVocDemo(scenario = 'normal') {
    return json(await fetch('/api/commerce-ops/voc/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) }));
}
export async function runDryRun(input) {
    const response = await fetch('/api/commerce-ops/dry-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok)
        throw new Error(`dry run failed: HTTP ${String(response.status)}`);
    return await response.json();
}
export async function listApprovals() {
    return json(await fetch('/api/commerce-ops/approvals'));
}
