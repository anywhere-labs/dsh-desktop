import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { api } from '../api.js';
export function ProductLibraryPage({ onCreated }) { const [title, setTitle] = useState(''); const [message, setMessage] = useState(''); const create = async () => { try {
    await api.createProduct({ title, category: '女装', price: 299, assetPaths: ['products/demo/cover.png'] });
    setMessage('商品档案已创建');
    setTitle('');
    onCreated();
}
catch (error) {
    setMessage(error instanceof Error ? error.message : '创建失败');
} }; return _jsxs("div", { className: "xn-page-card", children: [_jsxs("div", { className: "xn-section-head", children: [_jsxs("div", { children: [_jsx("span", { className: "xn-eyebrow", children: "PRODUCT LIBRARY" }), _jsx("h2", { children: "\u5546\u54C1\u6863\u6848" })] }), _jsx("span", { className: "xn-chip soft", children: "\u672C\u5730 mock \u6570\u636E" })] }), _jsxs("div", { className: "xn-form-row", children: [_jsx("input", { value: title, onChange: event => setTitle(event.target.value), placeholder: "\u8F93\u5165\u5546\u54C1\u540D\u79F0\uFF0C\u4F8B\u5982\uFF1A\u6625\u5B63\u98CE\u8863" }), _jsx("button", { className: "xn-primary", disabled: !title.trim(), onClick: create, children: "\u4FDD\u5B58\u5546\u54C1\u6863\u6848" })] }), message && _jsx("p", { className: "xn-notice", children: message }), _jsxs("div", { className: "xn-empty", children: [_jsx("span", { children: "\u25A6" }), _jsx("b", { children: "\u5546\u54C1\u6863\u6848\u662F\u6240\u6709\u8FD0\u8425\u4EFB\u52A1\u7684\u8D77\u70B9" }), _jsx("small", { children: "\u5148\u521B\u5EFA\u4E00\u4E2A\u5546\u54C1\uFF0CAgent \u624D\u80FD\u8BFB\u53D6\u8D44\u6599\u5E76\u751F\u4EA7\u5185\u5BB9\u3002" })] })] }); }
