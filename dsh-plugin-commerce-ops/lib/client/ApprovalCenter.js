import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { decideApproval, listApprovals } from './api.js';
export function ApprovalCenter() {
    const [approvals, setApprovals] = useState([]);
    const [error, setError] = useState();
    const refresh = async () => { try {
        setApprovals(await listApprovals());
        setError(undefined);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    } };
    useEffect(() => { void refresh(); }, []);
    return _jsxs("section", { className: "opsPanel opsApprovalCenter", children: [_jsxs("h2", { className: "opsPanelTitle", children: ["\u5BA1\u6279\u4E2D\u5FC3 ", _jsxs("span", { className: "opsBadge", children: [approvals.filter(item => item.status === 'pending').length, " \u5F85\u5904\u7406"] })] }), error && _jsx("p", { className: "opsError", children: error }), approvals.length === 0 && _jsx("p", { className: "opsPageSubtitle", children: "\u6682\u65E0\u5BA1\u6279\u52A8\u4F5C" }), approvals.map(item => _jsxs("article", { className: "opsApprovalRow", children: [_jsxs("div", { children: [_jsx("strong", { children: item.action.actionType }), _jsxs("small", { children: [item.action.target.platform, " \u00B7 ", item.action.target.shopId, " \u00B7 ", item.action.riskLevel] })] }), _jsx("div", { className: "opsActions", children: item.status === 'pending' ? _jsxs(_Fragment, { children: [_jsx("button", { className: "opsButton", onClick: () => void decideApproval(item.approvalId, 'reject').then(refresh), children: "\u62D2\u7EDD" }), _jsx("button", { className: "opsButton opsButtonPrimary", onClick: () => void decideApproval(item.approvalId, 'approve').then(refresh), children: "\u6279\u51C6" })] }) : _jsx("span", { className: "opsStatus", "data-status": item.status === 'approved' ? 'success' : 'danger', children: item.status }) })] }, item.approvalId))] });
}
