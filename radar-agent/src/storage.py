import os
import sqlite3
from typing import List, Dict, Any, Optional
from src.models import IdeaRecord, PlanSummary, SectorWeather

class SQLiteLedger:
    def __init__(self, db_path: str = "ideas_ledger.sqlite"):
        self.db_path = db_path
        db_dir = os.path.dirname(os.path.abspath(self.db_path))
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        conn = self._get_conn()
        try:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS active_ideas (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                direction TEXT NOT NULL,
                thesis TEXT NOT NULL,
                open_price REAL NOT NULL,
                current_price REAL NOT NULL,
                day_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                checkpoints_passed INTEGER DEFAULT 0,
                divergence INTEGER DEFAULT 0,
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS checkpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                idea_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                day_count INTEGER NOT NULL,
                pnl_pct REAL NOT NULL,
                verdict TEXT NOT NULL,
                comment TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plan_summaries (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                direction TEXT NOT NULL,
                thesis TEXT NOT NULL,
                open_price REAL NOT NULL,
                close_price REAL NOT NULL,
                final_pnl REAL NOT NULL,
                day_count INTEGER NOT NULL,
                checkpoints_passed INTEGER NOT NULL,
                final_verdict TEXT NOT NULL,
                narrative TEXT NOT NULL,
                divergence INTEGER DEFAULT 0,
                closed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sector_weather (
                date TEXT NOT NULL,
                sector TEXT NOT NULL,
                bias TEXT NOT NULL,
                narrative TEXT NOT NULL,
                PRIMARY KEY (date, sector)
            );

            CREATE TABLE IF NOT EXISTS daily_macro (
                date TEXT PRIMARY KEY,
                macro_summary TEXT NOT NULL,
                model_used TEXT NOT NULL,
                generated_at TEXT NOT NULL
            );
            """)
        finally:
            conn.close()

    def save_active_idea(self, idea: IdeaRecord):
        conn = self._get_conn()
        try:
            with conn:
                conn.execute("""
                INSERT INTO active_ideas (
                    id, symbol, direction, thesis, open_price, current_price,
                    day_count, status, created_at, updated_at, checkpoints_passed, divergence, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    current_price = excluded.current_price,
                    day_count = excluded.day_count,
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    checkpoints_passed = excluded.checkpoints_passed,
                    divergence = excluded.divergence,
                    notes = excluded.notes
                """, (
                    idea.id, idea.symbol, idea.direction, idea.thesis,
                    idea.open_price, idea.current_price, idea.day_count, idea.status,
                    idea.created_at, idea.updated_at, idea.checkpoints_passed,
                    1 if idea.divergence else 0, idea.notes
                ))
        finally:
            conn.close()

    def load_active_ideas(self) -> List[IdeaRecord]:
        conn = self._get_conn()
        try:
            rows = conn.execute("SELECT * FROM active_ideas WHERE status = 'TRACKING'").fetchall()
            return [
                IdeaRecord(
                    id=row["id"],
                    symbol=row["symbol"],
                    direction=row["direction"],
                    thesis=row["thesis"],
                    open_price=row["open_price"],
                    current_price=row["current_price"],
                    day_count=row["day_count"],
                    status=row["status"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    checkpoints_passed=row["checkpoints_passed"],
                    divergence=bool(row["divergence"]),
                    notes=row["notes"] or ""
                )
                for row in rows
            ]
        finally:
            conn.close()

    def remove_active_idea(self, idea_id: str):
        conn = self._get_conn()
        try:
            with conn:
                conn.execute("DELETE FROM active_ideas WHERE id = ?", (idea_id,))
        finally:
            conn.close()

    def record_checkpoint(self, data: Dict[str, Any]):
        conn = self._get_conn()
        try:
            with conn:
                conn.execute("""
                INSERT INTO checkpoints (idea_id, symbol, day_count, pnl_pct, verdict, comment, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    data["idea_id"], data["symbol"], data["day_count"],
                    data["pnl_pct"], data["verdict"], data["comment"], data["created_at"]
                ))
        finally:
            conn.close()

    def save_plan_summary(self, summary: PlanSummary):
        conn = self._get_conn()
        try:
            with conn:
                conn.execute("""
                INSERT INTO plan_summaries (
                    id, symbol, direction, thesis, open_price, close_price,
                    final_pnl, day_count, checkpoints_passed, final_verdict, narrative, divergence, closed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    final_pnl = excluded.final_pnl,
                    final_verdict = excluded.final_verdict,
                    narrative = excluded.narrative
                """, (
                    summary.id, summary.symbol, summary.direction, summary.thesis,
                    summary.open_price, summary.close_price, summary.final_pnl,
                    summary.day_count, summary.checkpoints_passed, summary.final_verdict,
                    summary.narrative, 1 if summary.divergence else 0, summary.closed_at
                ))
        finally:
            conn.close()

    def load_recent_summaries(self, limit: int = 20) -> List[PlanSummary]:
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT * FROM plan_summaries ORDER BY closed_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [
                PlanSummary(
                    id=row["id"],
                    symbol=row["symbol"],
                    direction=row["direction"],
                    thesis=row["thesis"],
                    open_price=row["open_price"],
                    close_price=row["close_price"],
                    final_pnl=row["final_pnl"],
                    day_count=row["day_count"],
                    checkpoints_passed=row["checkpoints_passed"],
                    final_verdict=row["final_verdict"],
                    narrative=row["narrative"],
                    divergence=bool(row["divergence"]),
                    closed_at=row["closed_at"]
                )
                for row in rows
            ]
        finally:
            conn.close()

    def save_sector_weather(self, date: str, sector: str, bias: str, narrative: str):
        conn = self._get_conn()
        try:
            with conn:
                conn.execute("""
                INSERT INTO sector_weather (date, sector, bias, narrative)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(date, sector) DO UPDATE SET
                    bias = excluded.bias,
                    narrative = excluded.narrative
                """, (date, sector, bias, narrative))
        finally:
            conn.close()

    def load_sector_weather(self, date: str) -> List[SectorWeather]:
        conn = self._get_conn()
        try:
            rows = conn.execute("SELECT * FROM sector_weather WHERE date = ?", (date,)).fetchall()
            return [
                SectorWeather(
                    sector=r["sector"],
                    bias=r["bias"],
                    narrative=r["narrative"]
                )
                for r in rows
            ]
        finally:
            conn.close()

    def save_daily_macro(self, date: str, macro_summary: str, model_used: str = "", generated_at: str = ""):
        conn = self._get_conn()
        try:
            with conn:
                conn.execute("""
                INSERT INTO daily_macro (date, macro_summary, model_used, generated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET
                    macro_summary = excluded.macro_summary,
                    model_used = excluded.model_used,
                    generated_at = excluded.generated_at
                """, (date, macro_summary, model_used, generated_at))
        finally:
            conn.close()

    def load_daily_macro(self, date: str) -> Optional[Dict[str, Any]]:
        conn = self._get_conn()
        try:
            row = conn.execute("SELECT * FROM daily_macro WHERE date = ?", (date,)).fetchone()
            if row:
                return {
                    "date": row["date"],
                    "macro_summary": row["macro_summary"],
                    "model_used": row["model_used"],
                    "generated_at": row["generated_at"]
                }
            return None
        finally:
            conn.close()
