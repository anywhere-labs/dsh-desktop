from backend.app.agents.base_agent import BaseAgent


class ScriptDirectorAgent(BaseAgent):
    name = "script_director_agent"
    stage = "script_director"

    def run_logic(self, payload: dict) -> dict:
        title = payload.get("title") or "30秒讲清楚球衣定制为什么价格差一倍"
        return {
            "title": title,
            "hook_3s": "同样是球衣定制，为什么有的几十块，有的一百多？",
            "target_audience": "球队队长 / 活动负责人",
            "core_pain_point": "不知道价格差在哪里，怕花钱踩坑",
            "duration": "30s",
            "shots": [
                {"shot_no": 1, "duration": "0-3s", "visual": "老板正面近景", "voiceover": "同样是球衣定制，为什么价格能差一倍？", "subtitle": "价格差一倍，差在哪？", "camera": "直视镜头", "material_needed": "老板出镜"},
                {"shot_no": 2, "duration": "3-10s", "visual": "两种面料近景对比", "voiceover": "第一看面料克重和透气性。", "subtitle": "先看面料", "camera": "手持近景", "material_needed": "两款面料"},
                {"shot_no": 3, "duration": "10-18s", "visual": "印花/刺绣工艺", "voiceover": "第二看 LOGO 工艺，印花和刺绣成本不同。", "subtitle": "再看工艺", "camera": "特写", "material_needed": "工艺样衣"},
                {"shot_no": 4, "duration": "18-25s", "visual": "客户案例成品", "voiceover": "第三看交付经验，批量尺码和交期最容易出问题。", "subtitle": "最后看交付", "camera": "横移展示", "material_needed": "案例成品"},
                {"shot_no": 5, "duration": "25-30s", "visual": "老板结尾", "voiceover": "想知道你这批多少钱，评论区打球衣。", "subtitle": "评论：球衣", "camera": "正面", "material_needed": "老板出镜"},
            ],
            "cta": "评论区留言“球衣”，给你一份报价参考。",
            "cover_text": "球衣定制为什么差一倍？",
            "hashtags": ["服装定制", "球衣定制", "团建服", "老板口播"],
        }

