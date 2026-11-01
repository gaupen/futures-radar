import re
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from src.models import ContractItem, ForeignAnchor, normalize_symbol

SECTOR_MAP = {
    "黑色系": {"RB", "HC", "I", "JM", "J", "SM", "SF", "WR"},
    "能化系": {
        "FU", "LU", "SC", "BU", "TA", "MA", "PP", "L", "V", "EG", "EB",
        "PG", "BR", "RU", "NR", "PF", "PL", "BZ", "SA", "UR", "SH", "PX"
    },
    "有色金属": {"CU", "AL", "ZN", "PB", "NI", "SN", "SS", "AO", "BC", "LC", "SI", "PS"},
    "贵金属": {"AU", "AG", "PT", "PD"},
    "农产品": {
        "A", "B", "M", "Y", "P", "C", "CS", "OI", "RM", "SR", "CF", "CY",
        "AP", "CJ", "PK", "LH", "JD", "RR"
    }
}

FOREIGN_NAME_MAP = {
    "CL": "美原油WTI",
    "OIL": "布伦特原油",
    "GC": "COMEX黄金",
    "SI": "COMEX白银",
    "HG": "COMEX美铜",
    "S": "CBOT美大豆",
    "C": "CBOT美玉米"
}

def extract_variety_code(symbol: str) -> str:
    """提取品种代码前缀，如 RB2701 -> RB, MA2605 -> MA"""
    norm = normalize_symbol(symbol)
    m = re.match(r"^([A-Z]+)", norm)
    return m.group(1) if m else norm

def classify_sector(symbol: str) -> str:
    """根据品种归入 5 大板块"""
    var = extract_variety_code(symbol)
    for sector, varieties in SECTOR_MAP.items():
        if var in varieties:
            return sector
    return "综合"

def filter_top_movers(
    items: List[ContractItem],
    min_pct: float = 1.5,
    max_count: int = 15
) -> List[ContractItem]:
    """
    找出全市场异动合约：
    1. |涨跌幅| >= min_pct
    2. 按 |涨跌幅| 降序排列
    3. 同品种去重，仅保留异动幅度最大者
    4. 取前 max_count 个标的
    """
    # 过滤出波动率达到阈值的合约
    candidates = [c for c in items if abs(c.change_percent) >= min_pct]
    # 按波幅降序排列
    candidates.sort(key=lambda c: abs(c.change_percent), reverse=True)

    seen_varieties = set()
    deduped = []
    for c in candidates:
        var = extract_variety_code(c.symbol)
        if var not in seen_varieties:
            seen_varieties.add(var)
            deduped.append(c)
        if len(deduped) >= max_count:
            break

    return deduped

def parse_foreign_anchors(archive: dict) -> Dict[str, ForeignAnchor]:
    """
    解析外盘归档中的核心锚点品种：
    计算最新收盘价与涨跌幅
    """
    anchors = {}
    if not archive or not isinstance(archive, dict):
        return anchors

    pre_settles = archive.get("preSettlements", {})
    contracts = archive.get("contracts", {})

    for sym, bars in contracts.items():
        if not bars or not isinstance(bars, list):
            continue
        last_bar = bars[-1]
        if len(last_bar) < 2:
            continue

        latest_price = float(last_bar[1])
        pre_settle = float(pre_settles.get(sym) or 0.0)

        change_pct = 0.0
        if pre_settle > 0:
            change_pct = ((latest_price - pre_settle) / pre_settle) * 100.0

        anchors[sym] = ForeignAnchor(
            symbol=sym,
            name=FOREIGN_NAME_MAP.get(sym, sym),
            price=latest_price,
            change_percent=round(change_pct, 2),
            pre_settle=pre_settle
        )

    return anchors

@dataclass
class AggregatedMarketFeatures:
    top_movers: List[ContractItem]
    foreign_anchors: Dict[str, ForeignAnchor]
    sector_distribution: Dict[str, List[ContractItem]] = field(default_factory=dict)
    all_contracts: Dict[str, ContractItem] = field(default_factory=dict)

def aggregate_market_features(
    domestic_snapshot: list,
    foreign_archive: dict
) -> AggregatedMarketFeatures:
    """整合内盘快照与外盘归档，输出结构化投研特征"""
    items = []
    all_dict = {}

    for row in (domestic_snapshot or []):
        if not isinstance(row, dict):
            continue
        c = ContractItem.from_dict(row)
        if c.symbol and c.price > 0:
            items.append(c)
            all_dict[c.symbol] = c

    top_movers = filter_top_movers(items, min_pct=1.5, max_count=15)
    foreign_anchors = parse_foreign_anchors(foreign_archive)

    # 5 大板块结构化分组
    sector_dist: Dict[str, List[ContractItem]] = {
        "黑色系": [],
        "能化系": [],
        "有色金属": [],
        "贵金属": [],
        "农产品": [],
        "综合": []
    }
    for item in items:
        sec = classify_sector(item.symbol)
        if sec in sector_dist:
            sector_dist[sec].append(item)

    return AggregatedMarketFeatures(
        top_movers=top_movers,
        foreign_anchors=foreign_anchors,
        sector_distribution=sector_dist,
        all_contracts=all_dict
    )
