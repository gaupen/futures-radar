# 期货雷达「口水投研」Agent (radar-agent)

专为 `futures-radar` 打造的轻量级、确定性、高鲁棒性期货收盘复盘与 7 日假说跟踪 Agent。

## 核心设计理念
1. **数据预处理在前，模型定性在后**：
   - 规则初筛：涨跌幅绝对值 $\ge 1.5\%$ 排序，品种自动去重；
   - 宏观锚点：结合美原油（CL）、美黄金（GC）、美铜（HG）走势；
   - 单次 Prompt 严格压在 600 Tokens 以内，告别冗余。
2. **纯粹双核 Gemini Flash Lite**：
   - 默认主力：`gemini-3.5-flash-lite`（500 RPD，250K TPM）；
   - 故障备用：`gemini-3.1-flash-lite`；
   - 彻底剔除 Gemma，无需等待 45s 超时与解析思维链标签。
3. **7 天 Checkpoint 循环**：
   - 摆脱机械的“满 7 天强制平仓”，每 7 天为一个阶段性检查点；
   - 由盘面对拍与模型判断决定 `CONTINUE`（展期下一个 7 天）或结项（生成「计划小结」）。
4. **Cloudflare 画板闭环**：
   - 运行完毕后直接写回 Cloudflare Worker KV；
   - 手机端刷新 PWA 切换至「💡 假设雷达」Tab 即可开箱巡检。

## 快速使用

### 1. 本地 Mock 模式（零 API 消耗，飞速验证）
```bash
# 进入工程根目录
$env:PYTHONPATH="radar-agent"
python radar-agent/src/runner.py --mock
```

### 2. 生产真实运行并同步回传 Cloudflare
```bash
$env:PYTHONPATH="radar-agent"
$env:GEMINI_API_KEY="你的Google_API_Key"
$env:CF_WORKER_URL="https://futures-radar.your-subdomain.workers.dev"
$env:SNAPSHOT_TOKEN="你的安全Token"

python radar-agent/src/runner.py --sync
```

### 3. 运行全量单元测试套件
```bash
$env:PYTHONPATH="radar-agent"
python -m unittest discover -s radar-agent/tests -v
```
