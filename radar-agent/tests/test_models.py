import unittest
from src.models import (
    ContractItem,
    ForeignAnchor,
    IdeaRecord,
    SectorWeather,
    PlanSummary,
    normalize_symbol,
)

class TestDomainModels(unittest.TestCase):
    def test_normalize_symbol(self):
        # 去除交易所前缀与 nf_ 前缀，统一大写
        self.assertEqual(normalize_symbol("113.rb2701"), "RB2701")
        self.assertEqual(normalize_symbol("115.MA605"), "MA2605")
        self.assertEqual(normalize_symbol("nf_TA2501"), "TA2501")
        self.assertEqual(normalize_symbol("rb2501"), "RB2501")
        self.assertEqual(normalize_symbol("SC2501"), "SC2501")

    def test_idea_record_checkpoint_logic(self):
        idea = IdeaRecord(
            id="idea-1",
            symbol="TA2501",
            direction="LONG",
            thesis="原油反弹带动基差收敛",
            open_price=5000.0,
            current_price=5200.0,
            day_count=7,
            status="TRACKING"
        )
        # 收益率计算：多头 (5200 - 5000) / 5000 = +4.0%
        self.assertAlmostEqual(idea.calculate_pnl(), 4.0, places=2)
        # 满 7 天触发检查点
        self.assertTrue(idea.is_checkpoint_day())

    def test_idea_record_short_pnl(self):
        idea = IdeaRecord(
            id="idea-2",
            symbol="RB2501",
            direction="SHORT",
            thesis="成材累库现货下行",
            open_price=3400.0,
            current_price=3230.0,
            day_count=3,
            status="TRACKING"
        )
        # 空头 (3400 - 3230) / 3400 = +5.0%
        self.assertAlmostEqual(idea.calculate_pnl(), 5.0, places=2)
        self.assertFalse(idea.is_checkpoint_day())

    def test_plan_summary_creation(self):
        idea = IdeaRecord(
            id="idea-3",
            symbol="RB2501",
            direction="LONG",
            thesis="博弈7天反转",
            open_price=3300.0,
            current_price=3465.0,
            day_count=7,
            status="WON"
        )
        summary = PlanSummary.from_idea(
            idea=idea,
            narrative="7天内现货企稳，盘面长阳反弹，假说完全兑现",
            divergence=False
        )
        self.assertEqual(summary.symbol, "RB2501")
        self.assertAlmostEqual(summary.final_pnl, 5.0, places=2)
        self.assertEqual(summary.checkpoints_passed, 1)

if __name__ == "__main__":
    unittest.main()
