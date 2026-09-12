from backend.app.agents.base_agent import BaseAgent


class CompetitorAnalysisAgent(BaseAgent):
    name = "competitor_analysis_agent"
    stage = "benchmark_analysis"

    def run_logic(self, payload: dict) -> dict:
        return {
            "viral_patterns": ["价格差异解释", "翻车避坑", "工厂过程透明化"],
            "hook_templates": ["同样是定制，为什么价格差一倍？", "班服定制最容易翻车的地方不是面料，而是这个。"],
            "shot_patterns": ["老板正面口播", "面料近景对比", "客户案例成品展示", "评论区问题截图"],
            "comment_questions": ["多久能发货？", "几十件能不能做？", "LOGO 会不会掉色？"],
            "replicable_templates": ["痛点钩子 -> 工艺证明 -> 案例结果 -> 评论区关键词 CTA"],
        }

