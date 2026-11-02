import json
import unittest
from pathlib import Path
from src.aggregator import (
    aggregate_market_features,
    filter_top_movers,
    classify_sector,
    extract_variety_code,
)
from src.models import ContractItem

class TestAggregator(unittest.TestCase):
    def setUp(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        with open(fixture_dir / "snapshot_mock.json", "r", encoding="utf-8") as f:
            self.raw_snapshot = json.load(f)
        with open(fixture_dir / "foreign_mock.json", "r", encoding="utf-8") as f:
            self.foreign_archive = json.load(f)

    def test_extract_variety_code(self):
        self.assertEqual(extract_variety_code("RB2701"), "RB")
        self.assertEqual(extract_variety_code("TA2501"), "TA")
        self.assertEqual(extract_variety_code("MA2605"), "MA")
        self.assertEqual(extract_variety_code("AP701"), "AP")
        self.assertEqual(extract_variety_code("LC2701"), "LC")

    def test_classify_sector(self):
        self.assertEqual(classify_sector("RB2701"), "黑色系")
        self.assertEqual(classify_sector("JM2708"), "黑色系")
        self.assertEqual(classify_sector("FU2611"), "能化系")
        self.assertEqual(classify_sector("MA2605"), "能化系")
        self.assertEqual(classify_sector("CU2612"), "有色金属")
        self.assertEqual(classify_sector("LC2701"), "有色金属")
        self.assertEqual(classify_sector("AG2702"), "贵金属")
        self.assertEqual(classify_sector("AU2612"), "贵金属")
        self.assertEqual(classify_sector("AP701"), "瓜果农副")
        self.assertEqual(classify_sector("A2701"), "农产品")

    def test_filter_top_movers_dedup(self):
        items = [ContractItem.from_dict(d) for d in self.raw_snapshot]
        movers = filter_top_movers(items, min_pct=1.5, max_count=15)

        # 检查品种去重：fu2611 (4.67%) 和 fu2612 (3.23%)，应该只保留 fu2611
        varieties = [extract_variety_code(m.symbol) for m in movers]
        self.assertEqual(len(varieties), len(set(varieties)), "同一品种必须去重保留最剧烈者")
        self.assertIn("FU", varieties)
        self.assertIn("JM", varieties)

        # 检查跌幅前列也被正确收录 (如 AP701, LC2701)
        self.assertIn("AP", varieties)
        self.assertIn("LC", varieties)

    def test_aggregate_market_features(self):
        features = aggregate_market_features(self.raw_snapshot, self.foreign_archive)
        
        # 1. 外盘锚点提取
        self.assertIn("CL", features.foreign_anchors)
        cl = features.foreign_anchors["CL"]
        # pre_settle 70.0, price 71.4 -> +2.0%
        self.assertAlmostEqual(cl.change_percent, 2.0, places=1)

        self.assertIn("GC", features.foreign_anchors)
        gc = features.foreign_anchors["GC"]
        # 2700.0 -> 2727.0 -> +1.0%
        self.assertAlmostEqual(gc.change_percent, 1.0, places=1)

        # 2. 板块分布分组
        self.assertTrue(len(features.sector_distribution["黑色系"]) > 0)
        self.assertTrue(len(features.sector_distribution["能化系"]) > 0)
        self.assertTrue(len(features.sector_distribution["贵金属"]) > 0)

if __name__ == "__main__":
    unittest.main()
