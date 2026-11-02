import os
import sys
import json
import argparse
from datetime import datetime
from dataclasses import asdict
from typing import Dict, Any, Optional

from src.models import normalize_symbol
from src.aggregator import aggregate_market_features
from src.prompt_builder import build_daily_prompt
from src.llm_client import ResilientGeminiClient
from src.state_machine import evaluate_daily_cycle, CycleResult
from src.storage import SQLiteLedger
from src.sync import sync_to_cloudflare

def load_default_fixtures() -> tuple[list, dict]:
    """加载收盘基准数据 (优先读取真实最新快照)"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(os.path.dirname(current_dir))
    fixtures_dir = os.path.join(os.path.dirname(current_dir), "tests", "fixtures")

    # 优先检查 backup 目录下的真实最新快照
    backup_snap_path = os.path.join(root_dir, "backup", "snapshot_latest.json")
    if os.path.exists(backup_snap_path):
        with open(backup_snap_path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
            snapshot = data.get("diff", data) if isinstance(data, dict) else data
    else:
        snapshot_path = os.path.join(fixtures_dir, "snapshot_mock.json")
        with open(snapshot_path, "r", encoding="utf-8-sig") as f:
            snapshot = json.load(f)

    foreign_path = os.path.join(fixtures_dir, "foreign_mock.json")
    with open(foreign_path, "r", encoding="utf-8-sig") as f:
        foreign = json.load(f)

    return snapshot, foreign

def run_pipeline(
    domestic_snapshot: list,
    foreign_archive: dict,
    mock_llm: Optional[Dict[str, Any]] = None,
    db_path: str = "ideas_ledger.sqlite",
    worker_url: Optional[str] = None,
    snap_token: Optional[str] = None
) -> Dict[str, Any]:
    """执行日度投研 Agent 全闭环流水线"""
    storage = SQLiteLedger(db_path)
    active_ideas = storage.load_active_ideas()

    # 1. 特征聚合
    features = aggregate_market_features(domestic_snapshot, foreign_archive)

    # 2. 组装提示词
    prompt = build_daily_prompt(features, active_ideas)

    # 3. 大模型口水分析 (支持 Mock)
    client = ResilientGeminiClient()
    llm_output = client.generate_daily_analysis(prompt, mock_response=mock_llm)

    # 4. 状态机与检查点流转
    cycle_result = evaluate_daily_cycle(
        active_ideas=active_ideas,
        latest_snapshot=features.all_contracts,
        llm_output=llm_output,
        storage=storage
    )

    # 5. 构建回传画板数据载荷
    now_dt = datetime.now()
    now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    date_str = now_dt.strftime("%Y-%m-%d")
    model_name = "mock-sandbox" if mock_llm is not None else "gemini-3.5-flash-lite"

    payload = {
        "date": date_str,
        "updated_at": now_str,
        "generated_at": now_str,
        "model_used": model_name,
        "macro_summary": cycle_result.macro_summary,
        "sector_weather": [
            {"sector": w.sector, "bias": w.bias, "narrative": w.narrative}
            for w in cycle_result.sector_weather
        ],
        "active_ideas": [
            {
                "id": i.id,
                "symbol": i.symbol,
                "direction": i.direction,
                "thesis": i.thesis,
                "open_price": i.open_price,
                "current_price": i.current_price,
                "day_count": i.day_count,
                "status": i.status,
                "pnl_pct": round(i.calculate_pnl(), 2),
                "checkpoints_passed": i.checkpoints_passed,
                "created_at": i.created_at
            }
            for i in cycle_result.active_ideas
        ],
        "checkpoints": cycle_result.checkpoint_events,
        "completed_summaries": [
            {
                "id": s.id,
                "symbol": s.symbol,
                "direction": s.direction,
                "thesis": s.thesis,
                "open_price": s.open_price,
                "close_price": s.close_price,
                "final_pnl": s.final_pnl,
                "day_count": s.day_count,
                "checkpoints_passed": s.checkpoints_passed,
                "final_verdict": s.final_verdict,
                "narrative": s.narrative,
                "divergence": s.divergence,
                "closed_at": s.closed_at
            }
            for s in cycle_result.completed_summaries
        ]
    }

    # 6. 回传至 Cloudflare Worker 画板
    if worker_url:
        sync_to_cloudflare(worker_url, payload, token=snap_token)

    return payload

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Futures Radar Agent Daily Runner")
    parser.add_argument("--mock", action="store_true", help="使用 Mock 模式，零 API 消耗")
    parser.add_argument("--sync", action="store_true", help="回传结果至 Cloudflare Worker")
    parser.add_argument("--worker-url", default=os.environ.get("CF_WORKER_URL"), help="Cloudflare Worker 地址")
    parser.add_argument("--token", default=os.environ.get("SNAPSHOT_TOKEN"), help="Worker 访问凭证")
    parser.add_argument("--db", default="ideas_ledger.sqlite", help="SQLite 账本存储路径")

    args = parser.parse_args()

    snapshot, foreign = load_default_fixtures()
    mock_llm = None
    if args.mock:
        mock_llm = {
            "sector_weather": [
                {"sector": "能化系", "bias": "BULLISH", "narrative": "原油走高提振成品裂解利润，下游低硫与聚酯偏强"},
                {"sector": "黑色系", "bias": "BEARISH", "narrative": "成材淡季累库现货贴水，高炉开工微降压制原料"},
                {"sector": "有色金属", "bias": "NEUTRAL", "narrative": "铜博士高位窄幅震荡，供需博弈胶着"},
                {"sector": "贵金属", "bias": "BULLISH", "narrative": "美联储预期扰动伴随地缘溢价，避险偏好坚挺"},
                {"sector": "农产品", "bias": "BEARISH", "narrative": "生猪出栏增多叠加油脂消费偏弱，盘面阴跌寻底"}
            ],
            "checkpoint_reviews": [],
            "new_ideas": [
                {"symbol": "FU2611", "direction": "LONG", "thesis": "外盘美原油强势拉涨，燃油裂解价差修复"}
            ]
        }

    target_worker = args.worker_url if args.sync else None
    try:
        result = run_pipeline(
            domestic_snapshot=snapshot,
            foreign_archive=foreign,
            mock_llm=mock_llm,
            db_path=args.db,
            worker_url=target_worker,
            snap_token=args.token
        )
    except Exception as e:
        print(f"\n❌ [FATAL] 投研 Agent 运行中断崩溃: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n========== 💡 期货雷达「口水投研」今日战报 ==========")
    print(f"更新时戳: {result['updated_at']}")
    print("\n【板块天气预报】")
    for w in result["sector_weather"]:
        emoji = "🔴" if w["bias"] == "BULLISH" else ("🟢" if w["bias"] == "BEARISH" else "⚪")
        print(f"  {emoji} {w['sector']} ({w['bias']}): {w['narrative']}")

    print(f"\n【存量跟踪假说】({len(result['active_ideas'])} 笔)")
    for idea in result["active_ideas"]:
        chg_sign = "+" if idea["pnl_pct"] >= 0 else ""
        print(f"  📌 {idea['symbol']} ({idea['direction']}) | 第 {idea['day_count']} 天 | 盈亏: {chg_sign}{idea['pnl_pct']}% | 假设: {idea['thesis']}")

    if result["completed_summaries"]:
        print(f"\n【最新计划小结】({len(result['completed_summaries'])} 笔)")
        for s in result["completed_summaries"]:
            chg_sign = "+" if s["final_pnl"] >= 0 else ""
            print(f"  🏆 #{s['symbol']} [{s['final_verdict']}] 历时 {s['day_count']} 天 ({chg_sign}{s['final_pnl']}%) - {s['narrative']}")
    print("===================================================\n")
