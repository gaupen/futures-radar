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
