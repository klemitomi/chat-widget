// site-preview.js — "Lásd a weboldalad 1 perc alatt" demó az /ai-szolgaltatasok oldalra
//
// POST /api/site-preview        { trade, city?, company?, language? }  -> { preview, image, live }
// POST /api/site-preview/refine { preview, instruction, language }  -> { preview, image?, note }
// POST /api/site-preview/lead   { name, contact, consent, trade, city, company, preview, language }
//
// A modell CSAK strukturált tartalmat ad (JSON), HTML-t soha. A megjelenítés a weboldal
// előre megtervezett sablonjában történik, így mindig igényes és biztonságos.
//
// Környezeti változók (Render → Environment):
//   ANTHROPIC_API_KEY  (már megvan)
//   UNSPLASH_ACCESS_KEY ingyenes: https://unsplash.com/oauth/applications (Access Key)
//   PEXELS_API_KEY      opcionális tartalék. Ha egyik sincs: kép nélküli, sötét fejléc
//   RESEND_API_KEY     (már megvan) — lead e-mailhez
//   LEAD_TO            opcionális, alapból info@klementforge.com
//   SITE_PREVIEW_MOCK=1  teszt mód: nincs Anthropic- és Pexels-hívás, mintaválasz jön
//   SITE_PREVIEW_DAILY   napi plafon az összes generálásra (alapból 60)
//   SITE_PREVIEW_PER_IP  generálás / IP / 24 óra (alapból 3)
//   SITE_PREVIEW_REFINE_PER_IP  módosítás / IP / 24 óra (alapból 6)

import express from "express";
import { clip, HU_STYLE } from "./demo-prompts.js";

const router = express.Router();
const MODEL = process.env.SITE_PREVIEW_MODEL || "claude-sonnet-5";

// A frontend ugyanezt a listát ismeri (react-icons) — a modell csak ezek közül választhat
export const ICONS = ["tools", "home", "truck", "leaf", "heart", "star", "shield", "clock", "chat", "calendar", "camera", "cut", "food", "car", "bolt", "drop", "paint", "hammer", "people", "book"];
export const ACCENTS = ["cyan", "amber", "emerald", "rose", "violet", "orange"];

// ---- Limitálás (memóriában, függőség nélkül) --------------------------------
const perIp = new Map();
function ipOf(req) { return req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip; }
function limitPerIp(max, windowMs, bucket) {
  return (req, res, next) => {
    const key = `${bucket}:${ipOf(req)}`;
    const now = Date.now();
    const list = (perIp.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: "rate_limited" });
    list.push(now);
    perIp.set(key, list);
    next();
  };
}
setInterval(() => perIp.clear(), 24 * 60 * 60 * 1000).unref();

let daily = { day: new Date().toDateString(), count: 0 };
function dailyCap(req, res, next) {
  const today = new Date().toDateString();
  if (daily.day !== today) daily = { day: today, count: 0 };
  if (daily.count >= Number(process.env.SITE_PREVIEW_DAILY || 60)) return res.status(429).json({ error: "daily_limit" });
  daily.count++;
  next();
}

// ---- Prompt ----------------------------------------------------------------
function systemPrompt(lang) {
  return `You write the content of a one-page website DRAFT for a small business, based on a few words from the owner.
${rules(lang)}`;
}

function rules(lang) {
  const en = lang === "en";
  return `Output language: ${en ? "English" : "Hungarian (magyar), tegező helyett semleges/többes számú megszólítás a látogató felé (pl. \"Kérjen ajánlatot\")"}.

STRICT HONESTY RULES (most important):
- Never invent facts: no years of experience, customer counts, ratings, awards, certificates, guarantees, prices, opening hours, addresses, phone numbers, e-mails or testimonials.
- Never say anything is free, discounted, fast/same-day or available in a given area. The hero CTA is a neutral request like "Kérjen ajánlatot" / "Get in touch".
- Only describe what the business plausibly offers based on its trade. Keep claims general and modest.
- If a company name is not given, use "brand": null (the page will show the trade instead). Do not make up a name.

STYLE RULES:
- Sound like a real local business owner, not a marketing agency. Concrete, simple, warm.
- Avoid clichés and template phrases (e.g. "minőség és megbízhatóság", "ügyfeleink elégedettsége az első", "vigyük együtt sikerre", "one-stop shop").
- Do NOT use the "nem X, hanem Y" / "not X, but Y" construction. Use at most one dash (—) in the whole output.
- Short sentences. Hero title max 8 words.
${en ? "" : HU_STYLE}

Return ONLY JSON, no markdown:
{"brand":string|null,
 "hero":{"title":string,"subtitle":string,"cta":string},
 "services":[{"title":string,"text":string,"icon":string}] (exactly 3, text max 22 words, icon one of: ${ICONS.join(", ")}),
 "why":[string,string,string] (each max 10 words, concrete working practices like "Felmérés helyben, ajánlat írásban", no numbers),
 "about":string (max 40 words, no invented facts),
 "contactCta":string (one short line inviting contact),
 "accent":string (one of: ${ACCENTS.join(", ")} — fits the trade),
 "imageQuery":string (2-4 English words for a stock photo search showing the work itself, e.g. "wrought iron gate", "hair salon interior")}`;
}

