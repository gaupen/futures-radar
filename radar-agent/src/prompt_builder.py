from typing import List, Optional
from src.models import IdeaRecord
from src.aggregator import AggregatedMarketFeatures

DAILY_PROMPT_TEMPLATE = """你是一名经验极其老练的国内商品期货资深研究员兼实盘交易员。
现在是下午收盘时分，请结合今日外部宏观锚点走势与内盘主力异动合约，进行接地气、直击矛盾核心的「口水复盘」，并对存量跟踪假说进行对拍审视。

【今日外盘宏观锚点】
{foreign_anchors_text}

【今日内盘异动前沿 (品种已去重)】
{top_movers_text}

【存量假说跟踪与 7 天检查点 (Checkpoints)】
{active_ideas_text}

请严格按以下要求输出且仅输出一个纯 JSON 对象（不要输出任何前后客套话）：
1. `sector_weather`: 对黑色系、能化系、有色金属、贵金属、农产品 5 大板块给出口水天气预报。
   - `bias`: "BULLISH"(偏多) / "BEARISH"(偏空) / "NEUTRAL"(震荡观望)
   - `narrative`: 30-50 字口水点评（点明核心矛盾：原油成本传导/现货基差/库存累库/政策调控）。
2. `checkpoint_reviews`: 对上方列出的每一个存量 idea 进行阶段性对拍判断：
   - `id`: 对应 idea 的 id
   - `verdict`: "CONTINUE"(趋势发酵中，进入下一个7天周期) / "WON"(逻辑兑现止盈结项) / "LOST"(逻辑证伪止损结项) / "INVALID"(逻辑失效退出)
   - `comment`: 20-40 字口水点评（解释为什么继续或者退出）。
3. `new_ideas`: 从今日异动标的中，挑出 0~2 个具有最坚固因果逻辑的新交易假说（若盘面杂乱无明显机会可为空列表）：
   - `symbol`: 规范合约代码 (如 "TA2501")
   - `direction`: "LONG"(多) / "SHORT"(空)
   - `thesis`: 30-50 字核心假设（为什么在这个时点介入，预期的逻辑驱动是什么）。

标准 JSON 输出格式示例：
```json
{{
  "sector_weather": [
    {{"sector": "黑色系", "bias": "BEARISH", "narrative": "成材被动跟跌原料，近月现货贴水加剧，弱势难改"}},
    {{"sector": "能化系", "bias": "BULLISH", "narrative": "外盘美原油强势拉升，直接推高下游燃料油与聚酯成本线"}},
    {{"sector": "有色金属", "bias": "NEUTRAL", "narrative": "美铜高位震荡，国内下游采购观望情绪浓厚"}},
    {{"sector": "贵金属", "bias": "BULLISH", "narrative": "地缘溢价支撑黄金高位运行，白银被动跟随"}},
    {{"sector": "农产品", "bias": "BEARISH", "narrative": "生猪与油脂供应充裕，盘面阴跌寻底"}}
  ],
  "checkpoint_reviews": [],
  "new_ideas": [
    {{"symbol": "FU2611", "direction": "LONG", "thesis": "美原油反弹推升裂解价差，现货基差修复预期确立"}}
  ]
}}
```"""

def build_daily_prompt(
    features: AggregatedMarketFeatures,
    active_ideas: Optional[List[IdeaRecord]] = None
) -> str:
    """构建单次调用高信息密度的日度投研提示词，Token 严格压在 600 以内"""
    # 1. 外盘锚点文本
    anchors_lines = []
    for sym, anchor in features.foreign_anchors.items():
        chg_sign = "+" if anchor.change_percent >= 0 else ""
        anchors_lines.append(f"- {anchor.name} ({sym}): {anchor.price} ({chg_sign}{anchor.change_percent:.1f}%)")
    foreign_anchors_text = "\n".join(anchors_lines) if anchors_lines else "- 暂无今日外盘归档数据"

    # 2. 内盘异动文本
    movers_lines = []
    for c in features.top_movers[:12]:  # 最多收拢 12 个代表性主力
        chg_sign = "+" if c.change_percent >= 0 else ""
        movers_lines.append(f"- {c.symbol} {c.name}: 最新价 {c.price} ({chg_sign}{c.change_percent:.2f}%), 成交量 {c.volume}")
    top_movers_text = "\n".join(movers_lines) if movers_lines else "- 今日全市场无显著异动"

    # 3. 存量跟踪文本
    ideas_lines = []
    for idea in (active_ideas or []):
        pnl = idea.calculate_pnl()
        chg_sign = "+" if pnl >= 0 else ""
        cp_tag = " (触发检查点)" if idea.is_checkpoint_day() else ""
        ideas_lines.append(
            f"- [id={idea.id}] {idea.symbol} ({idea.direction}): 建仓 {idea.open_price} -> 最新 {idea.current_price} "
            f"(浮动盈亏 {chg_sign}{pnl:.1f}%), 第 {idea.day_count} 天{cp_tag}, 初始假设: \"{idea.thesis}\""
        )
    active_ideas_text = "\n".join(ideas_lines) if ideas_lines else "- 当前无存量跟踪标的"

    return DAILY_PROMPT_TEMPLATE.format(
        foreign_anchors_text=foreign_anchors_text,
        top_movers_text=top_movers_text,
        active_ideas_text=active_ideas_text
    )
