# 期货雷达「口水投研」Agent 极简实战实现计划 (Cloudflare 画板闭环)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 快速利用本地 Mock 沙盒跑通包含「多维锚点输入、3.5 Flash Lite 口水定性、7日检查点状态机、结项小结」的 Agent 框架，并直接打通 Cloudflare KV 与 PWA 前端画板，实现每日收盘后自动同步、手机端开箱即看、按日小步迭代。

**Architecture:** 砍掉一切多余交互（无冗余 CLI、暂不接入企微推送）。开发阶段依靠 Mock 数据“盲跑”完成全链路验证（0 API 消耗）；生产阶段每日收盘自动读取快照，通过 `gemini-3.5-flash-lite`（500 RPD 充沛）生成板块天气与假说，驱动 7 天 Checkpoint 循环，并将结果直接 `POST` 回传至 Cloudflare Worker，存入 `FUTURES_KV`，在 PWA 移动端单页新增的「💡 假设雷达」画板中无感呈现。

**Tech Stack:** Python 3.10+ (标准库 dataclasses / urllib / sqlite3 / unittest), Cloudflare Worker (JavaScript / KV), PWA HTML/CSS/JS.

---

## Global Constraints

- **极简原则（YAGNI）**：暂不开发企微推送，不强加交互式命令行工具，只保留核心全自动 Pipeline。
- **纯粹双核白名单**：大模型调用仅限 `gemini-3.5-flash-lite`（主）与 `gemini-3.1-flash-lite`（备），彻底剔除 Gemma，无需处理复杂思维链标签。
- **7 天 Checkpoint 状态机**：满 7 天触发阶段性检查点，由盘面盈亏与模型决定 `CONTINUE`（进下一个7天）或结项（生成「计划小结」卡片）。
- **零 API 消耗测试**：所有开发阶段的自动化测试 100% 运行在本地 Mock 数据之上。
- **画板即交付**：最终产出必须落地在现有的 Cloudflare Worker 与 `public/index.html` 页面上，随时打开手机即可巡检。

---

## Review Focus

1. **Cloudflare KV 同步鉴权与格式契合**：Python 回传 JSON 至 Worker `POST /api/ideas/sync` 时，确保带有 `x-snap-token` 鉴权，且数据结构与前端渲染完全对齐。
2. **7 天检查点状态平滑过渡**：当 idea 进入第 7 天，系统必须生成一次阶段性 Checkpoint 记录，若选择继续，则生命周期自动向后展期，不丢失历史价格轨迹。
3. **收盘快照异常保护**：处理缺失字段（如部分品种停牌或无结算价）时，除零安全与字段兜底保证流水线绝不崩溃。
4. **前端画板容错**：当 KV 中尚无雷达数据时，PWA 页面优雅展示“暂无今日投研数据”的空状态占位，绝不白屏。
5. **模型超时与配额熔断**：单次调用 15s 超时，遇到 503 指数退避，遇到 400 HTML 报错立即熔断。

---

## Task Decomposition

### Task 1: 核心领域模型与标准化 (Domain Models & Symbols)

**Files:**
- Create: `radar-agent/src/__init__.py`
- Create: `radar-agent/src/models.py`
- Create: `radar-agent/tests/__init__.py`
- Create: `radar-agent/tests/test_models.py`

**Interfaces:**
- Produces:
  - `ContractItem`: 规范化国内期货标的
  - `ForeignAnchor`: 外盘锚点（CL原油、GC黄金、HG美铜、CNH汇率）
  - `IdeaRecord`: 带有 7 天 Checkpoint 计数与计划小结字段的交易假说实体
  - `SectorWeather`: 板块口水天气数据结构
  - `normalize_symbol(code: str) -> str`: 统一将 `113.rb2701` 或 `rb2501` 清洗为 `RB2701`

- [ ] **Step 1: 编写数据模型与 7 天 Checkpoint 状态测试**

