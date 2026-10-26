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
    if (url.pathname === "/api/history/foreign-min") {
      if (!env.FUTURES_KV) return jsonResp({ ok: false, error: "KV 未绑定 FUTURES_KV" }, 500);
      const rawSym = url.searchParams.get("symbol") || url.searchParams.get("secid");
      if (!rawSym) return jsonResp({ ok: false, error: "缺少 symbol 参数" }, 400);
      const pureSym = rawSym.replace(/^hf_/i, "").toUpperCase();

      // 获取最近 4 个有效归档日 (排除周日)
      const targetDates = [];
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() + 8 * 3600 * 1000 - i * 86400 * 1000);
        if (d.getUTCDay() !== 0) {
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
    // 周日和周一早晨美盘休市无新结算，周二~周六收盘对应美盘上一交易日
    if (dayOfWeek >= 2 && dayOfWeek <= 6 && hm >= "05:05" && hm <= "06:30") {
      const doneKey = `cron:done:foreign:${dateStr}`;
      const isDone = await env.FUTURES_KV.get(doneKey);
      if (!isDone) {
        try {
          const saved = await archiveForeignFuturesDay(env, dateStr);
          console.log(`[cron] 外盘 1 分钟分时全量归档成功 @ ${dateStr}, 品种数: ${saved.symbols.length}`);
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
