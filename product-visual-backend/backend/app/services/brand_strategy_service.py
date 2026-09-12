from __future__ import annotations

import json
import os
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from backend.app.services.api_settings_service import _effective_api_base, load_env_file, read_settings


FUNNEL_STAGES = [
    {"key": "awareness", "name": "认知", "question": "目标人群是否看见并理解品牌？", "metric": "曝光 / 搜索量 / 触达人数", "action": "用品类话题、场景内容和差异化记忆点建立第一印象。"},
    {"key": "interest", "name": "兴趣", "question": "用户是否愿意进一步了解？", "metric": "3秒留存 / 点击率 / 收藏率", "action": "把用户痛点、产品证据和使用场景讲清楚，降低理解成本。"},
    {"key": "consideration", "name": "考虑", "question": "用户是否相信品牌值得选择？", "metric": "详情页停留 / 加购率 / 私信咨询", "action": "补齐对比、口碑、案例、服务与价格理由，形成选择依据。"},
    {"key": "conversion", "name": "转化", "question": "用户是否完成购买或留资？", "metric": "支付转化率 / 留资率 / ROI", "action": "优化商品承接、权益设计、直播话术和明确 CTA。"},
    {"key": "loyalty", "name": "复购与推荐", "question": "用户是否回来并愿意推荐？", "metric": "复购率 / NPS / UGC 数量", "action": "用交付体验、会员机制和可分享的品牌体验沉淀长期资产。"},
]

AARRR_STAGES = [
    {"key": "acquisition", "name": "Acquisition 获客", "focus": "让目标用户进入品牌可经营范围", "metrics": ["有效触达", "搜索进入", "新增关注"]},
    {"key": "activation", "name": "Activation 激活", "focus": "让用户完成第一次有价值的体验", "metrics": ["首个关键动作", "内容互动", "首次咨询"]},
    {"key": "retention", "name": "Retention 留存", "focus": "让用户持续回来并形成习惯", "metrics": ["7/30日留存", "复访", "复购"]},
    {"key": "revenue", "name": "Revenue 收益", "focus": "把价值交换变成可持续收入", "metrics": ["客单价", "转化率", "LTV"]},
    {"key": "referral", "name": "Referral 推荐", "focus": "让满意用户带来下一批用户", "metrics": ["分享率", "推荐订单", "UGC"]},
]

AIPL_FAST_COMPARISON = [
    {"model": "AIPL", "type": "人群资产模型", "stages": "Awareness 认知 → Interest 兴趣 → Purchase 购买 → Loyalty 忠诚", "best_for": "618、双11等平台大促的人群蓄水、爆发与资产沉淀", "roi_question": "每一层人群资产如何被识别、转化和回流？"},
    {"model": "FAST", "type": "经营效率模型", "stages": "Fast-track Acquisition → Fast-track Activation → Fast-track Retention → Fast-track Transaction", "best_for": "缩短从获客到成交的路径，优化内容、搜索、店铺和会员承接效率", "roi_question": "哪些触点能更快把高意向用户推进到交易？"},
    {"model": "AARRR", "type": "增长与留存模型", "stages": "Acquisition → Activation → Retention → Revenue → Referral", "best_for": "会员、私域和复购机制，判断大促新增用户是否形成长期价值", "roi_question": "一次大促新增用户能否在30/60/90天产生贡献毛利？"},
]

ANNUAL_NODES = [
    {"node": "品牌官方活动", "goal": "建立品牌资产", "models": "STP / 品牌金字塔 / AIPL认知与兴趣", "audience": "高潜人群、品牌兴趣人群、媒体与KOL受众", "kpi": "搜索增长、声量、内容互动、会员新增"},
    {"node": "平台活动", "goal": "获取公域流量、验证爆品", "models": "漏斗 / AIPL / 4P", "audience": "类目人群、竞品人群、搜索人群", "kpi": "CTR、进店率、CVR、ROI"},
    {"node": "618", "goal": "上半年放量并建立下半年人群池", "models": "AIPL + 漏斗 + AARRR", "audience": "新客、价格敏感人群、加购未购人群", "kpi": "新客成本、加购支付率、ROI、会员沉淀"},
    {"node": "双11", "goal": "年度成交、会员收割与品类扩张", "models": "RFM + AIPL + LTV/CAC", "audience": "高价值老客、会员、潜客、跨品类人群", "kpi": "GMV、贡献毛利、复购率、连带率、LTV"},
    {"node": "年终大促", "goal": "利润修复、库存优化、次年蓄水", "models": "RFM / 生命周期 / 库存模型", "audience": "沉睡用户、老客、价格敏感人群", "kpi": "库销比、退款率、沉睡召回率、次年留存"},
]