function refinePrompt(lang) {
  return `You revise an existing one-page website DRAFT for a small business. The owner tells you what to change.
- Apply the requested change and keep everything else as it was.
- The owner MAY state real facts about their own business in the request (for example years in business, a company name, a service they offer). You may use exactly what they stated, nothing more.
- If the request asks for a different photo, or the topic of the photo should change, set "newImage": true and give a fitting "imageQuery".
- If the request is unrelated to the website or impossible, keep the draft unchanged and explain briefly in "note".
- Add a field "note": one short sentence to the owner, in the output language, saying what you changed (no greeting, no praise).
${rules(lang)}
Also include: "newImage": boolean, "note": string.`;
}

function userPrompt({ trade, city, company }) {
  return `Trade / what the business does: ${trade}
${city ? `Town: ${city}` : "Town: not given (do not mention any town)"}
${company ? `Company name: ${company}` : "Company name: not given"}`;
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("bad_json");
}

// A modell kimenetét mindig megtisztítjuk: hossz, típus, engedélyezett ikon/szín
function sanitize(p, input) {
  const s = (v, n) => clip(typeof v === "string" ? v : "", n).trim();
  const services = (Array.isArray(p.services) ? p.services : []).slice(0, 3).map((x) => ({
    title: s(x?.title, 60),
    text: s(x?.text, 200),
    icon: ICONS.includes(x?.icon) ? x.icon : "tools",
  })).filter((x) => x.title);
  return {
    brand: s(input.company, 60) || s(p.brand, 60) || null,
    hero: { title: s(p.hero?.title, 90), subtitle: s(p.hero?.subtitle, 220), cta: s(p.hero?.cta, 40) },
    services,
    why: (Array.isArray(p.why) ? p.why : []).slice(0, 3).map((w) => s(w, 90)).filter(Boolean),
    about: s(p.about, 320),
    contactCta: s(p.contactCta, 120),
    accent: ACCENTS.includes(p.accent) ? p.accent : "cyan",
    imageQuery: s(p.imageQuery, 60).replace(/[^\w\s-]/g, ""),
    trade: s(input.trade, 80),
    city: s(input.city, 60),
  };
}

// ---- Kép: Unsplash (elsődleges), Pexels (tartalék) ---------------------------
// Unsplash szabályok: a visszakapott URL-t közvetlenül kell beágyazni (hotlink),
// használatkor jelezni kell a download_location végponton, és fel kell tüntetni
// a fotóst + az Unsplash-t utm paraméteres linkkel.
const UTM = "utm_source=klementforge&utm_medium=referral";
const withUtm = (u) => (u ? `${u}${u.includes("?") ? "&" : "?"}${UTM}` : u);
const imgCache = new Map();

async function fromUnsplash(query, exclude) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape&content_filter=high`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`Unsplash ${r.status}`);
  const all = (await r.json()).results || [];
  const list = all.filter((x) => !exclude || !String(exclude).startsWith(x.urls?.raw || "\u0000"));
  if (!list.length) return null;
  const ph = list[Math.floor(Math.random() * Math.min(exclude ? 5 : 3, list.length))];
  // Kötelező letöltés-jelzés (csak statisztika, nem várjuk meg)
  if (ph.links?.download_location) {
    fetch(ph.links.download_location, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
  }
  const raw = ph.urls?.raw;
  return {
    src: raw ? `${raw}&w=1880&q=75&fm=jpg&fit=crop` : ph.urls?.full,
    srcSmall: raw ? `${raw}&w=940&q=75&fm=jpg&fit=crop` : ph.urls?.regular,
    alt: clip(ph.alt_description || query, 160),
    avg: ph.color || null,
    photographer: clip(ph.user?.name, 80),
    photographerUrl: withUtm(ph.user?.links?.html),
    source: "Unsplash",
    sourceUrl: `https://unsplash.com/?${UTM}`,
  };
}

