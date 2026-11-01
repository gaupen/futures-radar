import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any

def normalize_symbol(code: str) -> str:
    """
    统一将各种格式的期货代码归一化为大写规范代码。
    例如：
    - 113.rb2701 -> RB2701
    - 115.MA605 -> MA2605
    - nf_TA2501 -> TA2501
    - rb2501 -> RB2501
    """
    c = str(code or "").strip()
    if not c:
        return ""

    # 去掉市场前缀 (如 113.rb2501 -> rb2501)
    if "." in c:
        c = c.split(".", 1)[1]

    # 去掉新浪前缀 (如 nf_TA2501 -> TA2501)
    if c.lower().startswith("nf_"):
        c = c[3:]

    c = c.upper()

    # 处理郑商所单数年份代码 (如 MA605 -> MA2605, SR509 -> SR2509)
    m = re.match(r"^([A-Z]+)(\d)(\d{2})$", c)
    if m:
        c = f"{m.group(1)}2{m.group(2)}{m.group(3)}"

    return c

@dataclass
class ContractItem:
    symbol: str
    market: int
    name: str
    price: float
    change_percent: float
    change: float
    volume: int
    prev_settle: float = 0.0
    open_price: float = 0.0
    high: float = 0.0
    low: float = 0.0
    timestamp: int = 0

    @classmethod
    def from_dict(cls, d: dict) -> "ContractItem":
        raw_code = d.get("f12") or d.get("symbol") or ""
        return cls(
            symbol=normalize_symbol(raw_code),
            market=int(d.get("f13") or 0),
            name=str(d.get("f14") or d.get("name") or ""),
            price=float(d.get("f2") or 0.0),
            change_percent=float(d.get("f3") or 0.0),
            change=float(d.get("f4") or 0.0),
            volume=int(d.get("f5") or 0),
            prev_settle=float(d.get("f18") or 0.0),
            open_price=float(d.get("f17") or 0.0),
            high=float(d.get("f15") or 0.0),
            low=float(d.get("f16") or 0.0),
            timestamp=int(d.get("f124") or 0),
        )

@dataclass
class ForeignAnchor:
    symbol: str
    name: str
    price: float
    change_percent: float
    pre_settle: float = 0.0

@dataclass
class SectorWeather:
    sector: str  # 黑色系、能化系、有色金属、农产品、贵金属
    bias: str    # BULLISH(偏多) / BEARISH(偏空) / NEUTRAL(震荡)
    narrative: str  # 简明口水复盘（30-60字）

@dataclass
class IdeaRecord:
    id: str
    symbol: str
    direction: str  # LONG / SHORT
    thesis: str     # 核心交易假说（口水话）
    open_price: float
    current_price: float
    day_count: int
    status: str     # TRACKING / WON / LOST / INVALID
    created_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    updated_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    checkpoints_passed: int = 0
    divergence: bool = False
    notes: str = ""

    def calculate_pnl(self) -> float:
        """根据当前价格计算收益率百分比 (带正负号)"""
        if self.open_price <= 0:
            return 0.0
        if self.direction.upper() == "LONG":
            return ((self.current_price - self.open_price) / self.open_price) * 100.0
        else:
            return ((self.open_price - self.current_price) / self.open_price) * 100.0

    def is_checkpoint_day(self) -> bool:
        """每 7 天为一个阶段性检查点"""
        return self.day_count > 0 and (self.day_count % 7 == 0)

@dataclass
class PlanSummary:
    id: str
    symbol: str
    direction: str
    thesis: str
    open_price: float
    close_price: float
    final_pnl: float
    day_count: int
    checkpoints_passed: int
    final_verdict: str  # WON / LOST / INVALID
    narrative: str      # 最终总结口水复盘
    divergence: bool    # 是否存在盘面与模型对拍背离
    closed_at: str

    @classmethod
    def from_idea(cls, idea: IdeaRecord, narrative: str, divergence: bool = False) -> "PlanSummary":
        return cls(
            id=idea.id,
            symbol=idea.symbol,
            direction=idea.direction,
            thesis=idea.thesis,
            open_price=idea.open_price,
            close_price=idea.current_price,
            final_pnl=idea.calculate_pnl(),
            day_count=idea.day_count,
            checkpoints_passed=idea.day_count // 7,
            final_verdict=idea.status,
            narrative=narrative,
            divergence=divergence,
            closed_at=datetime.now().strftime("%Y-%m-%d")
        )
