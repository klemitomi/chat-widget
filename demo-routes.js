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
import { clientIp, dailyLimiter } from "./client-ip.js";
import { emailDomainOk } from "./email-check.js";
import { guardLimit, guardDaily, dailyOk, emailPolicy, noteEmail, speedOk } from "./abuse-guard.js";
import { isGibberishEmail, isBlockedText, isInjectionAttempt } from "./content-guard.js";

// A felmérés visszaigazoló levele idegen címre megy: napi plafon, hogy ne lehessen spamre használni a domaint
const confirmDaily = dailyLimiter(Number(process.env.LEAD_CONFIRM_DAILY_MAX || 20));
const leadDaily = dailyLimiter(Number(process.env.LEAD_DAILY_MAX || 40));

const router = express.Router();
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Közös, újraindítás-álló limitálás (abuse-guard.js): IP-nként, a kérés beérkezésekor számol
const limit = (max, windowMs, bucket) => guardLimit({ bucket, max, windowSec: Math.round(windowMs / 1000), immediate: true });
const dailyCap = guardDaily("demo", Number(process.env.DEMO_DAILY_MAX || 300));
const ttsDailyReq = guardDaily("tts", Number(process.env.TTS_DAILY_REQ || 400));

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("bad_json");
}

router.post("/demo", limit(20, 10 * 60 * 1000, "demo"), dailyCap, async (req, res) => {
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
      body: JSON.stringify({ model: tool.model || DEFAULT_MODEL, max_tokens: tool.max, system: tool.system, messages: tool.messages(req.body.input || {}) }),
    });
    const data = await r.json();
    if (!data.content) throw new Error(JSON.stringify(data).slice(0, 300));
    const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    let result;
    try { result = parseJson(text); }
    catch {
      // Telefonos demónál a sima szöveges válasz is használható, ne szakadjon meg a hívás
      if (req.body.tool === "phone" && text.trim()) {
        console.warn("demo phone: plain-text reply, wrapped");
        result = { reply: text.trim().slice(0, 600), fields: {}, done: false };
      } else {
        throw new Error(`bad_json (stop: ${data.stop_reason}): ${text.slice(0, 200)}`);
      }
    }
    res.json({ result });
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

router.post("/lead", limit(5, 60 * 60 * 1000, "dlead"), async (req, res) => {
  const b = req.body || {};
  const email = clip(b.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || b.consent !== true) return res.status(400).json({ error: "invalid" });
  if (b.website) return res.json({ ok: true }); // honeypot
  if (!speedOk(b.fillMs)) return res.json({ ok: true }); // túl gyorsan kitöltve: robot
  if (isGibberishEmail(email) || isBlockedText(b.name, b.company) || isInjectionAttempt(b.name, b.company)) return res.status(400).json({ error: "invalid" });
  if (!(await emailDomainOk(email))) return res.status(400).json({ error: "invalid_email" });
  const why = await emailPolicy(email);
  if (why) return res.status(why === "disposable" ? 400 : 429).json({ error: why === "disposable" ? "invalid_email" : "rate_limited" });
  if (!leadDaily()) return res.status(429).json({ error: "daily_limit" });
  const hours = Math.max(0, Math.min(999, Math.round(Number(b.estimateHours) || 0)));
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
    // Visszaigazolás a kitöltőnek — csak a napi keretig; utána Tamás kézzel válaszol (az értesítő úgyis megjött)
    if (confirmDaily()) await sendMail({
      from: "Klement Tamás <ai@klementforge.com>",
      to: email,
      subject: "Megkaptam az AI-felmérésed",
      html: `<p>Szia ${esc(b.name)}!</p><p>Köszönöm, hogy kitöltötted a felmérést. A becslés szerint kb. <b>${hours} óra</b> rutinmunkát vehetne le rólad havonta az AI, leginkább itt: ${recs}.</p><p>Két munkanapon belül küldöm a személyre szabott tervet, konkrét lépésekkel és árakkal. Ha addig kérdésed van, válaszolj erre a levélre.</p><p>Tamás<br>KlementForge</p>`,
    });
    await noteEmail(email);
    res.json({ ok: true });
  } catch (e) {
    console.error("lead error", e.message);
    res.status(502).json({ error: "mail_failed" });
  }
});

// ---- Természetes magyar hang: Microsoft Azure (Noémi) vagy ElevenLabs ----
// Azure (ingyenes F0 keret): AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (pl. westeurope)
//   opcionális: AZURE_VOICE (alapból hu-HU-NoemiNeural; férfihang: hu-HU-TamasNeural)
// ElevenLabs (fizetős csomaggal): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, opcionális ELEVENLABS_MODEL
// Ha mindkettő be van állítva, az ElevenLabs az elsődleges. Ha egyik sincs, 503 jön,
// és a weboldal azonnal a böngésző hangjára vált.
// Opcionális: TTS_DAILY_CHARS (napi karakterplafon, alapból 20000)
const ttsCache = new Map(); // ugyanaz a mondat (köszönés, minta hívás) nem fogyaszt újra keretet
let ttsDaily = { day: new Date().toDateString(), chars: 0 };
const xmlEsc = (s) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

async function ttsElevenLabs(text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5",
      language_code: "hu",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function ttsAzure(text) {
  const region = process.env.AZURE_SPEECH_REGION || "westeurope";
  const voice = process.env.AZURE_VOICE || "hu-HU-NoemiNeural";
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="hu-HU"><voice name="${voice}"><prosody rate="0%">${xmlEsc(text)}</prosody></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "klementforge-demo",
    },
    body: ssml,
  });
  if (!r.ok) throw new Error(`Azure ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

function ttsProvider() {
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) return ttsElevenLabs;
  if (process.env.AZURE_SPEECH_KEY) return ttsAzure;
  return null;
}

router.post("/tts", limit(40, 10 * 60 * 1000, "tts"), ttsDailyReq, async (req, res) => {
  const provider = ttsProvider();
  if (!provider) return res.status(503).json({ error: "tts_disabled" });
  const text = clip(req.body?.text, 400).trim();
  if (!text) return res.status(400).json({ error: "empty" });

  const send = (buf) => res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" }).send(buf);
  const cached = ttsCache.get(text);
  if (cached) return send(cached);

  const today = new Date().toDateString();
  if (ttsDaily.day !== today) ttsDaily = { day: today, chars: 0 };
  if (ttsDaily.chars + text.length > Number(process.env.TTS_DAILY_CHARS || 20000)) return res.status(429).json({ error: "tts_daily_limit" });

  try {
    const buf = await provider(text);
    ttsDaily.chars += text.length;
    if (ttsCache.size > 300) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(text, buf);
    send(buf);
  } catch (e) {
    console.error("tts error", e.message);
    res.status(502).json({ error: "tts_unavailable" });
  }
});

export default router;
