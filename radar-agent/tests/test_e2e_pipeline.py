import unittest
import tempfile
import os
from src.runner import run_pipeline, load_default_fixtures

class TestE2EPipeline(unittest.TestCase):
    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite")
        self.temp_db.close()

    def tearDown(self):
        if os.path.exists(self.temp_db.name):
            os.remove(self.temp_db.name)

    def test_e2e_mock_pipeline_run(self):
        snapshot, foreign = load_default_fixtures()
        mock_llm = {
            "sector_weather": [
                {"sector": "能化系", "bias": "BULLISH", "narrative": "原油走强直接推高裂解成本"},
                {"sector": "黑色系", "bias": "BEARISH", "narrative": "成材淡季累库现货贴水加剧"}
            ],
            "checkpoint_reviews": [],
            "new_ideas": [
                {"symbol": "FU2611", "direction": "LONG", "thesis": "裂解利润修复预期"}
            ]
        }

        # 运行第一天日度闭环
        payload_day1 = run_pipeline(
            domestic_snapshot=snapshot,
            foreign_archive=foreign,
            mock_llm=mock_llm,
            db_path=self.temp_db.name,
            worker_url=None
        )

        self.assertIn("updated_at", payload_day1)
        self.assertEqual(len(payload_day1["sector_weather"]), 2)
        self.assertEqual(len(payload_day1["active_ideas"]), 1)
        self.assertEqual(payload_day1["active_ideas"][0]["symbol"], "FU2611")
        self.assertEqual(payload_day1["active_ideas"][0]["day_count"], 1)

        # 运行第二天：价格变动，假说天数推进到第 2 天
        # 更新 FU2611 价格为 6150 (开仓 6010, 盈利)
        snapshot_day2 = [
            {"f2": 6150, "f3": 2.33, "f4": 140, "f5": 50000, "f12": "fu2611", "f13": 113, "f14": "燃油2611", "f18": 6010}
        ]
        mock_llm_day2 = {
            "sector_weather": [{"sector": "能化系", "bias": "BULLISH", "narrative": "原油高位整理"}],
            "checkpoint_reviews": [
                {"id": payload_day1["active_ideas"][0]["id"], "verdict": "CONTINUE", "comment": "利润垫已拉开，继续跟踪"}
            ],
            "new_ideas": []
        }

        payload_day2 = run_pipeline(
            domestic_snapshot=snapshot_day2,
            foreign_archive=foreign,
            mock_llm=mock_llm_day2,
            db_path=self.temp_db.name,
            worker_url=None
        )

        self.assertEqual(len(payload_day2["active_ideas"]), 1)
        idea_day2 = payload_day2["active_ideas"][0]
        self.assertEqual(idea_day2["day_count"], 2)
        self.assertEqual(idea_day2["current_price"], 6150.0)
        self.assertGreater(idea_day2["pnl_pct"], 2.0)

if __name__ == "__main__":
    unittest.main()
