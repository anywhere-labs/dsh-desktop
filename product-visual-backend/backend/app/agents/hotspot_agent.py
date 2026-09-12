from backend.app.agents.base_agent import BaseAgent


class HotspotAgent(BaseAgent):
    name = "hotspot_agent"
    stage = "hotspot"

    def run_logic(self, payload: dict) -> dict:
        return {
            "hotspot_topics": ["开工季团建", "校园活动季", "企业年会服装"],
            "fit_score": 76,
            "recommended_adaptations": ["把热点改写为定制避坑角度", "不要硬蹭娱乐热点"],
            "do_not_use": ["与服装定制无关的泛娱乐热点", "无成交意图的纯热闹话题"],
            "next_week_plan": ["围绕团建服交期做3条", "围绕班服翻车做2条"],
        }