OPERATING_FOUNDATION = {
    "agent_operating_model": {
        "mode": "multi_agent_shared_state",
        "principles": ["统一经营目标", "Agent 独立提案", "Finance/规则仲裁", "动态资源配置", "结果反馈再决策"],
        "agents": ["Strategy", "Growth", "Product", "Content", "Live", "Customer", "Supply", "Fulfillment", "Finance"],
        "decision_loop": "目标契约 → 多 Agent 提案 → Finance/规则仲裁 → 动态预算/货品/流量配置 → 真实数据反馈 → 再评分再决策",
        "guardrails": ["无授权指标不得自动放量", "模拟数据不得覆盖真实数据", "库存、贡献毛利、现金流和合规拥有否决权"],
    },
    "target_tree": {
        "formula": "年度 GMV → 渠道 GMV → 活动 GMV → UV × 转化率 × 客单价",
        "north_star": "增量 GMV + 贡献毛利 + 用户资产 + 品牌资产",
        "kpis": [
            {"layer": "生意结果", "metrics": ["GMV", "净销售额", "贡献毛利", "库存周转", "退款率"], "decision": "判断是否真正赚钱"},
            {"layer": "增长效率", "metrics": ["CAC", "ROI", "MER", "LTV/CAC", "新客占比", "复购率"], "decision": "判断增长是否可持续"},
            {"layer": "品牌资产", "metrics": ["搜索增长", "品牌词占比", "内容互动", "会员净增长", "NPS/好评率"], "decision": "判断品牌是否积累长期价值"},
        ],
        "incremental_rule": "活动成交要区分新增需求、竞品转移、老客自然购买和提前透支。",
    },
    "profit_budget": {
        "allocation": [{"name": "可量化转化预算", "percent": "60–70%", "items": "搜索广告、信息流、直播投流、再营销、联盟分佣"}, {"name": "品牌内容预算", "percent": "20–30%", "items": "达人内容、品牌片、PR、官方 IP、用户共创"}, {"name": "试验预算", "percent": "10%", "items": "新平台、新达人、新创意、新人群、A/B 测试"}],
        "pnl_formula": "活动贡献毛利 = 实收销售额 - 货品成本 - 平台扣点 - 物流售后 - 优惠补贴 - 达人佣金 - 投放成本 - 活动执行成本",
        "guardrails": ["最低贡献毛利率", "最大可接受 CAC", "最低 ROI / MER 阈值"],
    },
    "battle_plan": {
        "dimensions": [
            {"dimension": "人", "deliverable": "新客、老客、会员、高价值、加购未购、浏览未购、沉睡、竞品人群的策略与权益"},
            {"dimension": "货", "deliverable": "引流款、爆款、利润款、形象款、复购款、清仓款、赠品、礼盒及库存量"},
            {"dimension": "场", "deliverable": "平台、直播、内容、私域和线下的角色分工与承接路径"},
            {"dimension": "内容", "deliverable": "阶段卖点、主题、素材形式、达人分层、直播脚本、商品页内容"},
            {"dimension": "价与服务", "deliverable": "日常价、会员价、活动价、最低成交价、客服排班、发货 SLA 和售后预案"},
        ],
        "product_roles": ["引流款：低成本访问与新客", "爆款：放大销量和平台权重", "利润款：保证贡献毛利", "形象款：维持调性与价格锚点", "复购款：提高 LTV", "清仓款：隔离主品牌价盘"],
    },
    "promotion_phases": [
        {"phase": "预热蓄水", "timing": "大促前21–45天", "actions": "种草、达人内容、预约、加购、会员招募、直播预告", "metrics": "人群资产成本、加购率、品牌搜索、会员新增"},
        {"phase": "爆发成交", "timing": "大促核心期", "actions": "货架承接、店播/达播、投放扩量、客服与库存保障", "metrics": "CVR、ROI、成交额、客单价、退款风险"},
        {"phase": "返场转化", "timing": "活动后7–14天", "actions": "加购未购召回、未支付召回、首购新客二次转化", "metrics": "召回率、二次购买率、首购后激活率"},
        {"phase": "留存复盘", "timing": "活动后30–90天", "actions": "会员分层、复购触达、口碑沉淀、渠道归因", "metrics": "留存率、复购率、LTV、增量 ROI"},
    ],
    "data_attribution": {
        "dashboards": ["渠道：曝光、点击、进店、加购、支付、退款、ROI、MER", "人群：新老客、会员、RFM、复购周期、LTV", "商品：SKU销量、毛利、转化率、连带率、退货率、缺货率", "内容：CTR、完播率、互动率、种草后搜索、引导成交", "节点：预算消耗、实时GMV、边际ROI、库存、履约、舆情"],
        "experiments": ["人群包", "利益点", "商品主图", "优惠方式", "直播脚本", "落地页"],
        "attribution_guardrail": "跨平台不得重复归因；自然成交不得全部算作投放功劳。",
    },
    "org_risk": {
        "raci": [{"role": "品牌", "owns": "定位、主题、内容标准、品牌一致性"}, {"role": "电商运营", "owns": "货盘、价格、平台报名、店铺承接"}, {"role": "增长投放", "owns": "预算、渠道、人群、实时调价、归因"}, {"role": "内容/KOL", "owns": "内容、达人、排期、授权、投后复用"}, {"role": "CRM/私域", "owns": "会员分层、触达、复购、召回"}, {"role": "供应链/客服", "owns": "库存、发货、售后、异常处理"}, {"role": "数据", "owns": "口径、预警、复盘、实验设计"}],
        "risks": ["价格体系冲突", "爆款缺货或赠品不足", "边际 ROI 下滑但预算失控", "达人内容与品牌调性冲突", "超卖、延迟发货、退款高", "跨平台重复归因", "广告法、功效、价格促销和隐私合规"],
    },
}

