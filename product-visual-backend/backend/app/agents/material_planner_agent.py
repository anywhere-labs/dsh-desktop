from backend.app.agents.base_agent import BaseAgent


class MaterialPlannerAgent(BaseAgent):
    name = "material_planner_agent"
    stage = "material_planning"

    def run_logic(self, payload: dict) -> dict:
        return {
            "must_shoot": ["老板正面口播", "两种面料对比", "印花/刺绣工艺", "客户案例成品"],
            "optional_shoot": ["工厂裁剪", "打包发货", "客户穿着反馈"],
            "b_roll": ["面料近景", "LOGO 工艺", "尺码表", "订单沟通截图"],
            "cover_materials": ["老板手持样衣", "价格差异大字标题"],
            "shooting_tips": ["前3秒语速快", "工艺镜头要近", "结尾 CTA 不拖"],
        }

