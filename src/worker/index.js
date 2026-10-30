var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker/index.js - Build: 2026-10-27-multi-market-v2-pure-sina
var KV_KEY = "snapshot:latest";
var WATCHLIST_KV_KEY = "watchlist:global";
var FOREIGN_ARCHIVE_SYMBOLS = ["CL", "OIL", "GC", "SI", "HG", "CAD", "ZSD", "NG", "S", "C"];

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}
__name(jsonResp, "jsonResp");

function checkToken(request, url, env) {
  if (!env.SNAPSHOT_TOKEN) return true;
  const tk = request.headers.get("x-snap-token") || url.searchParams.get("token");
  return tk === env.SNAPSHOT_TOKEN;
}
__name(checkToken, "checkToken");

function validateAndSanitizeDiff(rawList, minCount = 100) {
  if (!Array.isArray(rawList)) {
    throw new Error("diff must be an array");
  }
  if (!rawList.length) {
    throw new Error("diff is empty");
  }
  if (rawList.length > 5e3) {
    throw new Error("diff count exceeds maximum safety limit (5000)");
  }
  const sanitized = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const code = item.f12;
    const market = item.f13;
    const rawPrice = item.f2;
    if (!code || typeof code !== "string" || !code.trim()) continue;
    if (market === void 0 || market === null || market === "") continue;
    const price = typeof rawPrice === "number" ? rawPrice : parseFloat(rawPrice);
    if (isNaN(price) || price <= 0) continue;
    sanitized.push({
      ...item,
      f12: String(code).trim(),
      f2: price
    });
  }
  if (sanitized.length < minCount) {
    throw new Error(`diff count below minimum threshold (${sanitized.length} < ${minCount})`);
  }
  return sanitized;
}
__name(validateAndSanitizeDiff, "validateAndSanitizeDiff");

var VARIETIES_FOR_SNAPSHOT = [
  { s: "FU", m: 113 }, { s: "RB", m: 113 }, { s: "HC", m: 113 }, { s: "BU", m: 113 }, { s: "RU", m: 113 },
  { s: "AG", m: 113 }, { s: "AU", m: 113 }, { s: "CU", m: 113 }, { s: "AL", m: 113 }, { s: "ZN", m: 113 },
  { s: "PB", m: 113 }, { s: "NI", m: 113 }, { s: "SN", m: 113 }, { s: "SS", m: 113 }, { s: "SP", m: 113 },
  { s: "AO", m: 113 }, { s: "BR", m: 113 }, { s: "WR", m: 113 },
  { s: "SC", m: 142 }, { s: "LU", m: 142 }, { s: "NR", m: 142 }, { s: "BC", m: 142 }, { s: "EC", m: 142 },
  { s: "M", m: 114 }, { s: "JM", m: 114 }, { s: "J", m: 114 }, { s: "I", m: 114 }, { s: "Y", m: 114 },
  { s: "P", m: 114 }, { s: "C", m: 114 }, { s: "CS", m: 114 }, { s: "A", m: 114 }, { s: "B", m: 114 },
  { s: "L", m: 114 }, { s: "V", m: 114 }, { s: "PP", m: 114 }, { s: "EG", m: 114 }, { s: "EB", m: 114 },
  { s: "PG", m: 114 }, { s: "LH", m: 114 }, { s: "JD", m: 114 }, { s: "RR", m: 114 },
  { s: "OI", m: 115 }, { s: "TA", m: 115 }, { s: "MA", m: 115 }, { s: "FG", m: 115 }, { s: "SA", m: 115 },
  { s: "RM", m: 115 }, { s: "SR", m: 115 }, { s: "CF", m: 115 }, { s: "CY", m: 115 }, { s: "AP", m: 115 },
  { s: "CJ", m: 115 }, { s: "UR", m: 115 }, { s: "PF", m: 115 }, { s: "PK", m: 115 }, { s: "PX", m: 115 },
  { s: "SH", m: 115 }, { s: "SF", m: 115 }, { s: "SM", m: 115 },
  { s: "SI", m: 225 }, { s: "LC", m: 225 }, { s: "PS", m: 225 }
];

