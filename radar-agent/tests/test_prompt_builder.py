import unittest
from src.models import IdeaRecord, ContractItem, ForeignAnchor
from src.aggregator import AggregatedMarketFeatures
from src.prompt_builder import build_daily_prompt

class TestPromptBuilder(unittest.TestCase):
    def test_build_daily_prompt_structure(self):
        anchors = {
            "CL": ForeignAnchor("CL", "美原油WTI", 71.4, 2.0, 70.0),
            "GC": ForeignAnchor("GC", "COMEX黄金", 2727.0, 1.0, 2700.0)
        }
        movers = [
            ContractItem(symbol="FU2611", market=113, name="燃油2611", price=6010.0, change_percent=4.67, change=268.0, volume=47365),
            ContractItem(symbol="AP701", market=115, name="苹果701", price=5704.0, change_percent=-4.34, change=-259.0, volume=455417)
        ]
        features = AggregatedMarketFeatures(
            top_movers=movers,
            foreign_anchors=anchors
        )
        active_ideas = [
            IdeaRecord(
                id="idea-1",
                symbol="TA2501",
                direction="LONG",
                thesis="原油反弹带动基差收敛",
                open_price=5000.0,
                current_price=5200.0,
                day_count=7,
                status="TRACKING"
            )
        ]

        prompt = build_daily_prompt(features, active_ideas)

        # 验证提示词要素覆盖
        self.assertIn("美原油WTI", prompt)
        self.assertIn("+2.0%", prompt)
        self.assertIn("FU2611", prompt)
        self.assertIn("AP701", prompt)
        # 验证包含第 7 天 Checkpoint 提示
        self.assertIn("第 7 天 (触发检查点)", prompt)
        self.assertIn("TA2501", prompt)
        # 验证包含 JSON 输出指引
        self.assertIn("sector_weather", prompt)
        self.assertIn("checkpoint_reviews", prompt)
        self.assertIn("new_ideas", prompt)

        # 验证 Token 预算控制 (中文字符数应在 1500 字以内，折合约 400-600 tokens)
        self.assertLess(len(prompt), 2500, "Prompt 长度必须严格受控，防止溢出")

if __name__ == "__main__":
    unittest.main()
