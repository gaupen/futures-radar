# 期货实物交割基差雷达 (Futures Radar)

国内商品期货实物交割基差雷达移动实时终端，基于 **Cloudflare Workers with Static Assets** 构建。

## 功能特性
- **数据源与中转**：新浪财经 7×24 全市场高可用行情通道，经由 Cloudflare Worker 边缘代理，彻底根治跨域（CORS）、移动蜂窝网络超时及防盗链拦截。
- **智能边缘与内存分级缓存**：
  - **Worker Edge Cache**：基于 Cloudflare Cache API (`caches.default`)，深度融合开闭盘交易时钟感知。休市与周末长效缓存（数小时至数天，100% 边缘命中，0 回源）；盘中短效削峰。
  - **客户端纯内存堆**：零磁盘/localStorage 污染，页面加载后后台静默预热大屏核心标的，实现毫秒级零延迟开图。
- **持久化快照与历史归档**：基于 Cloudflare KV 存储（`FUTURES_KV`），外盘 1 分钟分时全量按日归档，并在北京时间 15:02、23:02、01:02、02:32 定时 Cron 触发快照抓取。
- **自选同步**：支持自选合约跨端云端存储与同步。
- **现代化前端**：自包含 PWA（支持 iOS/Android 添加到主屏幕离线全屏运行）、暗黑主题、原生手势守卫、毫秒级响应。

## 目录结构
```
futures-radar/
├── public/                 # 前端静态资产 (HTML, PWA manifest, 图标)
│   ├── index.html          # 单页应用终端主页面
│   ├── manifest.webmanifest# PWA 配置文件
│   └── icon*.png / svg     # 应用图标
├── src/
│   └── worker/
│       └── index.js        # Cloudflare Worker 后端路由、Cache API 与 Cron 定时任务
├── wrangler.jsonc          # Cloudflare 现代化配置文件
└── package.json
```
