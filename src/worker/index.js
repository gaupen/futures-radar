var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker/index.js - Build: 2026-10-27-multi-market-v1
var CLIST_FS = "m:113,m:114,m:115,m:220,m:142,m:225";
var CLIST_FIELDS = "f12,f13,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18,f124";
var CLIST_UT = "bd1d9ddb04089700cf9c27f6f7426281";
var KV_KEY = "snapshot:latest";
var WATCHLIST_KV_KEY = "watchlist:global";

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

var CLIST_HOSTS = [
  "http://82.push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
  "http://push2delay.eastmoney.com",
  "https://push2delay.eastmoney.com",
  "https://push2.eastmoney.com"
];

async function fetchClistRaw() {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://quote.eastmoney.com/"
  };
  const errors = [];
  for (const host of CLIST_HOSTS) {
    const makeUrl = /* @__PURE__ */ __name((po) => host + "/api/qt/clist/get?pn=1&pz=100&po=" + po + "&np=1&fltt=2&invt=2&fid=f3&fs=" + CLIST_FS + "&fields=" + CLIST_FIELDS + "&ut=" + CLIST_UT + "&_t=" + Date.now(), "makeUrl");
    try {
      const resUp = await fetch(makeUrl(1), { headers });
      if (!resUp.ok) {
        errors.push(`${host} Up: ${resUp.status}`);
        continue;
      }
      const jsonUp = await resUp.json();
      await new Promise((r) => setTimeout(r, 150));
      const resDown = await fetch(makeUrl(0), { headers });
      if (!resDown.ok) {
        errors.push(`${host} Down: ${resDown.status}`);
        continue;
      }
      const jsonDown = await resDown.json();
      const diffUp = jsonUp && jsonUp.data && Array.isArray(jsonUp.data.diff) ? jsonUp.data.diff : [];
      const diffDown = jsonDown && jsonDown.data && Array.isArray(jsonDown.data.diff) ? jsonDown.data.diff : [];
      const map = /* @__PURE__ */ new Map();
      [...diffUp, ...diffDown].forEach((item) => {
        if (item && item.f12) {
          const secid = `${item.f13}.${item.f12}`;
          map.set(secid, item);
        }
      });
      const result = Array.from(map.values());
      if (result.length > 0) return result;
      errors.push(`${host}: empty merged result (Up: ${diffUp.length}, Down: ${diffDown.length})`);
    } catch (err) {
      errors.push(`${host}: ${err && err.message || err}`);
    }
  }
  throw new Error("All clist hosts failed: " + errors.join(" | "));
}
__name(fetchClistRaw, "fetchClistRaw");

async function fetchLatestMarketDiff() {
  try {
    const sinaDiff = await fetchSinaSnapshotRaw();
    if (sinaDiff && sinaDiff.length >= 50) {
      return sinaDiff;
    }
  } catch (err) {
    console.warn("[worker] Sina snapshot failed, fallback to EastMoney:", err && err.message || err);
  }
  return await fetchClistRaw();
}
__name(fetchLatestMarketDiff, "fetchLatestMarketDiff");

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
      list = list.split(",").map(sym => {
        const s = sym.trim();
        if (s.toLowerCase().startsWith("hf_")) return "hf_" + s.slice(3).toUpperCase();
        if (s.toLowerCase().startsWith("gb_")) return "gb_" + s.slice(3).toLowerCase();
        return s;
      }).join(",");
      try {
        const sinaResp = await fetch("https://hq.sinajs.cn/list=" + list, {
          headers: {
            "Referer": "https://finance.sina.com.cn",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          }
        });
        return new Response(sinaResp.body, {
          status: sinaResp.status,
          headers: {
            "content-type": "application/javascript; charset=gb18030",
            "cache-control": "no-cache, no-store",
            "access-control-allow-origin": "*"
          }
        });
      } catch (e) {
        return new Response("// error: " + (e && e.message || String(e)), { status: 502 });
      }
    }
    if (url.pathname === "/api/eastmoney/trends") {
      const secid = url.searchParams.get("secid");
      const ndays = url.searchParams.get("ndays") || "5";
      if (!secid) return jsonResp({ error: "missing secid" }, 400);

      // 1. 边缘缓存 (Cloudflare Edge Cache 15秒，命中 0ms 响应)
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      try {
        const cachedResp = await cache.match(cacheKey);
        if (cachedResp) return cachedResp;
      } catch (ce) {}

      // 2. 轮询东财多节点 (超时收紧为 1200ms 快速失败，绝不空转拖垮系统)
      const hosts = [
        "https://push2his.eastmoney.com",
        "https://82.push2.eastmoney.com",
        "https://push2.eastmoney.com"
      ];
      for (const h of hosts) {
        try {
          const emUrl = `${h}/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=${ndays}`;
          const emResp = await fetch(emUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://quote.eastmoney.com/"
            },
            signal: AbortSignal.timeout(1200)
          });
          if (emResp.ok) {
            const data = await emResp.text();
            if (data && data.includes('"trends"')) {
              const respToCache = new Response(data, {
                status: 200,
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  "access-control-allow-origin": "*",
                  "cache-control": "public, max-age=15"
                }
              });
              if (ctx && typeof ctx.waitUntil === 'function') {
                ctx.waitUntil(cache.put(cacheKey, respToCache.clone()));
              }
              return respToCache;
            }
          }
        } catch (e) {
          // try next host quickly
        }
      }
      return jsonResp({ error: "all eastmoney hosts failed" }, 502);
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
  // ---- Cron：15:05 / 23:35 / 02:35（北京时间）自动抓收盘存快照 (新浪主力 + 东财备用) ----
  async scheduled(event, env, ctx) {
    try {
      if (!env.FUTURES_KV) {
        console.warn("[cron] KV 未绑定，跳过");
        return;
      }
      const diff = await fetchLatestMarketDiff();
      if (!diff.length) {
        console.warn("[cron] 行情接口返回空，跳过（可能休市/限流）");
        return;
      }
      const saved = await saveSnapshot(env, diff, 50);
      console.log("[cron] 快照已存", saved.count, "条 @", saved.savedAt, "trigger:", event.cron);
    } catch (e) {
      console.error("[cron] 抓取失败：", e && e.message || e);
    }
  }
};

export {
  index_default as default,
  validateAndSanitizeDiff
};