REPORT_OUTLINE = ["年度业务目标与北极星指标", "市场、行业、竞品与机会洞察", "品牌定位、核心人群与价值主张", "产品矩阵、价格体系与货品角色", "用户生命周期、RFM分层与会员体系", "全年营销日历与节点战役地图", "官方、平台、节日、618、双11、年终大促策略", "渠道与内容/达人/直播策略", "预算、活动损益表、ROI与LTV/CAC", "数据埋点、归因口径、看板与A/B测试", "组织协同、供应链履约、客服与风险预案", "节点复盘与次年增长飞轮规划"]


def build_template(payload: dict[str, Any]) -> dict[str, Any]:
    brand = str(payload.get("brand_name") or "未命名品牌").strip()
    category = str(payload.get("category") or "目标品类").strip()
    audience = str(payload.get("audience") or "核心目标人群").strip()
    objective = str(payload.get("objective") or "提升品牌认知并带动转化").strip()
    return {
        "version": "brand-case-v1",
        "source": "内置品牌营销全案模板",
        "generated": False,
        "brand_name": brand,
        "category": category,
        "audience": audience,
        "objective": objective,
        "executive_summary": f"{brand} 当前应围绕“{objective}”，以 {category} 场景为入口，先建立可识别的品牌差异，再用内容证据承接到交易与复购。",
        "funnel": {"stages": FUNNEL_STAGES, "bottleneck": "优先验证认知到兴趣的流失点，再决定是否加大投放。"},
        "aarrr": {"stages": AARRR_STAGES, "north_star": "有效用户完成首次关键体验，并在30天内产生复访、复购或推荐。"},
        "model_comparison": AIPL_FAST_COMPARISON,
        "annual_nodes": ANNUAL_NODES,
        "flywheel": {"steps": ["高价值内容 / 产品体验", "精准流量", "降低首购决策成本", "成交与会员沉淀", "个性化复购及服务", "晒单、评价、推荐、UGC", "更低成本的新客"], "activation_window": "首购后7–30天", "north_star": "让满意用户的贡献毛利、复购和推荐反哺下一轮获客效率。"},
        "budget_model": {"formula": "贡献毛利 ROI = (销售额 - 货品成本 - 平台佣金 - 物流 - 优惠补贴) / 营销费用", "default_allocation": [{"name": "人群蓄水与内容", "percent": 30}, {"name": "爆发期投放与直播", "percent": 40}, {"name": "会员复购与召回", "percent": 15}, {"name": "测试与归因", "percent": 10}, {"name": "风险预留", "percent": 5}], "guardrails": ["先看贡献毛利 ROI，再看GMV ROI", "不同人群不使用同一套优惠", "大促后追踪30/60/90天 LTV"]},
        "operating_foundation": OPERATING_FOUNDATION,
        "report_outline": REPORT_OUTLINE,
        "market_insights": [
            {"title": "需求从功能转向场景与情绪", "evidence": "同质化供给增加后，用户会用生活方式、身份认同和情绪价值筛选品牌。", "implication": "洞察不能只写人群画像，要落到具体时刻、任务和未被满足的感受。"},
            {"title": "内容与交易正在同一条链路里发生", "evidence": "种草、搜索、比较、咨询和购买之间的路径越来越短。", "implication": "每个内容主题都要配置承接页面、关键词、权益和复盘指标。"},
            {"title": "品牌信任来自可验证证据", "evidence": "工艺、测评、真实案例、服务承诺和用户反馈共同构成信任。", "implication": "用证据矩阵替代泛泛的品牌口号，明确每个卖点由什么材料证明。"},
        ],
        "trend_summary": [
            {"trend": "从大曝光转向高意图经营", "signal": "搜索、评论、私信和店铺行为成为更重要的经营信号", "move": "把预算和内容按意图分层，单独追踪高意图人群的转化。"},
            {"trend": "从单点爆款转向内容资产复用", "signal": "一个主题需要适配短视频、图文、直播和详情页", "move": "建立内容母题—证据—渠道—指标的复用表。"},
            {"trend": "AI 加速产出，人负责判断", "signal": "生成效率提升，但品牌一致性和事实核验更重要", "move": "让模型负责整理与生成，保留人工的策略取舍、事实审查和发布审批。"},
        ],
        "recommendations": [
            f"先围绕 {audience} 访谈或整理 10 条真实需求，形成可验证的场景优先级。",
            "选一个主张做 2 周小规模内容测试，分别承接认知、考虑和转化。",
            "为每个核心卖点建立‘主张—证据—内容—指标’四列表，避免只产出口号。",
        ],
    }


