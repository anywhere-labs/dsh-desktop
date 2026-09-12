from __future__ import annotations

from typing import Any

DEFAULT_CHANNELS = [
    {"name": "搜索广告", "aipl": "I", "budget": 180000, "cpm": 75, "ctr": 0.035, "interest_rate": 0.45, "pay_rate": 0.16, "aov": 380, "refund_rate": 0.12, "margin": 0.40},
    {"name": "信息流 / 短视频", "aipl": "A", "budget": 160000, "cpm": 55, "ctr": 0.014, "interest_rate": 0.14, "pay_rate": 0.08, "aov": 340, "refund_rate": 0.15, "margin": 0.35},
    {"name": "达人内容 / 分销", "aipl": "I", "budget": 120000, "cpm": 90, "ctr": 0.02, "interest_rate": 0.30, "pay_rate": 0.12, "aov": 360, "refund_rate": 0.14, "margin": 0.36},
    {"name": "直播投流", "aipl": "P", "budget": 220000, "cpm": 100, "ctr": 0.05, "interest_rate": 0.55, "pay_rate": 0.22, "aov": 420, "refund_rate": 0.13, "margin": 0.42},
    {"name": "CRM / 私域", "aipl": "L", "budget": 60000, "cpm": 120, "ctr": 0.07, "interest_rate": 0.75, "pay_rate": 0.30, "aov": 460, "refund_rate": 0.10, "margin": 0.45},
]

DEFAULT_INVENTORY = [
    {"role": "引流款", "daily_sales": 220, "days": 14, "warmup_factor": 1.4, "burst_factor": 3.5, "burst_days": 3, "available": 8200, "lead_days": 7, "safety_factor": 1.2},
    {"role": "爆款", "daily_sales": 260, "days": 14, "warmup_factor": 1.3, "burst_factor": 4.2, "burst_days": 3, "available": 10500, "lead_days": 10, "safety_factor": 1.3},
    {"role": "利润款 / 套装", "daily_sales": 150, "days": 14, "warmup_factor": 1.2, "burst_factor": 2.5, "burst_days": 3, "available": 4200, "lead_days": 12, "safety_factor": 1.25},
    {"role": "礼盒 / 形象款", "daily_sales": 70, "days": 14, "warmup_factor": 1.5, "burst_factor": 2.0, "burst_days": 3, "available": 1600, "lead_days": 15, "safety_factor": 1.35},
]


def _channel(row: dict[str, Any]) -> dict[str, Any]:
    budget = float(row.get("budget") or 0)
    cpm = max(float(row.get("cpm") or 1), 1)
    impressions = budget / cpm * 1000
    clicks = impressions * float(row.get("ctr") or 0)
    interest = clicks * float(row.get("interest_rate") or 0)
    payers = interest * float(row.get("pay_rate") or 0)
    gross_sales = payers * float(row.get("aov") or 0)
    net_sales = gross_sales * (1 - float(row.get("refund_rate") or 0))
    contribution_profit = net_sales * float(row.get("margin") or 0)
    return {**row, "impressions": round(impressions), "clicks": round(clicks), "interest_users": round(interest), "paid_users": round(payers), "gross_sales": round(gross_sales, 2), "net_sales": round(net_sales, 2), "contribution_profit": round(contribution_profit, 2), "roas": round(gross_sales / budget, 2) if budget else 0, "contribution_roi": round((contribution_profit - budget) / budget, 2) if budget else 0, "paid_cac": round(budget / payers, 2) if payers else None}


def _inventory(row: dict[str, Any]) -> dict[str, Any]:
    daily = float(row.get("daily_sales") or 0)
    days = float(row.get("days") or 0)
    burst_days = float(row.get("burst_days") or 0)
    forecast = daily * (days - burst_days) * float(row.get("warmup_factor") or 0) + daily * burst_days * float(row.get("burst_factor") or 0)
    safety_stock = daily * float(row.get("lead_days") or 0) * float(row.get("safety_factor") or 1)
    recommended = forecast + safety_stock
    available = float(row.get("available") or 0)
    gap = recommended - available
    return {**row, "forecast_sales": round(forecast), "safety_stock": round(safety_stock), "recommended_stock": round(recommended), "stock_gap": round(gap), "risk": "缺货风险" if gap > 0 else "库存可覆盖"}


def simulate_campaign(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    channels = [_channel(item) for item in (payload.get("channels") or DEFAULT_CHANNELS)]
    inventory = [_inventory(item) for item in (payload.get("inventory") or DEFAULT_INVENTORY)]
    total_budget = sum(item["budget"] for item in channels)
    total_gross = sum(item["gross_sales"] for item in channels)
    total_net = sum(item["net_sales"] for item in channels)
    total_profit = sum(item["contribution_profit"] for item in channels)
    paid_users = sum(item["paid_users"] for item in channels)
    aipl_input = payload.get("aipl") or {"A": 250000, "I": 55000, "P": 12000, "L": 3500}
    f = float(payload.get("fast_f") or aipl_input.get("A") or 0)
    s = float(payload.get("fast_s") or aipl_input.get("L") or 0)
    active_s = float(payload.get("fast_t_active") or s * 0.6)
    aipl = {"A": int(aipl_input.get("A") or 0), "I": int(aipl_input.get("I") or 0), "P": int(aipl_input.get("P") or 0), "L": int(aipl_input.get("L") or 0), "A_to_I": round(float(aipl_input.get("I") or 0) / float(aipl_input.get("A") or 1), 4), "I_to_P": round(float(aipl_input.get("P") or 0) / float(aipl_input.get("I") or 1), 4), "P_to_L": round(float(aipl_input.get("L") or 0) / float(aipl_input.get("P") or 1), 4)}
    aov = float(payload.get("ltv_aov") or 360)
    margin = float(payload.get("ltv_margin") or 0.38)
    frequency = float(payload.get("ltv_frequency") or 2.4)
    service_margin = float(payload.get("ltv_service_margin") or 20)
    ltv = aov * margin * frequency + service_margin
    return {"assumption_note": "结果是可编辑假设的经营模拟，不是平台实绩或业绩承诺。请用近90日同渠道、同人群数据替换。", "channels": channels, "inventory": inventory, "aipl": aipl, "fast": {"F": int(f), "A_rate": round(paid_users / f, 4) if f else 0, "S": int(s), "T_rate": round(active_s / s, 4) if s else 0, "T_active": int(active_s)}, "summary": {"budget": round(total_budget, 2), "gross_sales": round(total_gross, 2), "net_sales": round(total_net, 2), "contribution_profit": round(total_profit, 2), "roas": round(total_gross / total_budget, 2) if total_budget else 0, "contribution_roi": round((total_profit - total_budget) / total_budget, 2) if total_budget else 0, "paid_users": round(paid_users), "blended_cac": round(total_budget / paid_users, 2) if paid_users else None, "ltv": round(ltv, 2), "ltv_cac": round(ltv / (total_budget / paid_users), 2) if paid_users and total_budget else None}, "rules": ["订单以 order_id 去重，用户以 customer_id 去重，触点以 event_id 去重。", "平台 ROAS 用于平台优化；经营报表使用统一订单、退款回冲和成本口径。", "库存建议备货 = 预测活动销量 + 日均预测销量 × 安全库存天数。"]}
