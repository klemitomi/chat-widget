// abuse-guard.js — KÖZÖS visszaélés-védelem minden végponthoz, ahol a látogató valamit generáltat vagy levelet indít.
//
// Mit ad:
//   guardLimit({bucket,max,windowSec,immediate})  IP-nkénti, újraindítás-álló korlát (sikeres/hibás kérés külön számolva)
//   guardDaily(bucket, max)                       napi plafon az egész szerverre, újraindítás-álló
//   emailPolicy(email)                            eldobható domain, e-mailenkénti és domainenkénti ismétlés-korlát
//   speedOk(fillMs)                               túl gyorsan (robotként) kitöltött űrlap kiszűrése
//   addLead / leadFlowRouter                      e-mail megerősítés (double opt-in) + napi összesítő a meg nem erősítettekről
//
// Tárolás: Supabase `guard` séma (RPC-n át, titkos kulccsal). Ha az env nincs beállítva vagy a Supabase nem
// elérhető, memóriában számol tovább (nem áll le a szolgáltatás) — ilyenkor a számlálók újraindításkor elvesznek.
//
// ÚJ GENERÁTORHOZ / VÉGPONTHOZ (pl. AI telefonos asszisztens foglalás/hívásindítás): lásd PLAYBOOK.md "Új végpont védelme".

import express from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { clientIp } from "./client-ip.js";

const require = createRequire(import.meta.url);
const DISPOSABLE = new Set();
const DISPOSABLE_WILD = [];
try { for (const d of require("disposable-email-domains")) DISPOSABLE.add(d); } catch (e) { console.warn("disposable list unavailable:", e.message); }
try { for (const d of require("disposable-email-domains/wildcard.json")) DISPOSABLE_WILD.push(d); } catch {}
// kézzel bővíthető: DISPOSABLE_EXTRA="a.com,b.com"
for (const d of String(process.env.DISPOSABLE_EXTRA || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) DISPOSABLE.add(d);

const SB_URL = (process.env.GUARD_SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.GUARD_SUPABASE_KEY || "";
const SB_SECRET = process.env.GUARD_SECRET || "";
export const persistent = Boolean(SB_URL && SB_KEY && SB_SECRET);
const HMAC_KEY = process.env.GUARD_HMAC_KEY || "";
const API_BASE = (process.env.PUBLIC_API_URL || "https://chat-widget-ggyi.onrender.com").replace(/\/$/, "");

export const h = (s) => createHash("sha256").update(String(s).toLowerCase()).digest("hex").slice(0, 24);

async function rpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: SB_SECRET, ...args }),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---- memória-tartalék ----
const mem = new Map(); // `${bucket}|${key}` -> [ms]
const memCount = (bucket, key, windowSec) => {
  const k = `${bucket}|${key}`;
  const cut = Date.now() - windowSec * 1000;
  const arr = (mem.get(k) || []).filter((t) => t > cut);
  mem.set(k, arr);
  return arr.length;
};
const memHit = (bucket, key) => {
  if (mem.size > 20000) mem.clear();
  const k = `${bucket}|${key}`;
  mem.set(k, [...(mem.get(k) || []), Date.now()]);
};
let lastErr = 0;
const warnOnce = (e) => { if (Date.now() - lastErr > 60000) { lastErr = Date.now(); console.warn("abuse-guard store:", e.message); } };

export async function count(bucket, key, windowSec) {
  if (persistent) {
    try { return Number(await rpc("guard_count", { p_bucket: bucket, p_key: key, p_window_sec: windowSec })) || 0; } catch (e) { warnOnce(e); }
  }
  return memCount(bucket, key, windowSec);
}
export async function hit(bucket, key) {
  memHit(bucket, key);
  if (persistent) { try { await rpc("guard_hit", { p_bucket: bucket, p_key: key }); } catch (e) { warnOnce(e); } }
}

// ---- korlátok ----
export function guardLimit({ bucket, max, windowSec, maxFails = 20, immediate = false }) {
  return async (req, res, next) => {
    try {
      const k = h(clientIp(req));
      const [oks, fails] = await Promise.all([count(bucket, k, windowSec), count(`${bucket}:fail`, k, windowSec)]);
      if (oks >= max || fails >= maxFails) return res.status(429).json({ error: "rate_limited" });
      const once = (b) => { let done = false; return () => { if (done) return Promise.resolve(); done = true; return hit(b, k); }; };
      req.countHit = once(bucket);
      req.countFail = once(`${bucket}:fail`);
      if (immediate) await req.countHit();
      next();
    } catch (e) { next(e); }
  };
}

export function guardDaily(bucket, max) {
  return async (req, res, next) => {
    try {
      if ((await count(`daily:${bucket}`, "all", 86400)) >= max) return res.status(429).json({ error: "daily_limit" });
      await hit(`daily:${bucket}`, "all");
      next();
    } catch (e) { next(e); }
  };
}

// Ugyanaz, mint a guardDaily, de middleware nélkül: igaz/hamis (és fogyaszt, ha igaz)
export async function dailyOk(bucket, max) {
  if ((await count(`daily:${bucket}`, "all", 86400)) >= max) return false;
  await hit(`daily:${bucket}`, "all");
  return true;
}

