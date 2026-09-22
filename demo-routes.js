// demo-routes.js — AI-demók és AI-felmérés végpontjai a meglévő chat-backendhez
// Nincs új függőség: a szerver már most is natív fetch-csel hívja az Anthropic API-t és a Resendet.
//
// Bekötés a server.js-ben (az app.use(cors(...)) sor után):
//   import demoRoutes from "./demo-routes.js";
//   app.use("/api", demoRoutes);
// Szükséges környezeti változók (Render → Environment): ANTHROPIC_API_KEY, RESEND_API_KEY
// Opcionális: LEAD_TO (alapból info@klementforge.com)
// A Resendben a klementforge.com domainnek hitelesítettnek kell lennie az ai@klementforge.com feladóhoz.

import express from "express";
import { TOOLS, clip } from "./demo-prompts.js";

const router = express.Router();
const MODEL = "claude-haiku-4-5-20251001";

// Egyszerű, függőség nélküli limitálás IP-nként + napi plafon (költségvédelem)
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = `${max}:${req.headers["x-forwarded-for"]?.split(",")[0] || req.ip}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: "rate_limited" });
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => hits.clear(), 6 * 60 * 60 * 1000).unref();

let daily = { day: new Date().toDateString(), count: 0 };
function dailyCap(req, res, next) {
  const today = new Date().toDateString();
  if (daily.day !== today) daily = { day: today, count: 0 };
  if (++daily.count > 300) return res.status(429).json({ error: "daily_limit" });
  next();
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("bad_json");
}

router.post("/demo", limit(20, 10 * 60 * 1000), dailyCap, async (req, res) => {
  const tool = TOOLS[req.body?.tool];
  if (!tool) return res.status(400).json({ error: "unknown_tool" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: tool.max, system: tool.system, messages: tool.messages(req.body.input || {}) }),
    });
    const data = await r.json();
    if (!data.content) throw new Error(JSON.stringify(data).slice(0, 300));
    const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    res.json({ result: parseJson(text) });
  } catch (e) {
    console.error("demo error", req.body?.tool, e.message);
    res.status(502).json({ error: "ai_unavailable" });
  }
});

const esc = (s) => clip(s, 300).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function sendMail(payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
}

router.post("/lead", limit(5, 60 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const email = clip(b.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || b.consent !== true) return res.status(400).json({ error: "invalid" });
  const hours = Number(b.estimateHours) || 0;
  const answers = Object.entries(b.answers || {}).slice(0, 10).map(([q, a]) => `<li>${esc(q)}<br><b>${esc(a)}</b></li>`).join("");
  const recs = (Array.isArray(b.recommended) ? b.recommended : []).slice(0, 3).map(esc).join(", ");
  try {
    await sendMail({
      from: "KlementForge AI-felmérés <ai@klementforge.com>",
      to: process.env.LEAD_TO || "info@klementforge.com",
      reply_to: email,
      subject: `Új AI-felmérés: ${clip(b.company || b.name, 80)} (kb. ${hours} óra/hó)`,
      html: `<p><b>${esc(b.name)}</b> (${esc(email)}), ${esc(b.company)}</p><p>Becslés: kb. ${hours} óra/hó. Javasolt: ${recs}</p><ol>${answers}</ol>`,
    });
    await sendMail({
      from: "Klement Tamás <ai@klementforge.com>",
      to: email,
      subject: "Megkaptam az AI-felmérésed",
      html: `<p>Szia ${esc(b.name)}!</p><p>Köszönöm, hogy kitöltötted a felmérést. A becslés szerint kb. <b>${hours} óra</b> rutinmunkát vehetne le rólad havonta az AI, leginkább itt: ${recs}.</p><p>Két munkanapon belül küldöm a személyre szabott tervet, konkrét lépésekkel és árakkal. Ha addig kérdésed van, válaszolj erre a levélre.</p><p>Tamás<br>KlementForge</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("lead error", e.message);
    res.status(502).json({ error: "mail_failed" });
  }
});

export default router;