```python
# radar-agent/tests/test_models.py
import unittest
from src.models import IdeaRecord, normalize_symbol

class TestModels(unittest.TestCase):
    def test_normalize_symbol(self):
        self.assertEqual(normalize_symbol("113.rb2701"), "RB2701")
        self.assertEqual(normalize_symbol("nf_TA2501"), "TA2501")

    def test_idea_checkpoint_cycle(self):
        idea = IdeaRecord(
            id="idea-1",
            symbol="TA2501",
            direction="LONG",
            thesis="原油提振基差修复",
            open_price=5000.0,
            current_price=5200.0,
            day_count=7,
            status="TRACKING"
        )
        self.assertTrue(idea.is_checkpoint_day())
        self.assertAlmostEqual(idea.calculate_pnl(), 4.0, places=2)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m unittest discover -s radar-agent/tests -p "test_models.py"`
Expected: FAIL

- [ ] **Step 3: 实现 `models.py`**

实现 `models.py` 中的枚举、dataclass 及辅助函数。

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m unittest discover -s radar-agent/tests -p "test_models.py"`
Expected: OK

- [ ] **Step 5: 提交**

```bash
git add radar-agent/src/models.py radar-agent/tests/test_models.py
git commit -m "feat(radar-agent): domain models with 7-day checkpoint semantics"
```

---

### Task 2: 多资产外盘锚点与基差特征聚合器 (Feature Aggregator)

**Files:**
- Create: `radar-agent/src/aggregator.py`
- Create: `radar-agent/tests/fixtures/snapshot_mock.json`
- Create: `radar-agent/tests/fixtures/foreign_mock.json`
- Create: `radar-agent/tests/test_aggregator.py`

**Interfaces:**
- Consumes: `ContractItem`, `ForeignAnchor`
- Produces: `AggregatedMarketFeatures`:
  - `top_movers`: 涨跌幅 $\ge 1.5\%$ 且同品种去重的前 15 个主力标的
  - `foreign_anchors`: 原油、黄金、美铜、离岸人民币比价
  - `sector_distribution`: 5 大板块结构化分组

- [ ] **Step 1: 编写 Mock 数据与聚合器测试**

编写聚合逻辑测试，检验除零保护、前 15 过滤与品种去重。

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m unittest discover -s radar-agent/tests -p "test_aggregator.py"`
Expected: FAIL

- [ ] **Step 3: 实现 `aggregator.py`**

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m unittest discover -s radar-agent/tests -p "test_aggregator.py"`
Expected: OK

- [ ] **Step 5: 提交**

```bash
git add radar-agent/src/aggregator.py radar-agent/tests/fixtures/ radar-agent/tests/test_aggregator.py
git commit -m "feat(radar-agent): feature aggregator with foreign anchors and variety deduplication"
```

---

### Task 3: 紧凑型「口水投研」Prompt 组装器 (Prompt Builder)

**Files:**
- Create: `radar-agent/src/prompt_builder.py`
- Create: `radar-agent/tests/test_prompt_builder.py`

**Interfaces:**
- Consumes: `AggregatedMarketFeatures`, `IdeaRecord`
- Produces:
  - `build_daily_prompt(features, active_ideas) -> str`: 单次调用将板块口水定性、存量 Checkpoint 对拍与新假说发现打包，Tokens 严格压在 600 以内。

- [ ] **Step 1: 编写 Prompt 生成与 Token 预算测试**

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m unittest discover -s radar-agent/tests -p "test_prompt_builder.py"`
Expected: FAIL

- [ ] **Step 3: 实现 `prompt_builder.py`**

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m unittest discover -s radar-agent/tests -p "test_prompt_builder.py"`
Expected: OK

- [ ] **Step 5: 提交**

```bash
git add radar-agent/src/prompt_builder.py radar-agent/tests/test_prompt_builder.py
git commit -m "feat(radar-agent): token-compact colloquial research prompt builder"
```

---

### Task 4: 极简双核 Gemini 客户端 (3.5 / 3.1 Flash Lite)

**Files:**
- Create: `radar-agent/src/llm_client.py`
- Create: `radar-agent/tests/test_llm_client.py`

**Interfaces:**
- Produces: `ResilientGeminiClient.generate_daily_analysis(prompt: str, mock_response: dict = None) -> dict`
- 特性：
  - 默认 `gemini-3.5-flash-lite`，遇 429 自动故障转移至 `gemini-3.1-flash-lite`；
  - 遇 503 自动指数抖动退避；
  - 提取末尾有效 JSON 块；
  - 原生支持传入 `mock_response`，零真实 API 消耗。

- [ ] **Step 1: 编写双核容灾与 Mock 模式测试**

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m unittest discover -s radar-agent/tests -p "test_llm_client.py"`
Expected: FAIL

