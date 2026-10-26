# 期货实物交割基差雷达 (Futures Radar)

国内商品期货实物交割基差雷达移动实时终端，基于 **Cloudflare Workers with Static Assets** 构建。

## 功能特性
- **数据源**：实时抓取东方财富商品期货（上海期货交易所、大连商品交易所、郑州商品交易所、广州期货交易所、中国金融期货交易所、上海国际能源交易中心等）行情数据。
- **持久化快照**：基于 Cloudflare KV 存储（`FUTURES_KV`），并在北京时间 15:05、23:35、02:35 定时 Cron 触发快照抓取。
- **自选同步**：支持自选合约跨端云端存储与同步。
- **现代化前端**：自包含 PWA（支持 iOS/Android 添加到主屏幕离线全屏运行）、暗黑主题、毫秒级响应。

## 目录结构
```
futures-radar/
├── public/                 # 前端静态资产 (HTML, PWA manifest, 图标)
│   ├── index.html          # 单页应用终端主页面
│   ├── manifest.webmanifest# PWA 配置文件
│   └── icon*.png / svg     # 应用图标
├── src/
│   └── worker/
│       └── index.js        # Cloudflare Worker 后端路由与 Cron 定时任务
├── wrangler.jsonc          # Cloudflare 现代化配置文件
└── package.json
```
