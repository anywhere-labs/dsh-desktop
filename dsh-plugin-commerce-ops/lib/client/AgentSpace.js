import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { decideApproval, decideResponsibility, getAgentSpaceSnapshot, getHumanBoard, runInventoryAlertDemo, runPlatformSandboxDemo, seedAgentSpaceDemo } from './api.js';
const viewLabels = {
    all: '全部经营事件',
    'waiting-confirm': '待我确认',
    'waiting-approval': '待我审核',
    owned: '我负责',
    'blocked-timeout': '被阻塞超时',
};
export function AgentSpace() {
    const [snapshot, setSnapshot] = useState({ events: [], responsibilities: [], approvals: [], receipts: [] });
    const [boards, setBoards] = useState([]);
    const [active, setActive] = useState('all');
    const [error, setError] = useState();
    const [working, setWorking] = useState(false);
    const [sandboxEnvironment, setSandboxEnvironment] = useState('demo');
    const refresh = async () => {
        setWorking(true);
        try {
            const [space, board] = await Promise.all([getAgentSpaceSnapshot(), getHumanBoard()]);
            setSnapshot(space);
            setBoards(board);
            setError(undefined);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setWorking(false);
        }
    };
    useEffect(() => { void refresh(); }, []);
    const runDemo = async () => { setWorking(true); try {
        await seedAgentSpaceDemo();
        await refresh();
        setError(undefined);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
        setWorking(false);
    } };
    const runInventoryDemo = async () => { setWorking(true); try {
        await runInventoryAlertDemo('normal');
        await refresh();
        setError(undefined);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
        setWorking(false);
    } };
    const runPlatformDemo = async (platformId) => { setWorking(true); try {
        await runPlatformSandboxDemo(platformId, sandboxEnvironment);
        await refresh();
        setError(undefined);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
        setWorking(false);
    } };
    const act = async (caseId, action, toUserId) => { setWorking(true); try {
        await decideResponsibility(caseId, action, 'local-user', toUserId);
        await refresh();
        setError(undefined);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
        setWorking(false);
    } };
    const decide = async (approvalId, decision) => { setWorking(true); try {
        await decideApproval(approvalId, decision);
        await refresh();
        setError(undefined);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
        setWorking(false);
    } };
    const board = boards.find(item => item.key === active) ?? boards[0];
    const responsibilities = board?.responsibilities ?? [];
    const approvals = board?.approvals ?? [];
    return _jsxs("section", { className: "opsAgentSpace", children: [_jsxs("header", { className: "opsPageHeader", children: [_jsxs("div", { children: [_jsx("h1", { className: "opsPageTitle", children: "Agent Space" }), _jsx("p", { className: "opsPageSubtitle", children: "\u4E8B\u4EF6\u9A71\u52A8\u7684\u4F01\u4E1A\u534F\u540C\u7A7A\u95F4 \u00B7 \u672C\u5730 JSONL \u4E8B\u4EF6\u8D26\u672C" })] }), _jsxs("div", { className: "opsActions", children: [_jsx("button", { className: "opsButton", onClick: () => void refresh(), disabled: working, children: "\u5237\u65B0" }), _jsx("button", { className: "opsButton", onClick: () => void runDemo(), disabled: working, children: "\u8F7D\u5165\u7ADE\u54C1\u964D\u4EF7\u6F14\u793A" }), _jsx("button", { className: "opsButton opsButtonPrimary", onClick: () => void runInventoryDemo(), disabled: working, children: "\u8F7D\u5165\u5E93\u5B58\u9884\u8B66\u6F14\u793A" }), _jsxs("select", { className: "opsSelect", "aria-label": "\u5E73\u53F0\u6F14\u793A\u73AF\u5883", value: sandboxEnvironment, onChange: event => setSandboxEnvironment(event.target.value), disabled: working, children: [_jsx("option", { value: "demo", children: "Demo \u4EC5\u6F14\u793A" }), _jsx("option", { value: "sandbox", children: "Sandbox \u672C\u5730\u6A21\u62DF" }), _jsx("option", { value: "production", children: "Production\uFF08\u5B89\u5168\u963B\u65AD\uFF09" })] }), _jsx("button", { className: "opsButton", onClick: () => void runPlatformDemo('douyin'), disabled: working, children: "\u6296\u97F3\u9884\u89C8" }), _jsx("button", { className: "opsButton", onClick: () => void runPlatformDemo('xiaohongshu'), disabled: working, children: "\u5C0F\u7EA2\u4E66\u9884\u89C8" })] })] }), error && _jsx("p", { className: "opsError", children: error }), _jsx("nav", { className: "opsBoardTabs", "aria-label": "\u4EBA\u770B\u677F\u5165\u53E3", children: Object.entries(viewLabels).map(([key, label]) => _jsxs("button", { className: "opsBoardTab", "data-active": active === key, onClick: () => setActive(key), children: [label, _jsx("span", { className: "opsBadge", children: countFor(boards, key) })] }, key)) }), _jsxs("section", { className: "opsSpaceGrid", children: [_jsxs("article", { className: "opsPanel", children: [_jsxs("h2", { className: "opsPanelTitle", children: ["\u8D23\u4EFB ", _jsx("span", { className: "opsBadge", children: responsibilities.length })] }), responsibilities.length === 0 ? _jsx("p", { className: "opsPageSubtitle", children: "\u5F53\u524D\u89C6\u56FE\u6682\u65E0\u8D23\u4EFB\u4E8B\u9879" }) : responsibilities.map(item => _jsxs("div", { className: "opsSpaceRow", children: [_jsxs("div", { children: [_jsx("strong", { children: item.title }), _jsxs("small", { children: [item.caseId, " \u00B7 Owner\uFF1A", item.ownerId ?? '未分配', " \u00B7 ", item.caseStatus, " \u00B7 ", item.responsibilityStatus] }), item.blocked && _jsx("em", { className: "opsInlineWarn", children: "\u88AB\u963B\u585E" }), item.timeout && _jsx("em", { className: "opsInlineWarn", children: "\u8D85\u65F6" })] }), _jsxs("div", { className: "opsActions", children: [_jsx("button", { className: "opsButton", onClick: () => void act(item.caseId, 'claim'), disabled: working, children: "\u63A5\u7BA1" }), _jsx("button", { className: "opsButton", onClick: () => void act(item.caseId, 'accept'), disabled: working, children: "\u63A5\u53D7" }), _jsx("button", { className: "opsButton", onClick: () => void act(item.caseId, 'release'), disabled: working, children: "\u91CA\u653E" }), _jsx("button", { className: "opsButton", onClick: () => void act(item.caseId, 'transfer', 'human_brand_owner_001'), disabled: working, children: "\u8F6C\u6D3E" })] })] }, item.caseId))] }), _jsxs("article", { className: "opsPanel", children: [_jsxs("h2", { className: "opsPanelTitle", children: ["\u5BA1\u6279 ", _jsx("span", { className: "opsBadge", children: approvals.length })] }), approvals.length === 0 ? _jsx("p", { className: "opsPageSubtitle", children: "\u5F53\u524D\u89C6\u56FE\u65E0\u5F85\u5BA1\u6279\u52A8\u4F5C" }) : approvals.map(item => _jsxs("div", { className: "opsSpaceRow", children: [_jsxs("div", { children: [_jsx("strong", { children: item.actionId }), _jsxs("small", { children: [item.approvalId, " \u00B7 ", item.caseId, " \u00B7 ", item.approverId ?? '等待人工'] })] }), _jsx("div", { className: "opsActions", children: item.status === 'pending' ? _jsxs(_Fragment, { children: [_jsx("button", { className: "opsButton", onClick: () => void decide(item.approvalId, 'reject'), disabled: working, children: "\u9A73\u56DE" }), _jsx("button", { className: "opsButton opsButtonPrimary", onClick: () => void decide(item.approvalId, 'approve'), disabled: working, children: "\u6279\u51C6" })] }) : _jsx("span", { className: "opsStatus", "data-status": item.status === 'approved' ? 'success' : 'danger', children: item.status }) })] }, item.approvalId))] }), _jsxs("article", { className: "opsPanel", children: [_jsxs("h2", { className: "opsPanelTitle", children: ["\u4E8B\u4EF6 ", _jsx("span", { className: "opsBadge", children: snapshot.events.length })] }), snapshot.events.length === 0 ? _jsx("p", { className: "opsPageSubtitle", children: "\u6682\u65E0\u4E8B\u4EF6\uFF0C\u70B9\u51FB\u53F3\u4E0A\u89D2\u8F7D\u5165\u6F14\u793A" }) : snapshot.events.map(event => _jsxs("div", { className: "opsSpaceRow", children: [_jsxs("div", { children: [_jsx("strong", { children: event.eventType }), _jsxs("small", { children: [event.brandId, " \u00B7 ", event.correlationId] })] }), _jsx("span", { className: "opsStatus", "data-status": "success", children: "\u5DF2\u8BB0\u5F55" })] }, event.eventId))] }), _jsxs("article", { className: "opsPanel", children: [_jsxs("h2", { className: "opsPanelTitle", children: ["\u56DE\u6267 ", _jsx("span", { className: "opsBadge", children: snapshot.receipts.length })] }), snapshot.receipts.length === 0 ? _jsx("p", { className: "opsPageSubtitle", children: "\u6682\u65E0\u56DE\u6267" }) : snapshot.receipts.map(item => _jsxs("div", { className: "opsSpaceRow", children: [_jsxs("div", { children: [_jsx("strong", { children: item.actionId }), _jsxs("small", { children: [item.receiptId, " \u00B7 ", item.mode] })] }), _jsxs("span", { className: "opsStatus", "data-status": "success", children: [item.status, " \u00B7 ", item.externalWrite ? '外部写入' : '无外部写入'] })] }, item.receiptId))] })] })] });
}
function countFor(boards, key) {
    const view = boards.find(item => item.key === key);
    if (!view)
        return 0;
    return view.responsibilities.length + view.approvals.length;
}