- [ ] **Step 3: 实现 `llm_client.py`**

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m unittest discover -s radar-agent/tests -p "test_llm_client.py"`
Expected: OK

- [ ] **Step 5: 提交**

```bash
git add radar-agent/src/llm_client.py radar-agent/tests/test_llm_client.py
git commit -m "feat(radar-agent): dual-core Gemini 3.5/3.1 flash lite client with mock support"
```

---

### Task 5: 7天检查点状态机与计划小结生成器 (Checkpoint State Machine)

**Files:**
- Create: `radar-agent/src/state_machine.py`
- Create: `radar-agent/src/storage.py`
- Create: `radar-agent/tests/test_state_machine.py`

**Interfaces:**
- Produces:
  - `evaluate_daily_cycle(active_ideas, latest_snapshot, llm_output) -> CycleResult`
  - 自动推进 `day_count`；在 `day_count == 7` 时触发 Checkpoint；
  - 若退出，生成标准化 `PlanSummary`（计划小结：包含真实盈亏对拍与口水归因）；
  - 本地 SQLite 持久化账本。

- [ ] **Step 1: 编写 7 天检查点与计划小结生成测试**

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m unittest discover -s radar-agent/tests -p "test_state_machine.py"`
Expected: FAIL

- [ ] **Step 3: 实现 `state_machine.py` 与 `storage.py`**

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m unittest discover -s radar-agent/tests -p "test_state_machine.py"`
Expected: OK

- [ ] **Step 5: 提交**

```bash
git add radar-agent/src/state_machine.py radar-agent/src/storage.py radar-agent/tests/test_state_machine.py
git commit -m "feat(radar-agent): 7-day checkpoint state machine and post-mortem generator"
```

---

### Task 6: Cloudflare Worker 接收端与 PWA 前端画板呈现 (Edge Sync & PWA Canvas)

**Files:**
- Modify: `src/worker/index.js` (新增 `/api/ideas/sync` POST 与 `/api/ideas` GET)
- Modify: `public/index.html` (顶栏增设「💡 假设雷达」Tab 与展示卡片)
- Create: `radar-agent/src/sync.py` (向 Worker 推送最新计算结果)
- Create: `radar-agent/src/runner.py` (一键执行日度收盘主程序，支持 `--mock` 和 `--sync`)
- Create: `radar-agent/tests/test_e2e_pipeline.py`

**Interfaces:**
- `runner.py --mock --sync`: 完整的本地离线盲跑闭环，跑完后把结果上传到 Worker（或测试桩）。
- 手机端刷新 `public/index.html` 即可看到：
  1. 5 大板块口水天气（红绿涨跌偏向 + 简短口水评价）；
  2. 正在跟踪的 Idea 卡片（标的、方向、当前天数、虚拟盈亏）；
  3. 最近完成的「计划小结」归档卡片。

- [ ] **Step 1: 编写端到端集成测试**

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m unittest discover -s radar-agent/tests -p "test_e2e_pipeline.py"`
Expected: FAIL

- [ ] **Step 3: 实现 Worker 接口、前端画板 Tab 与 `runner.py`**

- [ ] **Step 4: 运行全量测试验证 100% 通过**

Run: `python -m unittest discover -s radar-agent/tests -v`
Expected: ALL PASS

- [ ] **Step 5: 提交与部署就绪**

```bash
git add src/worker/index.js public/index.html radar-agent/
git commit -m "feat: complete radar agent pipeline with Cloudflare KV sync and PWA canvas"
```
