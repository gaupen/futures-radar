var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker/index.js
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

async function saveSnapshot(env, diff, minCount = 100) {
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
          const sanitized = body.list.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().toLowerCase()).slice(0, 200);
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
        const diff = await fetchClistRaw();
        if (!diff.length) return jsonResp({ ok: false, error: "clist 返回空（可能休市/限流）" }, 502);
        const saved = await saveSnapshot(env, diff, 100);
        return jsonResp({ ok: true, count: saved.count, savedAt: saved.savedAt });
      } catch (e) {
        return jsonResp({ ok: false, error: e && e.message || String(e) }, 502);
      }
    }
    if (!env.ASSETS) return new Response("Assets 未配置", { status: 500 });
    return env.ASSETS.fetch(request);
  },
  // ---- Cron：15:05 / 23:35 / 02:35（北京时间）自动抓收盘存快照 ----
  async scheduled(event, env, ctx) {
    try {
      if (!env.FUTURES_KV) {
        console.warn("[cron] KV 未绑定，跳过");
        return;
      }
      const diff = await fetchClistRaw();
      if (!diff.length) {
        console.warn("[cron] clist 返回空，跳过（可能休市/限流）");
        return;
      }
      const saved = await saveSnapshot(env, diff, 100);
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