async function fromPexels(query, exclude) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`Pexels ${r.status}`);
  const photos = ((await r.json()).photos || []).filter((x) => !exclude || ![x.src?.large2x, x.src?.large].includes(exclude));
  if (!photos.length) return null;
  const ph = photos[Math.floor(Math.random() * Math.min(exclude ? 5 : 3, photos.length))];
  return {
    src: ph.src?.large2x || ph.src?.large,
    srcSmall: ph.src?.large || ph.src?.medium,
    alt: clip(ph.alt || query, 160),
    avg: ph.avg_color || null,
    photographer: clip(ph.photographer, 80),
    photographerUrl: ph.photographer_url,
    source: "Pexels",
    sourceUrl: ph.url || "https://www.pexels.com",
  };
}

async function findImage(query, exclude) {
  if (!query) return null;
  if (!exclude && imgCache.has(query)) return imgCache.get(query);
  for (const provider of [fromUnsplash, fromPexels]) {
    try {
      const img = await provider(query, exclude);
      if (img?.src) {
        if (imgCache.size > 200) imgCache.delete(imgCache.keys().next().value);
        imgCache.set(query, img);
        return img;
      }
    } catch (e) {
      console.warn("site-preview image:", e.message);
    }
  }
  return null;
}

// ---- Teszt mód mintaválasz -------------------------------------------------
function mockPreview(input, lang) {
  const en = lang === "en";
  return {
    brand: null,
    hero: en
      ? { title: "Gates and railings made to measure", subtitle: "We measure on site, plan with you and install what we build.", cta: "Ask for a quote" }
      : { title: "Kapuk és korlátok méretre", subtitle: "Helyben felmérjük, együtt megtervezzük, és be is szereljük, amit legyártunk.", cta: "Kérjen ajánlatot" },
    services: en
      ? [
          { title: "Gates", text: "Swing and sliding gates in a style that suits the house.", icon: "home" },
          { title: "Railings", text: "Stair and balcony railings, indoors and outdoors.", icon: "shield" },
          { title: "Repairs", text: "Fixing and repainting existing metal structures.", icon: "tools" },
        ]
      : [
          { title: "Kapuk", text: "Nyíló és tolókapuk a házhoz illő stílusban.", icon: "home" },
          { title: "Korlátok", text: "Lépcső- és erkélykorlátok, beltérre és kültérre.", icon: "shield" },
          { title: "Javítás", text: "Meglévő fémszerkezetek javítása, újrafestése.", icon: "tools" },
        ],
    why: en ? ["On-site survey before any price", "Written quote you can keep", "We install what we make"] : ["Felmérés helyben, ár csak utána", "Írásos ajánlat, amit megtarthat", "Amit gyártunk, azt mi szereljük"],
    about: en ? "A small workshop that makes and installs metal structures for homes." : "Kis műhely, amely otthonokba készít és szerel fémszerkezeteket.",
    contactCta: en ? "Tell us what you need and we'll call you back." : "Írja meg, mire van szüksége, és visszahívjuk.",
    accent: "amber",
    imageQuery: "wrought iron gate",
    trade: clip(input.trade, 80),
    city: clip(input.city, 60),
  };
}

// ---- Végpontok -------------------------------------------------------------
router.post("/site-preview", limitPerIp(Number(process.env.SITE_PREVIEW_PER_IP || 3), 24 * 60 * 60 * 1000, "sp"), async (req, res) => {
  const b = req.body || {};
  // Honeypot: ha a rejtett mező ki van töltve, robot — csendben eldobjuk
  if (b.website) return res.status(400).json({ error: "trade_required" });
  const lang = b.language === "en" ? "en" : "hu";
  const input = { trade: clip(b.trade, 120).trim(), city: clip(b.city, 60).trim(), company: clip(b.company, 60).trim() };
  if (input.trade.length < 3) return res.status(400).json({ error: "trade_required" });

  if (process.env.SITE_PREVIEW_MOCK === "1" || !process.env.ANTHROPIC_API_KEY) {
    return res.json({ preview: mockPreview(input, lang), image: null, live: false });
  }

  dailyCap(req, res, async () => {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: systemPrompt(lang), messages: [{ role: "user", content: userPrompt(input) }] }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await r.json();
      if (!data.content) throw new Error(JSON.stringify(data).slice(0, 300));
      const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
      const preview = sanitize(parseJson(text), input);
      if (!preview.hero.title || preview.services.length < 2) throw new Error("incomplete");
      const image = await findImage(preview.imageQuery);
      console.log(`site-preview ok: "${input.trade}" (${lang}) img=${image ? "yes" : "no"}`);
      res.json({ preview, image, live: true });
    } catch (e) {
      console.error("site-preview error", e.message);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });
});