// ---- e-mail szabályok ----
const MAJOR = new Set(["gmail.com", "googlemail.com", "freemail.hu", "citromail.hu", "outlook.com", "outlook.hu", "hotmail.com", "hotmail.hu", "live.com", "live.hu", "yahoo.com", "icloud.com", "me.com", "vipmail.hu", "t-online.hu", "mailbox.hu", "protonmail.com", "proton.me", "invitel.hu", "upcmail.hu", "pr.hu"]);
const domainOf = (email) => String(email).split("@").pop().toLowerCase().trim();
export function isDisposable(email) {
  const d = domainOf(email);
  return DISPOSABLE.has(d) || DISPOSABLE_WILD.some((w) => d === w || d.endsWith(`.${w}`));
}
// Null = rendben; különben az elutasítás oka. NEM rögzít semmit (a rögzítést a noteEmail végzi, ha a kérés elfogadva lett).
export async function emailPolicy(email, { perEmail = 2, perDomain = 4, windowSec = 86400 } = {}) {
  if (isDisposable(email)) return "disposable";
  if ((await count("em", h(email), windowSec)) >= perEmail) return "email_repeat";
  const d = domainOf(email);
  if (!MAJOR.has(d) && (await count("dom", h(d), windowSec)) >= perDomain) return "domain_repeat";
  return null;
}
export async function noteEmail(email) {
  await Promise.all([hit("em", h(email)), hit("dom", h(domainOf(email)))]);
}

// Az űrlap kitöltési ideje (ms): ha a frontend küldi és irreálisan kicsi, robot. Ha nem küldi (régi frontend), átengedjük.
export function speedOk(fillMs, minMs = 1500) {
  if (fillMs === undefined || fillMs === null) return true;
  const n = Number(fillMs);
  return Number.isFinite(n) && n >= minMs;
}

// ---- megerősítő link (aláírt) ----
const sign = (id) => createHmac("sha256", HMAC_KEY).update(String(id)).digest("hex").slice(0, 32);
export const confirmUrl = (id) => `${API_BASE}/api/lead/confirm?id=${encodeURIComponent(id)}&sig=${sign(id)}`;
const sigOk = (id, sig) => {
  if (!HMAC_KEY || !id || !sig) return false;
  const a = Buffer.from(sign(id)), b = Buffer.from(String(sig));
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function addLead({ email, name, source, payload }) {
  if (!persistent) return null;
  try {
    return await rpc("guard_lead_add", { p_email_hash: email ? h(email) : null, p_email: email || null, p_name: name || null, p_source: source || null, p_payload: payload || {} });
  } catch (e) { warnOnce(e); return null; }
}

export async function sendResend(payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
}

const page = (title, body) => `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}main{max-width:30rem;text-align:center}button{background:#06b6d4;border:0;color:#04121a;font-weight:700;padding:.8rem 1.4rem;border-radius:.6rem;font-size:1rem;cursor:pointer}a{color:#67e8f9}</style></head><body><main>${body}</main></body></html>`;

// onConfirmed(row): Tamásnak azonnali levél; renderDigest(rows): { subject, html } vagy null
export function leadFlowRouter({ onConfirmed, renderDigest }) {
  const r = express.Router();
  r.get("/lead/confirm", (req, res) => {
    const id = String(req.query.id || ""), sig = String(req.query.sig || "");
    res.set("Cache-Control", "no-store");
    if (!sigOk(id, sig)) return res.status(400).send(page("Érvénytelen link", "<h1>Érvénytelen link</h1><p>A megerősítő link hibás vagy lejárt.</p>"));
    // Szándékosan külön gombnyomás kell: a levélszkennerek is megnyitják a linkeket, de nem nyomnak gombot.
    res.send(page("Megerősítés", `<h1>Megerősítés</h1><p>Köszönöm! Nyomd meg a gombot, és megkeresem az ötletemmel.</p><form method="post" action="/api/lead/confirm"><input type="hidden" name="id" value="${id.replace(/[^a-f0-9-]/gi, "")}"><input type="hidden" name="sig" value="${sig.replace(/[^a-f0-9]/gi, "")}"><button>Megerősítem</button></form>`));
  });
  r.post("/lead/confirm", express.urlencoded({ extended: false, limit: "2kb" }), async (req, res) => {
    const id = String(req.body?.id || ""), sig = String(req.body?.sig || "");
    res.set("Cache-Control", "no-store");
    if (!sigOk(id, sig)) return res.status(400).send(page("Érvénytelen link", "<h1>Érvénytelen link</h1>"));
    try {
      const row = persistent ? await rpc("guard_lead_confirm", { p_id: id }) : null;
      if (row) await onConfirmed(row).catch((e) => console.error("lead confirmed mail error", e.message));
    } catch (e) { warnOnce(e); }
    res.send(page("Köszönöm", "<h1>Köszönöm, megvan!</h1><p>Hamarosan jelentkezem.</p><p><a href=\"https://klementforge.com\">klementforge.com</a></p>"));
  });
  // Napi összesítő: a Supabase pg_cron hívja (x-internal-key fejléccel)
  r.post("/internal/digest", async (req, res) => {
    const key = process.env.INTERNAL_KEY || "";
    const got = String(req.get("x-internal-key") || "");
    if (!key || got.length !== key.length || !timingSafeEqual(Buffer.from(got), Buffer.from(key))) return res.status(401).json({ error: "unauthorized" });
    let rows = [];
    try { rows = persistent ? (await rpc("guard_digest_take", {})) || [] : []; } catch (e) { warnOnce(e); return res.status(502).json({ error: "store" }); }
    if (!rows.length) return res.json({ ok: true, sent: 0 });
    try {
      const m = renderDigest(rows);
      if (m) await sendResend({ from: "KlementForge weboldal-előnézet <ai@klementforge.com>", to: process.env.LEAD_TO || "info@klementforge.com", ...m });
      res.json({ ok: true, sent: rows.length });
    } catch (e) {
      console.error("digest mail error", e.message, JSON.stringify(rows.map((x) => ({ n: x.name, c: x.payload?.contact, t: x.payload?.trade }))));
      res.status(502).json({ error: "mail_failed" });
    }
  });
  return r;
}
