import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, relative, resolve } from 'node:path';
import { CommerceOpsService } from './commerce-ops-service.js';
function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(JSON.stringify(value));
}
function sameOrigin(req, origin) {
    return req.headers.origin === undefined || req.headers.origin === origin;
}
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > 512 * 1024)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('request body must be an object');
    return parsed;
}
function pageHtml() {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Commerce Ops</title><style>body{margin:0;background:#20242b;color:#f5f1e8;font:14px system-ui,sans-serif}main{padding:32px;max-width:1100px;margin:auto}header{display:flex;justify-content:space-between;align-items:start;margin-bottom:24px}h1{margin:0;font-size:28px}p{color:#aeb5c1}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.card{padding:16px;border:1px solid #3b424d;border-radius:10px;background:#292e36}.label{color:#aeb5c1;font-size:12px}.value{margin-top:8px;font-size:24px;font-weight:700}.delta{margin-top:6px;color:#9ed39d;font-size:11px}.button{padding:9px 13px;border:1px solid #d4a84b;border-radius:8px;background:#d4a84b;color:#20242b;cursor:pointer}@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}} </style></head><body><main><header><div><h1>经营驾驶舱</h1><p>Mock 店铺 · 所有建议均带证据</p></div><button class="button" onclick="loadMetrics()">刷新数据</button></header><section id="metrics" class="grid"></section></main><script>async function loadMetrics(){const r=await fetch("/api/commerce-ops/metrics?shopId=shop_001");const d=await r.json();document.querySelector("#metrics").innerHTML=d.metrics.map(m=>'<article class="card"><div class="label">'+m.metricId+'</div><div class="value">'+m.value+'</div><div class="delta">Mock evidence · '+m.source.evidenceId+'</div></article>').join("")}loadMetrics()</script></body></html>`;
}
export function registerCommerceOpsRoutes(webServer, service = new CommerceOpsService()) {
    const page = '/commerce-ops';
    const api = '/api/commerce-ops';
    const origin = `http://127.0.0.1:${String(webServer.port)}`;
    const registrations = [
        webServer.register({ kind: 'exact', path: `${api}/runtime`, handler: (req, res) => {
                if (req.method !== 'GET' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'runtime requires local same-origin GET' });
                sendJson(res, 200, service.runtime);
            } }),
        webServer.register({ kind: 'exact', path: `${api}/agent-space`, handler: async (req, res) => {
                if (!sameOrigin(req, origin))
                    return sendJson(res, 403, { error: 'agent space requires local same-origin access' });
                const url = new URL(req.url ?? `${api}/agent-space`, origin);
                if (req.method === 'GET')
                    return sendJson(res, 200, service.getAgentSpaceSnapshot(url.searchParams.get('tenantId') ?? undefined));
                if (req.method === 'POST' && url.pathname === `${api}/agent-space/demo`) {
                    try {
                        return sendJson(res, 200, await service.seedAgentSpaceDemo());
                    }
                    catch (cause) {
                        return sendJson(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
                    }
                }
                return sendJson(res, 405, { error: 'agent space supports GET or POST demo' });
            } }),
        webServer.register({ kind: 'exact', path: `${api}/agent-space/board`, handler: async (req, res) => {
                if (req.method !== 'GET' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'agent space board requires local same-origin GET' });
                const url = new URL(req.url ?? `${api}/agent-space/board`, origin);
                const actorId = url.searchParams.get('actorId') ?? 'local-user';
                try {
                    return sendJson(res, 200, service.getHumanBoard(actorId));
                }
                catch (cause) {
                    return sendJson(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'prefix', path: `${api}/agent-space/responsibilities/`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'responsibility action requires local same-origin POST' });
                const match = new URL(req.url ?? '/', origin).pathname.match(new RegExp(`^${api}/agent-space/responsibilities/([^/]+)/(claim|accept|release|transfer)$`));
                if (!match)
                    return sendJson(res, 404, { error: 'responsibility action not found' });
                try {
                    const body = await readJson(req);
                    const actorId = typeof body.actorId === 'string' ? body.actorId : 'local-user';
                    const record = match[2] === 'claim' ? service.claimResponsibility(match[1], actorId)
                        : match[2] === 'accept' ? service.acceptResponsibility(match[1], actorId)
                            : match[2] === 'release' ? service.releaseResponsibility(match[1], actorId)
                                : service.transferResponsibility(match[1], actorId, typeof body.toUserId === 'string' ? body.toUserId : actorId);
                    return sendJson(res, 200, record);
                }
                catch (cause) {
                    return sendJson(res, 409, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: `${api}/agent-space/demo`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'agent space demo requires local same-origin POST' });
                try {
                    return sendJson(res, 200, await service.seedAgentSpaceDemo());
                }
                catch (cause) {
                    return sendJson(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: `${api}/decisions`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'decisions require local same-origin POST' });
                try {
                    const body = await readJson(req);
                    return sendJson(res, 201, service.recordHumanDecision({ insightId: String(body.insightId), decision: body.decision, decidedBy: String(body.decidedBy ?? 'local-user'), ...(typeof body.note === 'string' ? { note: body.note } : {}) }));
                }
                catch (cause) {
                    return sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: `${api}/responsibilities/transfer`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'responsibility transfer requires local same-origin POST' });
                try {
                    const body = await readJson(req);
                    return sendJson(res, 200, service.transferResponsibility(String(body.caseId), String(body.fromUserId), String(body.toUserId)));
                }
                catch (cause) {
                    return sendJson(res, 403, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: `${api}/sla/start`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'sla start requires local same-origin POST' });
                try {
                    const body = await readJson(req);
                    return sendJson(res, 201, service.startSla(String(body.caseId), String(body.ownerId), Number(body.durationMs)));
                }
                catch (cause) {
                    return sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: `${api}/sla/evaluate`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'sla evaluation requires local same-origin POST' });
                return sendJson(res, 200, { escalated: service.evaluateSla() });
            } }),
        webServer.register({ kind: 'exact', path: `${api}/notifications`, handler: (req, res) => {
                if (req.method !== 'GET' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'notifications require local same-origin GET' });
                return sendJson(res, 200, { notifications: service.listNotifications() });
            } }),
        webServer.register({ kind: 'exact', path: `${api}/metrics`, handler: async (req, res) => {
                if (req.method !== 'GET' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'metrics requires local same-origin GET' });
                const url = new URL(req.url ?? `${api}/metrics`, origin);
                const shopId = url.searchParams.get('shopId') ?? 'shop_001';
                const from = url.searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
                const to = url.searchParams.get('to') ?? from;
                sendJson(res, 200, await service.getShopMetrics(shopId, from, to));
            } }),
        webServer.register({ kind: 'exact', path: `${api}/daily-report`, handler: async (req, res) => {
                if (req.method !== 'GET' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'daily report requires local same-origin GET' });
                const url = new URL(req.url ?? `${api}/daily-report`, origin);
                const shopId = url.searchParams.get('shopId') ?? 'shop_001';
                const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
                sendJson(res, 200, await service.runDailyReport(shopId, date));
            } }),
        webServer.register({ kind: 'exact', path: `${api}/dry-run`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'dry run requires local same-origin POST' });
                try {
                    return sendJson(res, 200, service.dryRun(await readJson(req)));
                }
                catch (cause) {
                    return sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: `${api}/approvals`, handler: async (req, res) => {
                if (!sameOrigin(req, origin))
                    return sendJson(res, 403, { error: 'approvals require local same-origin access' });
                if (req.method === 'GET')
                    return sendJson(res, 200, { approvals: service.listApprovals() });
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'approvals support GET or POST' });
                try {
                    const body = await readJson(req);
                    const action = body.action;
                    const requesterId = typeof body.requesterId === 'string' ? body.requesterId : 'local-user';
                    if (typeof action !== 'object' || action === null || Array.isArray(action))
                        return sendJson(res, 400, { error: 'action is required' });
                    return sendJson(res, 201, service.createApproval(action, requesterId));
                }
                catch (cause) {
                    return sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'prefix', path: `${api}/approvals/`, handler: async (req, res) => {
                if (req.method !== 'POST' || !sameOrigin(req, origin))
                    return sendJson(res, 405, { error: 'approval action requires local same-origin POST' });
                const match = new URL(req.url ?? '/', origin).pathname.match(new RegExp(`^${api}/approvals/([^/]+)/(approve|reject)$`));
                if (!match)
                    return sendJson(res, 404, { error: 'approval action not found' });
                try {
                    const body = await readJson(req);
                    const operatorId = typeof body.operatorId === 'string' ? body.operatorId : 'local-user';
                    const record = match[2] === 'approve' ? service.approve(match[1], operatorId) : service.reject(match[1], operatorId);
                    return sendJson(res, 200, record);
                }
                catch (cause) {
                    return sendJson(res, 409, { error: cause instanceof Error ? cause.message : String(cause) });
                }
            } }),
        webServer.register({ kind: 'exact', path: page, handler: (_req, res) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'text/html; charset=utf-8');
                res.setHeader('cache-control', 'no-store');
                res.end(pageHtml());
            } }),
        webServer.register({ kind: 'exact', path: `${page}/`, handler: (_req, res) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'text/html; charset=utf-8');
                res.setHeader('cache-control', 'no-store');
                res.end(pageHtml());
            } }),
    ];
    return () => { for (const unregister of registrations)
        unregister(); };
}
const WORKBENCH_PAGE = '/commerce-ops-workbench';
const WORKBENCH_CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
};
function workbenchDistRoot() {
    const configured = process.env.DSH_COMMERCE_OPS_DIST?.trim();
    if (configured)
        return resolve(configured);
    const fromPackage = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
    const fromCwd = resolve(process.cwd(), 'dist');
    const fromParent = resolve(process.cwd(), '..', 'dsh-plugin-commerce-ops/dist');
    return [fromPackage, fromCwd, fromParent].find(path => existsSync(path)) ?? fromPackage;
}
async function serveWorkbenchFile(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD')
        return sendJson(res, 405, { error: 'commerce ops workbench requires GET' });
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const suffix = pathname === WORKBENCH_PAGE || pathname === `${WORKBENCH_PAGE}/` ? 'index.html' : pathname.slice(`${WORKBENCH_PAGE}/`.length);
    let decoded = '';
    try {
        decoded = decodeURIComponent(suffix);
    }
    catch {
        return sendJson(res, 400, { error: 'invalid commerce ops workbench asset path' });
    }
    if (!decoded || decoded.includes('\u0000') || decoded.includes('..') || decoded.includes('\\'))
        return sendJson(res, 400, { error: 'invalid commerce ops workbench asset path' });
    const root = resolve(workbenchDistRoot());
    const filename = resolve(root, decoded);
    const relativeName = relative(root, filename);
    if (relativeName.startsWith('..') || relativeName.includes('\\'))
        return sendJson(res, 400, { error: 'invalid commerce ops workbench asset path' });
    try {
        const info = await stat(filename);
        if (!info.isFile())
            throw new Error('not a file');
        const body = await readFile(filename);
        res.statusCode = 200;
        res.setHeader('content-type', WORKBENCH_CONTENT_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('cache-control', extname(filename) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('content-length', String(body.byteLength));
        if (req.method === 'HEAD')
            res.end();
        else
            res.end(body);
    }
    catch {
        sendJson(res, 404, { error: 'commerce ops workbench asset not found' });
    }
}
export function registerCommerceOpsWorkbenchPage(webServer) {
    const registrations = [
        webServer.register({ kind: 'prefix', path: WORKBENCH_PAGE, handler: serveWorkbenchFile }),
        webServer.register({ kind: 'exact', path: WORKBENCH_PAGE, handler: (_req, res) => { res.statusCode = 302; res.setHeader('location', `${WORKBENCH_PAGE}/`); res.end(); } }),
    ];
    return () => { for (const unregister of registrations)
        unregister(); };
}