// Bejövő (kliens által visszaküldött) vázlat megtisztítása, mielőtt a modellnek adjuk
function cleanIncoming(p) {
  const base = sanitize(p || {}, { trade: p?.trade, city: p?.city, company: "" });
  return base;
}

router.post("/site-preview/refine", limitPerIp(Number(process.env.SITE_PREVIEW_REFINE_PER_IP || 6), 24 * 60 * 60 * 1000, "spr"), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(400).json({ error: "invalid" });
  const lang = b.language === "en" ? "en" : "hu";
  const instruction = clip(b.instruction, 300).trim();
  const current = cleanIncoming(b.preview);
  if (instruction.length < 3 || !current.hero.title) return res.status(400).json({ error: "invalid" });

  if (process.env.SITE_PREVIEW_MOCK === "1" || !process.env.ANTHROPIC_API_KEY) {
    const next = { ...current, hero: { ...current.hero, subtitle: `${current.hero.subtitle} (${instruction})`.slice(0, 220) } };
    return res.json({ preview: next, image: null, note: lang === "en" ? "Sample change (test mode)." : "Minta módosítás (teszt mód).", live: false });
  }

  dailyCap(req, res, async () => {
    try {
      const { trade, city, ...content } = current;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1300,
          system: refinePrompt(lang),
          messages: [{ role: "user", content: `Trade: ${trade}${city ? `\nTown: ${city}` : ""}\nCurrent draft JSON:\n${JSON.stringify(content)}\n\nOwner's request: ${instruction}` }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await r.json();
      if (!data.content) throw new Error(JSON.stringify(data).slice(0, 300));
      const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
      const raw = parseJson(text);
      const preview = sanitize(raw, { trade, city, company: "" });
      if (!preview.hero.title || preview.services.length < 2) throw new Error("incomplete");
      const wantImage = raw.newImage === true || preview.imageQuery !== current.imageQuery;
      const image = wantImage ? await findImage(preview.imageQuery, raw.newImage === true ? clip(b.currentImage, 400) : null) : null;
      console.log(`site-preview refine ok: "${trade}" img=${image ? "new" : "keep"}`);
      res.json({ preview, image, note: clip(typeof raw.note === "string" ? raw.note : "", 200), live: true });
    } catch (e) {
      console.error("site-preview refine error", e.message);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });
});

const esc = (v, n = 400) => clip(v, n).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

router.post("/site-preview/lead", limitPerIp(5, 60 * 60 * 1000, "spl"), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: robotnak "siker", de nem küldünk semmit
  const name = clip(b.name, 80).trim();
  const contact = clip(b.contact, 120).trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  const isPhone = /^[+\d][\d\s/()-]{6,}$/.test(contact);
  if (!name || !(isEmail || isPhone) || b.consent !== true) return res.status(400).json({ error: "invalid" });

  const p = b.preview || {};
  const services = (Array.isArray(p.services) ? p.services : []).slice(0, 3).map((x) => `<li><b>${esc(x?.title, 60)}</b>: ${esc(x?.text, 200)}</li>`).join("");
  const html = `<p><b>${esc(name)}</b> — ${esc(contact)}</p>
<p>Tevékenység: <b>${esc(b.trade, 120)}</b>${b.city ? `, ${esc(b.city, 60)}` : ""}${b.company ? ` (${esc(b.company, 60)})` : ""}</p>
<p>Nyelv: ${b.language === "en" ? "angol" : "magyar"}</p>
<hr><p><b>Generált vázlat</b></p>
<p><b>${esc(p.hero?.title, 90)}</b><br>${esc(p.hero?.subtitle, 220)}</p>
<ul>${services}</ul>
<p>${esc(p.about, 320)}</p>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "KlementForge weboldal-előnézet <ai@klementforge.com>",
        to: process.env.LEAD_TO || "info@klementforge.com",
        ...(isEmail ? { reply_to: contact } : {}),
        subject: `Új weboldal-előnézet lead: ${clip(b.company || b.trade, 60)} (${clip(name, 40)})`,
        html,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    res.json({ ok: true });
  } catch (e) {
    console.error("site-preview lead error", e.message);
    res.status(502).json({ error: "mail_failed" });
  }
});

export default router;
