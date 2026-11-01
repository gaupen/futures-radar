import unittest
import tempfile
import os
from src.models import IdeaRecord, ContractItem, PlanSummary
from src.storage import SQLiteLedger
from src.state_machine import evaluate_daily_cycle

class TestStateMachine(unittest.TestCase):
    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite")
        self.temp_db.close()
        self.ledger = SQLiteLedger(self.temp_db.name)

    def tearDown(self):
        if os.path.exists(self.temp_db.name):
            os.remove(self.temp_db.name)

    def test_checkpoint_continue_cycle(self):
        # 初始一个已有 6 天跟踪记录的标的
        idea = IdeaRecord(
            id="idea-ta",
            symbol="TA2501",
            direction="LONG",
            thesis="基差修复",
            open_price=5000.0,
            current_price=5100.0,
            day_count=6,
            status="TRACKING"
        )
        self.ledger.save_active_idea(idea)

        latest_snapshot = {
            "TA2501": ContractItem(
                symbol="TA2501", market=115, name="PTA2501",
                price=5200.0, change_percent=2.0, change=100.0, volume=50000
            )
        }
        llm_output = {
            "sector_weather": [{"sector": "能化系", "bias": "BULLISH", "narrative": "原油走强支撑"}],
            "checkpoint_reviews": [
                {"id": "idea-ta", "verdict": "CONTINUE", "comment": "7天筑底已熬过，进入下一个7天"}
            ],
            "new_ideas": []
        }

        result = evaluate_daily_cycle(
            active_ideas=[idea],
            latest_snapshot=latest_snapshot,
            llm_output=llm_output,
            storage=self.ledger
        )

        # 验证天数递增为 7，且触发了检查点
        self.assertEqual(len(result.active_ideas), 1)
        updated_idea = result.active_ideas[0]
        self.assertEqual(updated_idea.day_count, 7)
        self.assertEqual(updated_idea.current_price, 5200.0)
        self.assertEqual(updated_idea.status, "TRACKING")
        self.assertEqual(updated_idea.checkpoints_passed, 1)

        # 检查生成了 checkpoint 事件
        self.assertEqual(len(result.checkpoint_events), 1)
        self.assertEqual(result.checkpoint_events[0]["verdict"], "CONTINUE")

    def test_checkpoint_exit_and_plan_summary(self):
        idea = IdeaRecord(
            id="idea-rb",
            symbol="RB2501",
            direction="LONG",
            thesis="博弈反转",
            open_price=3300.0,
            current_price=3400.0,
            day_count=6,
            status="TRACKING"
        )
        self.ledger.save_active_idea(idea)

        latest_snapshot = {
            "RB2501": ContractItem(
                symbol="RB2501", market=113, name="螺纹2501",
                price=3465.0, change_percent=1.9, change=65.0, volume=80000
            )
        }
        llm_output = {
            "sector_weather": [],
            "checkpoint_reviews": [
                {"id": "idea-rb", "verdict": "WON", "comment": "7天长阳反弹，利润兑现结项"}
            ],
            "new_ideas": []
        }

        result = evaluate_daily_cycle(
            active_ideas=[idea],
            latest_snapshot=latest_snapshot,
            llm_output=llm_output,
            storage=self.ledger
        )

        # 验证结项后从 active_ideas 中移除，进入 completed_summaries
        self.assertEqual(len(result.active_ideas), 0)
        self.assertEqual(len(result.completed_summaries), 1)

        summary = result.completed_summaries[0]
        self.assertEqual(summary.symbol, "RB2501")
        self.assertEqual(summary.final_verdict, "WON")
        self.assertAlmostEqual(summary.final_pnl, 5.0, places=2)
        self.assertIn("利润兑现", summary.narrative)

    def test_new_idea_ingestion(self):
        latest_snapshot = {
            "FU2611": ContractItem(
                symbol="FU2611", market=113, name="燃油2611",
                price=6010.0, change_percent=4.67, change=268.0, volume=47365
            )
        }
        llm_output = {
            "sector_weather": [],
            "checkpoint_reviews": [],
            "new_ideas": [
                {"symbol": "FU2611", "direction": "LONG", "thesis": "裂解利润修复"}
            ]
        }

        result = evaluate_daily_cycle(
            active_ideas=[],
            latest_snapshot=latest_snapshot,
            llm_output=llm_output,
            storage=self.ledger
        )

        self.assertEqual(len(result.active_ideas), 1)
        new_idea = result.active_ideas[0]
        self.assertEqual(new_idea.symbol, "FU2611")
        self.assertEqual(new_idea.open_price, 6010.0)
        self.assertEqual(new_idea.day_count, 1)
        self.assertEqual(new_idea.status, "TRACKING")

if __name__ == "__main__":
    unittest.main()
