from backend.app.agents.base_agent import BaseAgent


DEMO_TOPICS = [
    "30秒讲清楚球衣定制为什么价格差一倍",
    "企业团建服怎么定制才不踩坑",
    "班服定制最容易翻车的3个地方",
    "LOGO 印上衣服为什么会色差",
    "一件定制服从打样到发货要经过几步",
    "为什么同样数量有的厂家报价更低",
    "球队队长定制球衣先确认这3件事",
    "定制服尺码怎么统计才不乱",
    "刺绣和印花到底怎么选",
    "活动服交期紧怎么办",
]


class TopicPlannerAgent(BaseAgent):
    name = "topic_planner_agent"
    stage = "topic_planning"

    def run_logic(self, payload: dict) -> dict:
        return {
            "week_topics": [
                {
                    "title": title,
                    "target_audience": "球队队长 / 活动负责人 / 企业采购",
                    "pain_point": "不知道定制价格、工艺、交期和风险如何判断",
                    "sales_intent": "引导咨询报价",
                    "shooting_difficulty": "低",
                    "viral_score": 82 - (idx % 4),
                    "recommended_publish_time": "20:00-22:00",
                    "content_type": "痛点解决型",
                }
                for idx, title in enumerate(DEMO_TOPICS)
            ]
        }

