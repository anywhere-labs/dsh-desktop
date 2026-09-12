from backend.app.agents.base_agent import BaseAgent


class AttributionAgent(BaseAgent):
    name = "attribution_agent"
    stage = "attribution"

    def run_logic(self, payload: dict) -> dict:
        return {
            "overall_change": "播放提升需要结合 7天/14天数据确认",
            "attribution": {
                "topic": "中",
                "hook_3s": "高",
                "script_structure": "中",
                "material_quality": "中",
                "editing_rhythm": "低",
                "publish_time": "不确定",
                "hotspot": "弱",
                "paid_traffic": "未标记",
                "platform_fluctuation": "存在干扰",
            },
            "causal_boundary": [
                "本次只能判断相关性，不能证明绝对因果",
                "没有A/B测试时，选题贡献只能弱归因",
                "如果存在投流或直播引流，必须单独标记",
            ],
            "next_actions": ["对同账号同类型内容做对比", "记录投流/直播/私域转发变量", "下一条优先优化3秒钩子"],
        }