async function fetchSinaSnapshotRaw() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const pool = [];
  for (let i = 0; i <= 8; i++) {
    const d = new Date(year, month - 1 + i, 1);
    const y2 = String(d.getFullYear() % 100).padStart(2, "0");
    const m2 = String(d.getMonth() + 1).padStart(2, "0");
    const y1 = String(d.getFullYear() % 10);

    for (const v of VARIETIES_FOR_SNAPSHOT) {
      const sinaSymbol = "nf_" + v.s + y2 + m2;
      const code = v.m === 115 ? (v.s + y1 + m2) : (v.s.toLowerCase() + y2 + m2);
      pool.push({ sinaSymbol, code, market: v.m });
    }
  }

  const BATCH_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < pool.length; i += BATCH_SIZE) {
    chunks.push(pool.slice(i, i + BATCH_SIZE));
  }

  const map = new Map();
  for (const chunk of chunks) {
    const syms = chunk.map(c => c.sinaSymbol).join(",");
    const url = "https://hq.sinajs.cn/list=" + syms;
    try {
      const resp = await fetch(url, {
        headers: {
          "Referer": "https://finance.sina.com.cn",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
      });
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      const text = new TextDecoder("gb18030").decode(buf);
      const lines = text.split("\n");

      const itemMap = new Map();
      chunk.forEach(c => itemMap.set(c.sinaSymbol, c));

      for (const line of lines) {
        const m = line.match(/hq_str_(nf_\w+)=\"([^\"]+)\"/);
        if (!m) continue;
        const sym = m[1];
        const valStr = m[2];
        const meta = itemMap.get(sym);
        if (!meta) continue;

        const parts = valStr.split(",");
        if (parts.length < 15) continue;

        const name = parts[0];
        const open = parseFloat(parts[2]) || 0;
        const high = parseFloat(parts[3]) || 0;
        const low = parseFloat(parts[4]) || 0;
        const price = parseFloat(parts[8]) || 0;
        const prevSettle = parseFloat(parts[10]) || 0;
        const vol = parseInt(parts[14]) || 0;

        if (price <= 0) continue;

        const change = prevSettle > 0 ? (price - prevSettle) : 0;
        const changePercent = prevSettle > 0 ? (change / prevSettle) * 100 : 0;

        const secid = `${meta.market}.${meta.code}`;
        map.set(secid, {
          f12: meta.code,
          f13: meta.market,
          f14: name,
          f2: price,
          f3: parseFloat(changePercent.toFixed(2)),
          f4: parseFloat(change.toFixed(2)),
          f5: vol,
          f6: 0,
          f15: high,
          f16: low,
          f17: open,
          f18: prevSettle,
          f124: Math.floor(Date.now() / 1000)
        });
      }
    } catch (e) {
      console.warn("[worker-sina] batch error:", e);
    }
  }

  return Array.from(map.values());
}
__name(fetchSinaSnapshotRaw, "fetchSinaSnapshotRaw");

async function fetchLatestMarketDiff() {
  return await fetchSinaSnapshotRaw();
}
__name(fetchLatestMarketDiff, "fetchLatestMarketDiff");

async function appendCronLog(env, eventType, message, details = null) {
  try {
    const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
    const timeStr = bjNow.toISOString().replace("T", " ").slice(0, 19);
    const raw = await env.FUTURES_KV.get("cron:logs");
    let logs = [];
    if (raw) {
      try { logs = JSON.parse(raw); } catch (e) { logs = []; }
    }
    logs.unshift({
      time: timeStr,
      type: eventType,
      msg: message,
      details: details || {}
    });
    if (logs.length > 50) logs = logs.slice(0, 50);
    await env.FUTURES_KV.put("cron:logs", JSON.stringify(logs), { expirationTtl: 86400 * 14 });
  } catch (e) {
    console.warn("[cron-log] Failed to write log:", e);
  }
}
__name(appendCronLog, "appendCronLog");

async function archiveForeignFuturesDay(env, targetDateStr) {
  const results = await Promise.all(FOREIGN_ARCHIVE_SYMBOLS.map(async sym => {
    try {
      const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=${sym}`;
      const resp = await fetch(url, {
        headers: { "Referer": "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0" }
      });
      if (!resp.ok) return { sym, preSettle: 0, bars: [] };
      const text = await resp.text();
      const m = text.match(/\(\s*(\{[\s\S]*\})\s*\)/);
      if (!m) return { sym, preSettle: 0, bars: [] };
      const json = JSON.parse(m[1]);
      const minLine = json.minLine_1d || [];
      const cleanBars = [];
      let preSettle = 0;
      for (let i = 0; i < minLine.length; i++) {
        const item = minLine[i];
        if (!item || item.length < 5) continue;
        if (i === 0) {
          preSettle = parseFloat(item[1]) || 0;
          const p = parseFloat(item[5]) || 0;
          const a = parseFloat(item[8]) || 0;
          const t = item[9] || (item[0] + ' ' + item[4]);
          const v = parseInt(item[6]) || 0;
          if (p > 0) cleanBars.push([t, p, (a > 0 ? a : p), v]);
        } else {
          const p = parseFloat(item[1]) || 0;
          const a = parseFloat(item[4]) || 0;
          const t = item[item.length - 1] || item[0];
          const v = parseInt(item[2]) || 0;
          if (p > 0) cleanBars.push([t, p, (a > 0 ? a : p), v]);
        }
      }
      return { sym, preSettle, bars: cleanBars };
    } catch (e) {
      return { sym, preSettle: 0, bars: [] };
    }
  }));

  const validCount = results.filter(r => r.bars.length >= 100).length;
  if (validCount < 2) {
    throw new Error(`外盘分时数据不完整 (仅 ${validCount} 个品种点数 >= 100)，推迟归档`);
  }

  const contracts = {};
  const preSettlements = {};
  for (const r of results) {
    if (r.bars.length > 0) {
      contracts[r.sym] = r.bars;
      preSettlements[r.sym] = r.preSettle;
    }
  }

  const payload = {
    date: targetDateStr,
    updatedAt: Date.now(),
    savedAt: new Date().toISOString(),
    symbols: Object.keys(contracts),
    preSettlements,
    contracts
  };

  const key = `foreign:1min:${targetDateStr}`;
  await env.FUTURES_KV.put(key, JSON.stringify(payload), { expirationTtl: 86400 * 8 });
  await env.FUTURES_KV.put(`cron:done:foreign:${targetDateStr}`, "1", { expirationTtl: 86400 * 2 });
  const totalBars = Object.values(contracts).reduce((acc, b) => acc + b.length, 0);
  await appendCronLog(env, "FOREIGN_SUCCESS", `外盘 1 分钟全量归档成功 @ ${targetDateStr}`, {
    date: targetDateStr,
    symbols: Object.keys(contracts).length,
    totalBars: totalBars,
    sizeKb: ((JSON.stringify(payload).length) / 1024).toFixed(1) + " KB"
  });
  return payload;
}
__name(archiveForeignFuturesDay, "archiveForeignFuturesDay");

async function saveSnapshot(env, diff, minCount = 50) {
  const validatedDiff = validateAndSanitizeDiff(diff, minCount);
  const payload = {
    ts: Date.now(),
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    count: validatedDiff.length,
    diff: validatedDiff
  };
  await env.FUTURES_KV.put(KV_KEY, JSON.stringify(payload));
  return payload;
}
__name(saveSnapshot, "saveSnapshot");

// ==================== 交易时段感知与边缘缓存 (Cloudflare Cache API) ====================
function getMarketTradingStatus(nowDate = new Date()) {
  const bjNow = new Date(nowDate.getTime() + 8 * 3600 * 1000);
  const day = bjNow.getUTCDay(); // 0: 日, 1: 一, ..., 6: 六
  const hours = bjNow.getUTCHours();
  const minutes = bjNow.getUTCMinutes();
  const t = hours * 60 + minutes;

  // 1. 国内商品期货时段 (日盘 08:55-11:35, 13:25-15:05; 夜盘 20:55-02:35)
  let isDomesticTrading = false;
  if (day === 0) {
    isDomesticTrading = false;
  } else if (day === 6) {
    isDomesticTrading = (t <= 2 * 60 + 35); // 周六凌晨承接周五夜盘至 02:30
  } else if (day === 1) {
    const isDay = (t >= 8 * 60 + 55 && t <= 11 * 60 + 35) || (t >= 13 * 60 + 25 && t <= 15 * 60 + 5);
    const isNight = (t >= 20 * 60 + 55 && t <= 24 * 60);
    isDomesticTrading = isDay || isNight;
  } else {
    const isEarlyNight = (t <= 2 * 60 + 35);
    const isDay = (t >= 8 * 60 + 55 && t <= 11 * 60 + 35) || (t >= 13 * 60 + 25 && t <= 15 * 60 + 5);
    const isNight = (t >= 20 * 60 + 55 && t <= 24 * 60);
    isDomesticTrading = isEarlyNight || isDay || isNight;
  }

  // 2. 外盘期货/全球主流资产时段 (周一 06:00 至 周六 05:00 CST 几近连续运行)
  let isGlobalTrading = false;
  if (day === 0) {
    isGlobalTrading = false;
  } else if (day === 6) {
    isGlobalTrading = (t <= 5 * 60 + 5); // 周六早晨 05:00 收盘
  } else if (day === 1) {
    isGlobalTrading = (t >= 6 * 60);
  } else {
    isGlobalTrading = !(t >= 5 * 60 && t <= 6 * 60);
  }

  const isWeekend = (day === 0 || (day === 6 && t > 5 * 60) || (day === 1 && t < 6 * 60));

  return {
    isDomesticTrading,
    isGlobalTrading,
    isAnyTrading: isDomesticTrading || isGlobalTrading,
    isWeekend
  };
}
__name(getMarketTradingStatus, "getMarketTradingStatus");

function getStockCacheTtl(targetUrl, tradingStatus) {
  const isDomestic = targetUrl.includes("InnerFuturesNewService");
  const isDaily = targetUrl.includes("Daily") || targetUrl.includes("daily") || targetUrl.includes("type=101");

  if (isDomestic) {
    if (!tradingStatus.isDomesticTrading) {
      // 国内休市：周末长效 4 小时，工作日休市 30 分钟 (数据已定格，大幅削减新浪回源)
      return tradingStatus.isWeekend ? 14400 : 1800;
    }
    // 盘中：日K 60秒，分时与5分钟 10秒
    return isDaily ? 60 : 10;
  } else {
    if (!tradingStatus.isGlobalTrading) {
      return tradingStatus.isWeekend ? 14400 : 1800;
    }
    return isDaily ? 60 : 10;
  }
}
__name(getStockCacheTtl, "getStockCacheTtl");

function getSinaUrlsForCode(code, types = ["15", "trend", "5", "101"]) {
  const c = String(code || "").trim();
  if (!c) return [];

  const typeSet = new Set(types);

  if (c.toLowerCase().startsWith("hf_")) {
    const pure = c.slice(3).toUpperCase();
    const urls = [];
    if (typeSet.has("trend") || typeSet.has("15") || typeSet.has("5") || typeSet.has("60")) {
      urls.push(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=${pure}`);
    }
    if (typeSet.has("101")) {
      urls.push(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${pure}`);
    }
    return urls;
  }

  if (c.toLowerCase().startsWith("gb_")) {
    const pure = c.slice(3).toLowerCase();
    const urls = [];
    if (typeSet.has("15")) {
      urls.push(`https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_f=/US_MinKService.getMinK?symbol=${pure}&type=15`);
    }
    if (typeSet.has("trend")) {
      urls.push(`https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_f=/US_MinlineNService.getMinline?symbol=${pure}&day=5`);
    }
    if (typeSet.has("5")) {
      urls.push(`https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_f=/US_MinKService.getMinK?symbol=${pure}&type=5`);
    }
    if (typeSet.has("101")) {
      urls.push(`https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_f=/US_MinKService.getDailyK?symbol=${pure}`);
    }
    return urls;
  }

  // 国内期货 (提取纯品种+年月代码，如 113.rb2701 -> RB2701, 115.MA605 -> MA2605)
  let raw = c.includes(".") ? c.split(".")[1] : c;
  raw = raw.toUpperCase().trim();
  const m3 = raw.match(/^([A-Z]+)(\d)(\d{2})$/);
  if (m3) {
    raw = `${m3[1]}2${m3[2]}${m3[3]}`;
  }

  const urls = [];
  if (typeSet.has("15")) {
    urls.push(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/InnerFuturesNewService.getFewMinLine?symbol=${raw}&type=15`);
  }
  if (typeSet.has("trend")) {
    urls.push(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/InnerFuturesNewService.getFourDaysLine?symbol=${raw}`);
  }
  if (typeSet.has("5")) {
    urls.push(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/InnerFuturesNewService.getFewMinLine?symbol=${raw}&type=5`);
  }
  if (typeSet.has("101")) {
    urls.push(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_f=/InnerFuturesNewService.getDailyKLine?symbol=${raw}`);
  }
  return urls;
}
__name(getSinaUrlsForCode, "getSinaUrlsForCode");

async function warmSingleTargetUrl(targetUrl, requestUrl, cache, tradingStatus) {
  if (!targetUrl) return { url: targetUrl, status: "skip" };

  try {
    const parsed = new URL(targetUrl);
    if (!parsed.hostname.endsWith(".sina.com.cn") && parsed.hostname !== "sina.com.cn") {
      return { url: targetUrl, status: "forbidden" };
    }
  } catch (e) {
    return { url: targetUrl, status: "invalid_url" };
  }

  const normalizedTarget = targetUrl
    .replace(/\/var%20[^=]+=\//i, "/var%20_f=/")
    .replace(/\/var\s+[^=]+=\//i, "/var%20_f=/");

  const cacheUrlObj = new URL(requestUrl);
  cacheUrlObj.pathname = "/api/sina-stock";
  cacheUrlObj.search = "?url=" + encodeURIComponent(normalizedTarget);
  const cacheKey = new Request(cacheUrlObj.toString(), { method: "GET" });

  try {
    const existing = await cache.match(cacheKey);
    if (existing) {
      return { url: normalizedTarget, status: "already_cached" };
    }
  } catch (e) {}

  try {
    const resp = await fetch(normalizedTarget, {
      headers: {
        "Referer": "https://finance.sina.com.cn",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    if (!resp.ok) {
      return { url: normalizedTarget, status: "error", code: resp.status };
    }

    const buf = await resp.arrayBuffer();
    let text = new TextDecoder("gb18030").decode(buf);
    text = text.replace(/\/\*[\s\S]*?\*\//g, "").trim();

    const edgeTtl = getStockCacheTtl(normalizedTarget, tradingStatus);
    const clientTtl = tradingStatus.isWeekend ? 300 : (edgeTtl >= 60 ? 15 : 5);

    const responseToCache = new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": `public, max-age=${clientTtl}, s-maxage=${edgeTtl}`,
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "x-cf-cache",
        "x-cf-cache": "MISS"
      }
    });

    await cache.put(cacheKey, responseToCache.clone());
    return { url: normalizedTarget, status: "warmed", ttl: edgeTtl };
  } catch (err) {
    return { url: normalizedTarget, status: "error", error: err && err.message || String(err) };
  }
}
__name(warmSingleTargetUrl, "warmSingleTargetUrl");

var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-snap-token",
          "access-control-max-age": "86400"
        }
      });
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/snapshot") {
      if (request.method === "POST") {
        return jsonResp({
          ok: false,
          error: "Client snapshot uploads are disabled. Snapshots are generated exclusively server-side via scheduled worker cron jobs."
        }, 405);
      }
      if (request.method !== "GET") {
        return jsonResp({ ok: false, error: "method not allowed" }, 405);
      }
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      const raw = await env.FUTURES_KV.get(KV_KEY);
      if (!raw) return jsonResp({ ok: false, error: "no snapshot" }, 404);
      return new Response(raw, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*"
        }
      });
    }
    if (url.pathname === "/api/sina") {
      let list = url.searchParams.get("list");
      if (!list) return new Response("", { status: 400 });
      // 自动规范化大小写 (外盘期货 hf_CL/hf_GC 必须大写，美股 gb_nvda/gb_aapl 必须小写)
      const symArr = list.split(",").map(sym => {
        const s = sym.trim();
        if (s.toLowerCase().startsWith("hf_")) return "hf_" + s.slice(3).toUpperCase();
        if (s.toLowerCase().startsWith("gb_")) return "gb_" + s.slice(3).toLowerCase();
        return s;
      }).filter(Boolean);

      // 规范排序构造确定的 Edge Cache Key，避免列表项顺序不同打散缓存
      const sortedList = [...symArr].sort().join(",");
      const cacheUrlObj = new URL(request.url);
      cacheUrlObj.searchParams.set("list", sortedList);
      cacheUrlObj.searchParams.delete("_t");
      const cacheKey = new Request(cacheUrlObj.toString(), { method: "GET" });

      const cache = caches.default;
      try {
        const cachedResp = await cache.match(cacheKey);
        if (cachedResp) {
          const hitHeaders = new Headers(cachedResp.headers);
          hitHeaders.set("x-cf-cache", "HIT");
          return new Response(cachedResp.body, {
            status: cachedResp.status,
            headers: hitHeaders
          });
        }
      } catch (ce) {}

      try {
        const sinaResp = await fetch("https://hq.sinajs.cn/list=" + sortedList, {
          headers: {
            "Referer": "https://finance.sina.com.cn",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          }
        });
        if (!sinaResp.ok) {
          return new Response("// error upstream: " + sinaResp.status, { status: sinaResp.status });
        }

        const buf = await sinaResp.arrayBuffer();
        const tradingStatus = getMarketTradingStatus();
        // 盘中高频 3 秒削峰；休市/周末缓存 180~600 秒
        const edgeTtl = tradingStatus.isAnyTrading ? 3 : (tradingStatus.isWeekend ? 600 : 180);
        const clientTtl = tradingStatus.isAnyTrading ? 2 : 30;

        const responseToReturn = new Response(buf, {
          status: 200,
          headers: {
            "content-type": "application/javascript; charset=gb18030",
            "cache-control": `public, max-age=${clientTtl}, s-maxage=${edgeTtl}`,
            "access-control-allow-origin": "*",
            "x-cf-cache": "MISS"
          }
        });

        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(cache.put(cacheKey, responseToReturn.clone()));
        }
        return responseToReturn;
      } catch (e) {
        return new Response("// error: " + (e && e.message || String(e)), { status: 502 });
      }
    }
    if (url.pathname === "/api/sina-stock") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing url", { status: 400 });
      try {
        const parsed = new URL(targetUrl);
        if (!parsed.hostname.endsWith(".sina.com.cn") && parsed.hostname !== "sina.com.cn") {
          return new Response("Forbidden host", { status: 403 });
        }

        // 规范化 URL：将 JSONP 随机回调变量替换为统一的 _f，保证相同品种/时期的请求共享同一个 Edge Cache
        const normalizedTarget = targetUrl
          .replace(/\/var%20[^=]+=\//i, "/var%20_f=/")
          .replace(/\/var\s+[^=]+=\//i, "/var%20_f=/");

        const cacheUrlObj = new URL(request.url);
        cacheUrlObj.searchParams.set("url", normalizedTarget);
        cacheUrlObj.searchParams.delete("_t");
        const cacheKey = new Request(cacheUrlObj.toString(), { method: "GET" });

        const cache = caches.default;
        try {
          const cachedResp = await cache.match(cacheKey);
          if (cachedResp) {
            const hitHeaders = new Headers(cachedResp.headers);
            hitHeaders.set("x-cf-cache", "HIT");
            hitHeaders.set("access-control-allow-origin", "*");
            hitHeaders.set("access-control-expose-headers", "x-cf-cache");
            return new Response(cachedResp.body, {
              status: cachedResp.status,
              headers: hitHeaders
            });
          }
        } catch (ce) {}

        const resp = await fetch(targetUrl, {
          headers: {
            "Referer": "https://finance.sina.com.cn",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          }
        });
        if (!resp.ok) {
          return new Response("// error upstream: " + resp.status, { status: resp.status });
        }

        const buf = await resp.arrayBuffer();
        let text = new TextDecoder("gb18030").decode(buf);
        // 彻底剔除新浪特征防盗链注释 /*<script>location.href='//sina.com';</script>*/，确保下游 JSONP 极速准确解析
        text = text.replace(/\/\*[\s\S]*?\*\//g, "").trim();

        const tradingStatus = getMarketTradingStatus();
        const edgeTtl = getStockCacheTtl(targetUrl, tradingStatus);
        const clientTtl = tradingStatus.isWeekend ? 300 : (edgeTtl >= 60 ? 15 : 5);

        const responseToReturn = new Response(text, {
          status: 200,
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": `public, max-age=${clientTtl}, s-maxage=${edgeTtl}`,
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "x-cf-cache",
            "x-cf-cache": "MISS"
          }
        });

        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(cache.put(cacheKey, responseToReturn.clone()));
        }
        return responseToReturn;
      } catch (e) {
        return new Response("// error: " + (e && e.message || String(e)), { status: 502 });
      }
    }
    if (url.pathname === "/api/warm") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "86400"
          }
        });
      }

      let codes = [];
      let urls = [];
      let types = ["15", "trend", "5", "101"];
      let from = 0;
      let limit = 4;

      if (request.method === "POST") {
        try {
          const body = await request.json();
          if (Array.isArray(body.urls)) urls = body.urls;
          if (Array.isArray(body.codes)) codes = body.codes;
          if (Array.isArray(body.types)) types = body.types;
          if (typeof body.from === "number") from = body.from;
          if (typeof body.limit === "number") limit = body.limit;
        } catch (e) {}
      } else {
        const rawCodes = url.searchParams.get("codes") || url.searchParams.get("symbols");
        if (rawCodes) codes = rawCodes.split(",").map(s => s.trim()).filter(Boolean);
        const rawUrls = url.searchParams.get("urls");
        if (rawUrls) urls = rawUrls.split(",").map(u => u.trim()).filter(Boolean);
        const rawTypes = url.searchParams.get("types");
        if (rawTypes) types = rawTypes.split(",").map(t => t.trim()).filter(Boolean);
        const pFrom = parseInt(url.searchParams.get("from") || "0", 10);
        const pLimit = parseInt(url.searchParams.get("limit") || "4", 10);
        if (!isNaN(pFrom) && pFrom >= 0) from = pFrom;
        if (!isNaN(pLimit) && pLimit > 0) limit = pLimit;
      }

      // 严格限制每批处理的标的数量上限为 6（每个标的约 2-4 条子请求，确保绝不超过 Workers 免费版 50 次子请求上限）
      limit = Math.min(Math.max(limit, 1), 6);

      if (codes.length > 0 && urls.length === 0) {
        const codeSlice = codes.slice(from, from + limit);
        for (const c of codeSlice) {
          urls.push(...getSinaUrlsForCode(c, types));
        }
      } else if (urls.length > 0) {
        urls = urls.slice(from, from + (limit * 4));
      }

      if (urls.length === 0) {
        return jsonResp({ ok: true, count: 0, warmed: 0, cached: 0, total: 0, nextFrom: -1 });
      }

      const cache = caches.default;
      const tradingStatus = getMarketTradingStatus();

      const results = await Promise.allSettled(urls.map(targetUrl => {
        return warmSingleTargetUrl(targetUrl, request.url, cache, tradingStatus);
      }));

      let warmedCount = 0;
      let cachedCount = 0;
      let errorCount = 0;

      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value.status === "warmed") warmedCount++;
          else if (r.value.status === "already_cached") cachedCount++;
          else if (r.value.status === "error") errorCount++;
        } else {
          errorCount++;
        }
      }

      const nextFrom = (codes.length > 0 && from + limit < codes.length) ? (from + limit) : -1;

      return jsonResp({
        ok: true,
        totalCodes: codes.length,
        from,
        limit,
        nextFrom,
        urlsCount: urls.length,
        warmed: warmedCount,
        cached: cachedCount,
        errors: errorCount,
        tradingStatus: {
          isAnyTrading: tradingStatus.isAnyTrading,
          isWeekend: tradingStatus.isWeekend
        }
      });
    }
    if (url.pathname === "/api/history/foreign-min") {
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      const rawSym = url.searchParams.get("symbol") || url.searchParams.get("secid");
      if (!rawSym) return jsonResp({ ok: false, error: "缺少 symbol 参数" }, 400);
      const pureSym = rawSym.replace(/^hf_/i, "").toUpperCase();

      // 获取最近 4 个有效归档日 (排除周末)
      const targetDates = [];
      for (let i = 1; i <= 8; i++) {
        const d = new Date(Date.now() + 8 * 3600 * 1000 - i * 86400 * 1000);
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) {
          targetDates.push(d.toISOString().slice(0, 10));
        }
        if (targetDates.length >= 4) break;
      }
      targetDates.reverse(); // 时间正序：[最老, ..., 昨天]

      const historyBars = [];
      const foundDates = [];
      let latestPreSettle = 0;

      for (const d of targetDates) {
        try {
          const raw = await env.FUTURES_KV.get(`foreign:1min:${d}`);
          if (!raw) continue;
          const archive = JSON.parse(raw);
          if (archive && archive.contracts && Array.isArray(archive.contracts[pureSym])) {
            const cBars = archive.contracts[pureSym];
            if (cBars.length > 0) {
              foundDates.push(d);
              if (archive.preSettlements && archive.preSettlements[pureSym]) {
                latestPreSettle = archive.preSettlements[pureSym];
              }
              for (const b of cBars) {
                historyBars.push({
                  timeStr: b[0],
                  price: b[1],
                  avgPrice: b[2],
                  vol: b[3] || 0
                });
              }
            }
          }
        } catch (e) {}
      }

      return jsonResp({
        ok: true,
        symbol: pureSym,
        count: historyBars.length,
        dates: foundDates,
        preSettlement: latestPreSettle,
        bars: historyBars
      });
    }
    if (url.pathname === "/api/cron/trigger-sync") {
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      const type = url.searchParams.get("type") || "foreign";
      const dateStr = url.searchParams.get("date") || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      try {
        if (type === "foreign") {
          const saved = await archiveForeignFuturesDay(env, dateStr);
          return jsonResp({ ok: true, type: "foreign", date: dateStr, symbols: saved.symbols.length, savedAt: saved.savedAt });
        } else if (type === "domestic") {
          const diff = await fetchSinaSnapshotRaw();
          const saved = await saveSnapshot(env, diff, 50);
          return jsonResp({ ok: true, type: "domestic", count: saved.count, savedAt: saved.savedAt });
        }
        return jsonResp({ ok: false, error: "unknown sync type" }, 400);
      } catch (e) {
        return jsonResp({ ok: false, error: e && e.message || String(e) }, 500);
      }
    }
    if (url.pathname === "/api/cron/status") {
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
      const hours = bjNow.getUTCHours();
      const minutes = bjNow.getUTCMinutes();
      const hm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      const dayOfWeek = bjNow.getUTCDay();
      const dateStr = bjNow.toISOString().slice(0, 10);
      const prevTradingDay = new Date(Date.now() + 8 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);

      const [foreignDone, cnDayDone, cnNight1Done, cnNight2Done, cnNight3Done, rawLogs] = await Promise.all([
        env.FUTURES_KV.get(`cron:done:foreign:${prevTradingDay}`),
        env.FUTURES_KV.get(`cron:done:${dateStr}:cn_day`),
        env.FUTURES_KV.get(`cron:done:${dateStr}:cn_night1`),
        env.FUTURES_KV.get(`cron:done:${dateStr}:cn_night2`),
        env.FUTURES_KV.get(`cron:done:${dateStr}:cn_night3`),
        env.FUTURES_KV.get("cron:logs")
      ]);

      let logs = [];
      if (rawLogs) {
        try { logs = JSON.parse(rawLogs); } catch (e) { logs = []; }
      }

      // 检查最近 7 天存在的外盘归档
      const targetDates = [];
      for (let i = 1; i <= 7; i++) {
        targetDates.push(new Date(Date.now() + 8 * 3600 * 1000 - i * 86400 * 1000).toISOString().slice(0, 10));
      }
      const archivesCheck = await Promise.all(targetDates.map(async d => {
        const raw = await env.FUTURES_KV.get(`foreign:1min:${d}`);
        return { date: d, exists: !!raw, sizeKb: raw ? (raw.length / 1024).toFixed(1) + " KB" : null };
      }));

      const statusData = {
        ok: true,
        serverTime: {
          utc: new Date().toISOString(),
          beijing: bjNow.toISOString().replace("T", " ").slice(0, 19),
          hm: hm,
          dayOfWeek: dayOfWeek
        },
        taskCheckpoints: {
          foreignArchivePrevTradingDay: { date: prevTradingDay, completed: !!foreignDone },
          domesticDaySessionClose: { date: dateStr, completed: !!cnDayDone },
          domesticNightSession1: { date: dateStr, completed: !!cnNight1Done },
          domesticNightSession2: { date: dateStr, completed: !!cnNight2Done },
          domesticNightSession3: { date: dateStr, completed: !!cnNight3Done }
        },
        availableForeignArchives: archivesCheck,
        recentLogsCount: logs.length,
        recentLogs: logs
      };

      const wantsHtml = url.searchParams.get("format") === "html" || (request.headers.get("accept") || "").includes("text/html");
      if (wantsHtml) {
        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cloudflare Cron & 归档监控仪表盘</title>
<style>
  body { background:#0d1117; color:#c9d1d9; font-family:-apple-system,BlinkMacSystemFont,monospace; padding:20px; margin:0; line-height:1.5; }
  h1 { color:#58a6ff; font-size:20px; border-bottom:1px solid #30363d; padding-bottom:10px; margin-top:0; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; margin-bottom:16px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold; }
  .badge-done { background:#238636; color:#fff; }
  .badge-pending { background:#484f58; color:#c9d1d9; }
  .badge-log { background:#1f6feb; color:#fff; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:13px; }
  th, td { border:1px solid #30363d; padding:8px 12px; text-align:left; }
  th { background:#21262d; color:#8b949e; }
  tr:nth-child(even) { background:#0d1117; }
  .btn { display:inline-block; padding:6px 12px; background:#238636; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold; font-size:13px; margin-right:8px; margin-top:6px; }
</style>
</head>
<body>
<h1>⏱️ Cloudflare Worker Cron 定时器 & 归档诊断仪表盘</h1>
<div class="card">
  <strong>北京时间：</strong> ${statusData.serverTime.beijing} (UTC: ${statusData.serverTime.utc})<br>
  <strong>快捷操作：</strong><br>
  <a class="btn" href="/api/cron/trigger-sync?type=foreign" target="_blank">⚡ 手动补录外盘归档</a>
  <a class="btn" href="/api/cron/trigger-sync?type=domestic" target="_blank" style="background:#1f6feb;">⚡ 手动补录国内快照</a>
  <a class="btn" href="/api/cron/status?format=html" style="background:#30363d;">🔄 刷新本页面</a>
</div>

<div class="card">
  <h3>📋 今日收盘任务完成状态检查</h3>
  <table>
    <tr><th>任务名称</th><th>对应日期/交易日</th><th>当前状态</th></tr>
    <tr><td>外盘 CME 1分钟全量归档</td><td>${prevTradingDay}</td><td><span class="badge ${foreignDone ? 'badge-done' : 'badge-pending'}">${foreignDone ? '🟢 已完成' : '⚪ 未就绪/待触发'}</span></td></tr>
    <tr><td>国内日盘收盘快照 (15:02)</td><td>${dateStr}</td><td><span class="badge ${cnDayDone ? 'badge-done' : 'badge-pending'}">${cnDayDone ? '🟢 已完成' : '⚪ 未到时间/待触发'}</span></td></tr>
    <tr><td>国内夜盘收盘1 (23:02)</td><td>${dateStr}</td><td><span class="badge ${cnNight1Done ? 'badge-done' : 'badge-pending'}">${cnNight1Done ? '🟢 已完成' : '⚪ 未到时间/待触发'}</span></td></tr>
    <tr><td>国内夜盘收盘2 (01:02)</td><td>${dateStr}</td><td><span class="badge ${cnNight2Done ? 'badge-done' : 'badge-pending'}">${cnNight2Done ? '🟢 已完成' : '⚪ 未到时间/待触发'}</span></td></tr>
    <tr><td>国内夜盘收盘3 (02:32)</td><td>${dateStr}</td><td><span class="badge ${cnNight3Done ? 'badge-done' : 'badge-pending'}">${cnNight3Done ? '🟢 已完成' : '⚪ 未到时间/待触发'}</span></td></tr>
  </table>
</div>

<div class="card">
  <h3>📦 最近 7 天外盘 KV 归档文件检测</h3>
  <table>
    <tr><th>日期</th><th>KV Key</th><th>文件状态</th><th>体积</th></tr>
    ${archivesCheck.map(a => `<tr><td>${a.date}</td><td>foreign:1min:${a.date}</td><td><span class="badge ${a.exists ? 'badge-done' : 'badge-pending'}">${a.exists ? '✅ 存在' : '❌ 缺失'}</span></td><td>${a.sizeKb || '--'}</td></tr>`).join('')}
  </table>
</div>

<div class="card">
  <h3>📝 最近 50 条 Cron 调度与执行历史日志 (最新在前)</h3>
  ${logs.length === 0 ? '<p style="color:#8b949e;">暂无日志记录（Cron 触发后会自动写入）</p>' : `
  <table>
    <tr><th>北京时间</th><th>事件类型</th><th>日志信息</th><th>详情</th></tr>
    ${logs.map(l => `<tr><td>${l.time}</td><td><span class="badge badge-log">${l.type}</span></td><td>${l.msg}</td><td style="color:#8b949e;">${JSON.stringify(l.details)}</td></tr>`).join('')}
  </table>`}
</div>
</body>
</html>`;
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }

      return jsonResp(statusData);
    }
    if (url.pathname === "/api/watchlist") {
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      if (request.method === "GET") {
        const raw = await env.FUTURES_KV.get(WATCHLIST_KV_KEY);
        let list = null;
        if (raw) {
          try {
            list = JSON.parse(raw);
          } catch (e) {
            list = null;
          }
        }
        return jsonResp({ ok: true, list });
      }
      if (request.method === "POST") {
        try {
          const body = await request.json();
          if (!body || !Array.isArray(body.list)) {
            return jsonResp({ ok: false, error: "list 必须是合约代码数组" }, 400);
          }
          const sanitized = body.list.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()).slice(0, 200);
          await env.FUTURES_KV.put(WATCHLIST_KV_KEY, JSON.stringify(sanitized));
          return jsonResp({ ok: true, count: sanitized.length });
        } catch (e) {
          return jsonResp({ ok: false, error: e && e.message || String(e) }, 400);
        }
      }
      return jsonResp({ ok: false, error: "method not allowed" }, 405);
    }
    if (url.pathname === "/api/refresh") {
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      if (!checkToken(request, url, env)) return jsonResp({ ok: false, error: "forbidden" }, 403);
      try {
        const diff = await fetchLatestMarketDiff();
        if (!diff.length) return jsonResp({ ok: false, error: "行情接口返回空（可能休市/限流）" }, 502);
        const saved = await saveSnapshot(env, diff, 50);
        return jsonResp({ ok: true, count: saved.count, savedAt: saved.savedAt });
      } catch (e) {
        return jsonResp({ ok: false, error: e && e.message || String(e) }, 502);
      }
    }
    if (url.pathname === "/api/test/benchmark-cpu") {
      const overallStart = performance.now();
      let totalCpuMs = 0;

      // 1. 批量拉取 60+ 个合约（51 个内盘主流品种 + 8 个外盘主流 1 分钟分时全量）
      const domesticList = [
        "nf_FU2611","nf_FU2612","nf_SC2803","nf_AG2702","nf_AU2702","nf_RB2701","nf_HC2701",
        "nf_CU2701","nf_AL2701","nf_ZN2701","nf_NI2701","nf_SN2701","nf_SS2701","nf_AO2701",
        "nf_I2701","nf_J2701","nf_JM2701","nf_M2701","nf_Y2701","nf_P2701","nf_C2701",
        "nf_CS2701","nf_A2701","nf_B2701","nf_L2701","nf_V2701","nf_PP2701","nf_EG2701",
        "nf_EB2701","nf_PG2701","nf_LH2701","nf_JD2701","nf_OI2701","nf_TA2701","nf_MA2701",
        "nf_FG2701","nf_SA2701","nf_RM2701","nf_SR2701","nf_CF2701","nf_CY2701","nf_AP2701",
        "nf_CJ2701","nf_UR2701","nf_PF2701","nf_PK2701","nf_PX2701","nf_SH2701","nf_SF2701",
        "nf_SI2701","nf_LC2701"
      ];
      const foreignSymbols = ["CL", "GC", "SI", "HG", "OIL", "NG", "CAD", "ZSD"];

      // 网络拉取 (并行 fetch，不计入 CPU 耗时)
      const fetchStart = performance.now();
      const [domResp, ...foreignResps] = await Promise.all([
        fetch("https://hq.sinajs.cn/list=" + domesticList.join(","), {
          headers: { "Referer": "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0" }
        }),
        ...foreignSymbols.map(sym => 
          fetch(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_bench=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=${sym}`, {
            headers: { "Referer": "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0" }
          }).then(r => r.text()).catch(() => "")
        )
      ]);
      const domText = domResp.ok ? await domResp.text() : "";
      const networkWallMs = performance.now() - fetchStart;

      // 2. CPU 计算测试阶段 A：解析并严格清洗 51 个内盘合约数据 (重复 50 次以击穿 V8 计时粗化限制，测出真实微秒级开销)
      const ITERATIONS = 50;
      const cpuAStart = performance.now();
      let sanitizedDomestic = [];
      for (let it = 0; it < ITERATIONS; it++) {
        sanitizedDomestic = [];
        const domLines = domText.split("\n");
        for (const line of domLines) {
          const m = line.match(/hq_str_(nf_\w+)=\"([^\"]+)\"/);
          if (!m) continue;
          const sym = m[1];
          const parts = m[2].split(",");
          if (parts.length < 15) continue;
          const price = parseFloat(parts[8]) || 0;
          const prevSettle = parseFloat(parts[10]) || 0;
          const vol = parseInt(parts[14]) || 0;
          if (price <= 0) continue; // 严格清洗
          const change = prevSettle > 0 ? (price - prevSettle) : 0;
          const changePercent = prevSettle > 0 ? (change / prevSettle) * 100 : 0;
          sanitizedDomestic.push({
            sym,
            name: parts[0],
            price,
            prevSettle,
            vol,
            open: parseFloat(parts[2]) || 0,
            high: parseFloat(parts[3]) || 0,
            low: parseFloat(parts[4]) || 0,
            change: parseFloat(change.toFixed(2)),
            changePct: parseFloat(changePercent.toFixed(2))
          });
        }
      }
      const cpuAMs = (performance.now() - cpuAStart) / ITERATIONS;
      totalCpuMs += cpuAMs;

      // 3. CPU 计算测试阶段 B：解析、验证、清洗外盘 1 分钟全量线 (重复 50 次测出真实单次耗时)
      const cpuBStart = performance.now();
      let sanitizedForeign = {};
      let totalForeignBars = 0;
      for (let it = 0; it < ITERATIONS; it++) {
        sanitizedForeign = {};
        totalForeignBars = 0;
        foreignSymbols.forEach((sym, idx) => {
          const rawText = foreignResps[idx] || "";
          const m = rawText.match(/\(\s*(\{[\s\S]*\})\s*\)/);
          if (!m) return;
          try {
            const json = JSON.parse(m[1]);
            const minLine = json.minLine_1d || [];
            const cleanBars = [];
            for (let i = 0; i < minLine.length; i++) {
              const bar = minLine[i];
              if (!bar || bar.length < 5) continue;
              const p = parseFloat(i === 0 ? bar[5] : bar[1]);
              const a = parseFloat(i === 0 ? bar[8] : bar[4]);
              if (isNaN(p) || p <= 0) continue; // 剔除异常价格
              cleanBars.push({
                t: i === 0 ? bar[9] : bar[5],
                p,
                a: isNaN(a) || a <= 0 ? p : a
              });
            }
            if (cleanBars.length > 0) {
              sanitizedForeign[sym] = cleanBars;
              totalForeignBars += cleanBars.length;
            }
          } catch (e) {}
        });
      }
      const cpuBMs = (performance.now() - cpuBStart) / ITERATIONS;
      totalCpuMs += cpuBMs;

      // 4. CPU 计算测试阶段 C：数据结构打包、序列化压缩
      const cpuCStart = performance.now();
      let serializedJson = "";
      for (let it = 0; it < ITERATIONS; it++) {
        const packedArchive = {
          benchmark: true,
          generatedAt: new Date().toISOString(),
          domesticCount: sanitizedDomestic.length,
          foreignContractCount: Object.keys(sanitizedForeign).length,
          foreignTotalBars: totalForeignBars,
          domestic: sanitizedDomestic,
          foreign: sanitizedForeign
        };
        serializedJson = JSON.stringify(packedArchive);
      }
      const cpuCMs = (performance.now() - cpuCStart) / ITERATIONS;
      totalCpuMs += cpuCMs;

      const totalWallMs = performance.now() - overallStart;

      return jsonResp({
        ok: true,
        summary: {
          testName: "Cloudflare Worker 10ms CPU & Data Cleaning Benchmark",
          totalContractsTested: domesticList.length + foreignSymbols.length,
          domesticSanitizedCount: sanitizedDomestic.length,
          foreignContractsSanitizedCount: Object.keys(sanitizedForeign).length,
          foreignTotalBarsCleaned: totalForeignBars,
          totalDataPointsVerified: sanitizedDomestic.length * 10 + totalForeignBars * 3,
          serializedSizeBytes: serializedJson.length,
          serializedSizeKb: (serializedJson.length / 1024).toFixed(2) + " KB"
        },
        timePerformance: {
          networkFetchWallMs: parseFloat(networkWallMs.toFixed(2)),
          totalWallClockMs: parseFloat(totalWallMs.toFixed(2)),
          pureCpuTimeMs: parseFloat(totalCpuMs.toFixed(3)),
          cloudflareFreeCpuLimitMs: 10,
          cpuUsagePercentageOfLimit: ((totalCpuMs / 10) * 100).toFixed(2) + "%",
          isWithin10msLimit: totalCpuMs < 10,
          safetyHeadroomMultiplier: (10 / Math.max(0.01, totalCpuMs)).toFixed(1) + "x safe"
        },
        cpuStageBreakdown: {
          domesticRegexAndSanitizeMs: parseFloat(cpuAMs.toFixed(3)),
          foreignJsonParseAndMinlineVerifyMs: parseFloat(cpuBMs.toFixed(3)),
          jsonStringifyPackMs: parseFloat(cpuCMs.toFixed(3))
        }
      });
    }
    if (!env.ASSETS) return new Response("Assets 未配置", { status: 500 });
    return env.ASSETS.fetch(request);
  },
  // ---- 统一单 Cron 状态机 (每 1 分钟调度，UTC+8 时区自愈重试) ----
  async scheduled(event, env, ctx) {
    if (!env.FUTURES_KV) {
      console.warn("[cron] KV 未绑定 FUTURES_KV，跳过");
      return;
    }
    const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
    const hours = bjNow.getUTCHours();
    const minutes = bjNow.getUTCMinutes();
    const hm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    const dayOfWeek = bjNow.getUTCDay(); // 0: 日, 1: 一, ..., 6: 六
    const dateStr = bjNow.toISOString().slice(0, 10);

    // 1. 外盘 CME 交易日收盘归档窗口 (北京时间 05:05 ~ 06:30，周二至周六早晨)
    // 周日和周一早晨美盘休市无新结算，周二~周六早晨收盘对应美盘上一交易日
    if (dayOfWeek >= 2 && dayOfWeek <= 6 && hm >= "05:05" && hm <= "06:30") {
      const prevTradingDay = new Date(Date.now() + 8 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
      const doneKey = `cron:done:foreign:${prevTradingDay}`;
      const isDone = await env.FUTURES_KV.get(doneKey);
      if (!isDone) {
        try {
          const saved = await archiveForeignFuturesDay(env, prevTradingDay);
          console.log(`[cron] 外盘 1 分钟分时全量归档成功 @ ${prevTradingDay}, 品种数: ${saved.symbols.length}`);
        } catch (e) {
          console.warn(`[cron] 外盘归档重试中 (${hm}):`, e && e.message || e);
        }
      }
    }

    // 2. 国内期货收盘快照窗口 (保存 snapshot:latest，确保休市和周末有权威基准价)
    // A) 日盘收盘：15:02 ~ 15:20 (周一至周五)
    // B) 夜盘收盘1：23:02 ~ 23:20 (周一至周五，橡胶/燃料油/沥青等)
    // C) 夜盘收盘2：01:02 ~ 01:20 (周二至周六，有色金属铜铝等)
    // D) 夜盘收盘3：02:32 ~ 02:50 (周二至周六，原油/贵金属金银)
    let cnBatchKey = null;
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && hm >= "15:02" && hm <= "15:20") cnBatchKey = "cn_day";
    else if (dayOfWeek >= 1 && dayOfWeek <= 5 && hm >= "23:02" && hm <= "23:20") cnBatchKey = "cn_night1";
    else if (dayOfWeek >= 2 && dayOfWeek <= 6 && hm >= "01:02" && hm <= "01:20") cnBatchKey = "cn_night2";
    else if (dayOfWeek >= 2 && dayOfWeek <= 6 && hm >= "02:32" && hm <= "02:50") cnBatchKey = "cn_night3";

    if (cnBatchKey) {
      const doneKey = `cron:done:${dateStr}:${cnBatchKey}`;
      const isDone = await env.FUTURES_KV.get(doneKey);
      if (!isDone) {
        try {
          const diff = await fetchSinaSnapshotRaw();
          if (diff && diff.length >= 50) {
            const saved = await saveSnapshot(env, diff, 50);
            await env.FUTURES_KV.put(doneKey, "1", { expirationTtl: 86400 * 2 });
            console.log(`[cron] 国内快照 (${cnBatchKey}) 已存 ${saved.count} 条 @ ${saved.savedAt}`);
          }
        } catch (e) {
          console.warn(`[cron] 国内快照重试中 (${cnBatchKey} @ ${hm}):`, e && e.message || e);
        }
      }
    }
  }
};

export {
  index_default as default,
  validateAndSanitizeDiff
};
