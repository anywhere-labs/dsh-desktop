from backend.app.agents.base_agent import BaseAgent


class AccountDiagnosisAgent(BaseAgent):
    name = "account_diagnosis_agent"
    stage = "account_diagnosis"

    def run_logic(self, payload: dict) -> dict:
        return {
            "positioning": "真人出镜口播 + 服装定制成交型账号",
            "target_audience": ["企业采购", "班级团体", "球队队长", "活动负责人"],
            "content_pillars": ["客户案例", "工厂过程", "痛点解决", "老板口播", "爆款模板"],
            "weak_content_types": ["纯产品展示", "无钩子流水账", "缺少成交场景的视频"],
            "persona_suggestion": "老板/工厂负责人真人出镜，强调靠谱、交付、工艺和案例。",
            "growth_opportunities": ["用真实订单案例做信任", "用价格差异解释承接咨询", "用评论问题反推选题"],
            "content_fit_score": 82,
            "next_actions": ["生成本周选题", "沉淀评论问题库", "准备面料和工艺 B-roll"],
        }