def _model_prompt(payload: dict[str, Any], template: dict[str, Any]) -> str:
    return f"""你是品牌营销全案策略总监。请基于输入和内置模板，输出一份可执行、可审阅的品牌营销分析。\n\n输入：{json.dumps(payload, ensure_ascii=False)}\n内置模板：{json.dumps(template, ensure_ascii=False)}\n\n要求：保留 funnel、aarrr、model_comparison、annual_nodes、flywheel、budget_model、operating_foundation、report_outline、market_insights、trend_summary、recommendations 字段；可以改写内容，但不要删除字段。只输出 JSON，不要 Markdown。所有判断必须区分事实、推断和待验证假设；没有外部数据时不要虚构具体市场规模或增长率。"""


def _call_text_model(prompt: str) -> dict[str, Any]:
    load_env_file()
    settings = read_settings()
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    api_base = _effective_api_base(str(settings.get("provider") or ""), str(settings.get("api_base") or ""))
    model = str(settings.get("text_model") or "").strip()
    if not api_key or not api_base or not model:
        raise RuntimeError("模型路由未配置：需要 api_key、api_base 和 text_model")
    body = json.dumps({"model": model, "messages": [{"role": "system", "content": "只输出合法 JSON。"}, {"role": "user", "content": prompt}], "temperature": 0.2, "max_tokens": 5000, "stream": False}).encode("utf-8")
    request = Request(f"{api_base.rstrip('/')}/chat/completions", data=body, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        content = content.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("模型返回的 JSON 不是对象")
        return parsed
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"文本模型生成失败：{exc}") from exc


def generate_strategy(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    template = build_template(payload)
    warnings: list[str] = []
    if not payload.get("use_model", True):
        return template, warnings
    try:
        output = _call_text_model(_model_prompt(payload, template))
        merged = {**template, **output, "generated": True, "source": "真实文本模型 + 内置品牌营销全案模板"}
        return merged, warnings
    except RuntimeError as exc:
        warnings.append(str(exc))
        return template, warnings


def new_trace_id() -> str:
    return uuid.uuid4().hex
