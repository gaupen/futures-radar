import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional

from src.models import IdeaRecord, ContractItem, PlanSummary, SectorWeather, normalize_symbol
from src.storage import SQLiteLedger

@dataclass
class CycleResult:
    active_ideas: List[IdeaRecord] = field(default_factory=list)
    checkpoint_events: List[Dict[str, Any]] = field(default_factory=list)
    completed_summaries: List[PlanSummary] = field(default_factory=list)
    sector_weather: List[SectorWeather] = field(default_factory=list)

def evaluate_daily_cycle(
    active_ideas: List[IdeaRecord],
    latest_snapshot: Dict[str, ContractItem],
    llm_output: Dict[str, Any],
    storage: Optional[SQLiteLedger] = None
) -> CycleResult:
    """
    状态机主循环：
    1. 存量跟踪对拍与 7 天 Checkpoint 推进；
    2. 退出假说生成「计划小结」；
    3. 增量发现录入为新 Idea；
    4. 结果持久化并输出。
    """
    reviews_map = {r.get("id"): r for r in llm_output.get("checkpoint_reviews", []) if isinstance(r, dict)}
    today_str = datetime.now().strftime("%Y-%m-%d")

    updated_active: List[IdeaRecord] = []
    checkpoint_events: List[Dict[str, Any]] = []
    completed_summaries: List[PlanSummary] = []

    # 1. 处理存量标的
    for idea in active_ideas:
        # 刷新最新价
        if idea.symbol in latest_snapshot:
            idea.current_price = latest_snapshot[idea.symbol].price

        idea.day_count += 1
        idea.updated_at = today_str
        is_checkpoint = idea.is_checkpoint_day()

        review = reviews_map.get(idea.id)
        verdict = review.get("verdict", "CONTINUE").upper() if review else "CONTINUE"
        comment = review.get("comment", "持续跟踪观察") if review else "持续跟踪观察"

        # 若是 7 天检查点日，记录 Checkpoint 事件
        if is_checkpoint:
            cp_event = {
                "idea_id": idea.id,
                "symbol": idea.symbol,
                "day_count": idea.day_count,
                "pnl_pct": round(idea.calculate_pnl(), 2),
                "verdict": verdict,
                "comment": comment,
                "created_at": today_str
            }
            checkpoint_events.append(cp_event)
            if storage:
                storage.record_checkpoint(cp_event)

        # 判定是否结项退出
        if verdict in ("WON", "LOST", "INVALID"):
            idea.status = verdict
            pnl = idea.calculate_pnl()
            divergence = (verdict == "LOST" and pnl > 0) or (verdict == "WON" and pnl < 0)
            summary = PlanSummary.from_idea(idea, narrative=comment, divergence=divergence)
            completed_summaries.append(summary)

            if storage:
                storage.save_plan_summary(summary)
                storage.remove_active_idea(idea.id)
        else:
            idea.status = "TRACKING"
            if is_checkpoint:
                idea.checkpoints_passed += 1
            updated_active.append(idea)
            if storage:
                storage.save_active_idea(idea)

    # 2. 录入增量新假说 (New Ideas)
    for item in llm_output.get("new_ideas", []):
        if not isinstance(item, dict):
            continue
        raw_sym = item.get("symbol", "")
        sym = normalize_symbol(raw_sym)
        if not sym:
            continue

        # 检查是否已在跟踪中，避免重复开仓
        if any(existing.symbol == sym for existing in updated_active):
            continue

        open_price = latest_snapshot[sym].price if sym in latest_snapshot else 0.0
        if open_price <= 0:
            continue

        new_id = f"idea-{sym.lower()}-{int(time.time())}"
        new_idea = IdeaRecord(
            id=new_id,
            symbol=sym,
            direction=item.get("direction", "LONG").upper(),
            thesis=item.get("thesis", "盘面异动跟踪"),
            open_price=open_price,
            current_price=open_price,
            day_count=1,
            status="TRACKING",
            created_at=today_str,
            updated_at=today_str
        )
        updated_active.append(new_idea)
        if storage:
            storage.save_active_idea(new_idea)

    # 3. 解析板块天气
    sector_weather = [
        SectorWeather(
            sector=sw.get("sector", "综合"),
            bias=sw.get("bias", "NEUTRAL").upper(),
            narrative=sw.get("narrative", "")
        )
        for sw in llm_output.get("sector_weather", [])
        if isinstance(sw, dict)
    ]

    return CycleResult(
        active_ideas=updated_active,
        checkpoint_events=checkpoint_events,
        completed_summaries=completed_summaries,
        sector_weather=sector_weather
    )
