from backend.app.agents.base_agent import BaseAgent


class DataReviewAgent(BaseAgent):
    name = "data_review_agent"
    stage = "data_review"

    def run_logic(self, payload: dict) -> dict:
        metrics = payload.get("metrics", {})
        views = metrics.get("views", 0)
        level = "high" if views >= 10000 else ("medium" if views >= 1000 else "low")
        return {
            "summary": f"本次 {payload.get('day_type', '7d')} 数据表现为 {level}。",
            "performance_level": level,
            "key_changes": ["完播和互动需要结合账号均值判断"],
            "comment_insights": ["评论问题可沉淀为下一轮选题"],
            "conversion_insights": ["咨询量和私信点击决定成交型内容价值"],
            "next_round_suggestions": ["强化3秒钩子", "补充客户案例", "结尾用明确关键词 CTA"],
        }

