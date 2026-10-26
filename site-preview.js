// site-preview.js — "Nézd meg, hogyan nézhetne ki a weboldalad" az /ai-szolgaltatasok oldalra
//
// POST /api/site-preview        { trade, city?, company?, language? }      -> { preview, image, gallery, live }
// POST /api/site-preview/refine { preview, instruction, currentImage?, language } -> { preview, image?, gallery?, note }
// POST /api/site-preview/lead   { name, contact, consent, trade, city, company, preview, language }
//
// A modell CSAK strukturált tartalmat ad (JSON), HTML-t soha. A megjelenítés a weboldal
// előre megtervezett sablonjaiban történik (TEMPLATES), így mindig igényes és biztonságos.
//
// Környezeti változók (Render → Environment):
//   ANTHROPIC_API_KEY   (már megvan)
//   UNSPLASH_ACCESS_KEY ingyenes: https://unsplash.com/oauth/applications (Access Key)
//   PEXELS_API_KEY      opcionális tartalék. Ha egyik sincs: kép nélküli, sötét fejléc
//   RESEND_API_KEY      (már megvan) — lead e-mailhez
//   LEAD_TO             opcionális, alapból info@klementforge.com
//   SITE_PREVIEW_MOCK=1 teszt mód: nincs Anthropic- és képhívás, mintaválasz jön
//   SITE_PREVIEW_DAILY  napi plafon az összes generálásra + módosításra (alapból 60)
//   SITE_PREVIEW_PER_IP generálás / IP / 24 óra (alapból 3)
//   SITE_PREVIEW_REFINE_PER_IP  módosítás / IP / 24 óra (alapból 6)

import express from "express";
import { promises as dns } from "node:dns";
import { clip, HU_STYLE } from "./demo-prompts.js";

const router = express.Router();
const MODEL = process.env.SITE_PREVIEW_MODEL || "claude-sonnet-5";

// A frontend ugyanezeket ismeri — a modell csak ezek közül választhat
export const ICONS = ["tools", "home", "truck", "leaf", "heart", "star", "shield", "clock", "chat", "calendar", "camera", "cut", "food", "car", "bolt", "drop", "paint", "hammer", "people", "book"];
export const ACCENTS = ["cyan", "amber", "emerald", "rose", "violet", "orange"];
export const TEMPLATES = ["ipari", "elegans", "baratsagos"]; // a frontend PreviewStudio TEMPLATES-ével egyezik

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
function rules(lang) {
  const en = lang === "en";
  return `Output language: ${en ? "English" : "Hungarian (magyar), a látogatót magázva vagy semlegesen szólítsd meg (pl. \"Kérjen ajánlatot\")"}.

STRICT HONESTY RULES (most important):
- Never invent facts: no years of experience, customer counts, ratings, awards, certificates, guarantees, warranties, prices, opening hours, addresses, phone numbers, e-mails or testimonials.
- Never say anything is free, discounted, fast/same-day or that you serve a wider area. If a town is given you may say the business is based there.
- Only describe what the business plausibly offers based on its trade. Keep claims general and modest.
- If a company name is not given, use "brand": null. Do not make up a name.
- The gallery photos are stock illustrations, so never call them "our work" or describe specific projects.

STYLE RULES:
- Sound like a real local business owner, not a marketing agency. Concrete, simple, confident.
- Avoid clichés and template phrases (e.g. "minőség és megbízhatóság", "ügyfeleink elégedettsége az első", "vigyük együtt sikerre", "one-stop shop").
- Do NOT use the "nem X, hanem Y" / "not X, but Y" construction. Use at most one dash (—) in the whole output.
- Short sentences. The hero title is a bold statement of max 5 words; it is set in huge capital letters, so short words work best.
${en ? "" : HU_STYLE}

Return ONLY JSON, no markdown:
{"template":string (one of: ${TEMPLATES.join(", ")}; pick by trade: "ipari" = bold industrial look for trades, construction, metal, wood, auto, transport, machinery, cleaning; "elegans" = refined serif look for premium or calm services: restaurants, wineries, accommodation, interior design, architecture, law, accounting, photography, aesthetic clinics; "baratsagos" = warm, rounded, friendly look for personal and family services: hairdressers, beauty, cafés, bakeries, pets, kids, fitness, health practices, tutoring),
 "brand":string|null,
 "accent":string (one of: ${ACCENTS.join(", ")} — fits the trade),
 "hero":{"eyebrow":string (3-4 short keywords joined with " · ", e.g. "Tervezés · Gyártás · Szerelés"),"title":string,"subtitle":string (max 30 words),"cta":string (neutral, e.g. "Kérjen ajánlatot")},
 "services":[{"title":string (1-3 words),"text":string (max 18 words),"icon":string}] (4 to 6 items, icon one of: ${ICONS.join(", ")}),
 "statement":{"title":string (max 7 words, bold claim about the way of working, no invented facts),"text":string (max 20 words)},
 "process":[{"title":string (2-3 words),"text":string (max 16 words)}] (exactly 4 steps of how a job goes),
 "why":[string,string,string] (each max 10 words, concrete working practices, no numbers),
 "about":string (max 45 words, no invented facts),
 "contactTitle":string (max 3 words, e.g. "Kezdjük el?"),
 "contactCta":string (one short line inviting contact),
 "imageQuery":string (2-4 English words for a wide stock photo of the work or workplace, e.g. "steel staircase interior"),
 "galleryQuery":string (2-4 English words for detail photos of the craft, e.g. "welding metal workshop")}`;
}

function systemPrompt(lang) {
  return `You write the content of a one-page website DRAFT for a small business, based on a few words from the owner.
${rules(lang)}`;
}

function refinePrompt(lang) {
  return `You revise an existing one-page website DRAFT for a small business. The owner tells you what to change.
- Apply the requested change and keep everything else as it was.
- The owner MAY state real facts about their own business in the request (for example years in business, a company name, a service they offer). You may use exactly what they stated, nothing more.
- If the request asks for a different main photo, or its topic should change, set "newImage": true and give a fitting "imageQuery".
- If the request asks for different gallery photos, set "newGallery": true and give a fitting "galleryQuery".
- If the request is unrelated to the website or impossible, keep the draft unchanged and explain briefly in "note".
- Add a field "note": one short sentence to the owner, in the output language, saying what you changed (no greeting, no praise).
${rules(lang)}
Also include: "newImage": boolean, "newGallery": boolean, "note": string.`;
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

// A modell (vagy a kliens) által adott vázlat megtisztítása: hossz, típus, engedélyezett értékek
function sanitize(p, input) {
  const s = (v, n) => clip(typeof v === "string" ? v : "", n).trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const q = (v) => s(v, 60).replace(/[^\w\s-]/g, "");
  return {
    template: TEMPLATES.includes(p.template) ? p.template : TEMPLATES[0],
    brand: s(input.company, 60) || s(p.brand, 60) || null,
    accent: ACCENTS.includes(p.accent) ? p.accent : "orange",
    hero: { eyebrow: s(p.hero?.eyebrow, 80), title: s(p.hero?.title, 70), subtitle: s(p.hero?.subtitle, 240), cta: s(p.hero?.cta, 40) },
    services: arr(p.services).slice(0, 6).map((x) => ({
      title: s(x?.title, 50), text: s(x?.text, 160), icon: ICONS.includes(x?.icon) ? x.icon : "tools",
    })).filter((x) => x.title),
    statement: { title: s(p.statement?.title, 80), text: s(p.statement?.text, 180) },
    process: arr(p.process).slice(0, 4).map((x) => ({ title: s(x?.title, 40), text: s(x?.text, 140) })).filter((x) => x.title),
    why: arr(p.why).slice(0, 3).map((w) => s(w, 90)).filter(Boolean),
    about: s(p.about, 360),
    contactTitle: s(p.contactTitle, 40),
    contactCta: s(p.contactCta, 140),
    imageQuery: q(p.imageQuery),
    galleryQuery: q(p.galleryQuery) || q(p.imageQuery),
    trade: s(input.trade, 80),
    city: s(input.city, 60),
  };
}

// ---- Képek: Unsplash (elsődleges), Pexels (tartalék) -------------------------
// Unsplash szabályok: a visszakapott URL-t közvetlenül kell beágyazni (hotlink),
// használatkor jelezni kell a download_location végponton, és fel kell tüntetni
// a fotóst + az Unsplash-t utm paraméteres linkkel.
const UTM = "utm_source=klementforge&utm_medium=referral";
const withUtm = (u) => (u ? `${u}${u.includes("?") ? "&" : "?"}${UTM}` : u);
const photoCache = new Map(); // query -> normalizált fotólista

async function unsplashList(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&orientation=landscape&content_filter=high`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`Unsplash ${r.status}`);
  return ((await r.json()).results || []).map((ph) => {
    const raw = ph.urls?.raw;
    return {
      id: `u:${ph.id}`,
      src: raw ? `${raw}&w=1880&q=75&fm=jpg&fit=crop` : ph.urls?.full,
      srcSmall: raw ? `${raw}&w=940&q=75&fm=jpg&fit=crop` : ph.urls?.regular,
      alt: clip(ph.alt_description || query, 160),
      avg: ph.color || null,
      photographer: clip(ph.user?.name, 80),
      photographerUrl: withUtm(ph.user?.links?.html),
      source: "Unsplash",
      sourceUrl: `https://unsplash.com/?${UTM}`,
      _track: ph.links?.download_location,
    };
  });
}

async function pexelsList(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=12&orientation=landscape`, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`Pexels ${r.status}`);
  return ((await r.json()).photos || []).map((ph) => ({
    id: `p:${ph.id}`,
    src: ph.src?.large2x || ph.src?.large,
    srcSmall: ph.src?.large || ph.src?.medium,
    alt: clip(ph.alt || query, 160),
    avg: ph.avg_color || null,
    photographer: clip(ph.photographer, 80),
    photographerUrl: ph.photographer_url,
    source: "Pexels",
    sourceUrl: ph.url || "https://www.pexels.com",
  }));
}

async function photoList(query) {
  if (!query) return [];
  if (photoCache.has(query)) return photoCache.get(query);
  for (const provider of [unsplashList, pexelsList]) {
    try {
      const list = await provider(query);
      if (list?.length) {
        if (photoCache.size > 200) photoCache.delete(photoCache.keys().next().value);
        photoCache.set(query, list);
        return list;
      }
    } catch (e) {
      console.warn("site-preview image:", e.message);
    }
  }
  return [];
}

// Véletlen választás a legjobb találatok közül, a kizártak nélkül
function pick(list, count, excludeIds = [], top = 6) {
  const pool = list.filter((x) => !excludeIds.includes(x.id)).slice(0, Math.max(top, count));
  const out = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

// Unsplash: kötelező letöltés-jelzés (statisztika, nem várjuk meg), és a belső mező eltávolítása
function publish(photo) {
  if (!photo) return null;
  const { _track, ...pub } = photo;
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (_track && key) fetch(_track, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
  return pub;
}

async function findImages(preview, { hero = true, gallery = true, excludeIds = [] } = {}) {
  const [heroList, galList] = await Promise.all([
    hero ? photoList(preview.imageQuery) : [],
    gallery ? photoList(preview.galleryQuery) : [],
  ]);
  const heroPick = hero ? pick(heroList, 1, excludeIds)[0] || null : null;
  const used = [...excludeIds, ...(heroPick ? [heroPick.id] : [])];
  let galPick = gallery ? pick(galList, 3, used) : [];
  if (gallery && galPick.length < 3) galPick = galPick.concat(pick(heroList, 3 - galPick.length, [...used, ...galPick.map((x) => x.id)]));
  return { image: publish(heroPick), gallery: gallery ? galPick.map(publish) : null };
}

// ---- Teszt mód mintaválasz -------------------------------------------------
function mockPreview(input, lang) {
  const en = lang === "en";
  return sanitize(en ? {
    template: "ipari", accent: "orange",
    hero: { eyebrow: "Design · Fabrication · Installation", title: "Built from steel", subtitle: "Gates, fences, railings and stairs. We measure on site, plan with you and install what we build.", cta: "Ask for a quote" },
    services: [
      { title: "Gates", text: "Swing and sliding gates to suit the house.", icon: "home" },
      { title: "Fences", text: "Slatted, box-section or classic, matching the gate.", icon: "shield" },
      { title: "Railings", text: "Stair and balcony railings, indoors and outdoors.", icon: "tools" },
      { title: "Stairs", text: "Indoor and outdoor steel staircases.", icon: "hammer" },
    ],
    statement: { title: "One team from plan to fitting", text: "Design, fabrication and installation in one hand." },
    process: [
      { title: "Site visit", text: "We look at the place and take measurements." },
      { title: "Plan and quote", text: "A drawing and an itemised written quote." },
      { title: "Workshop", text: "The structure is made in our own workshop." },
      { title: "Installation", text: "We fit it on site and leave it clean." },
    ],
    why: ["Measured on site before any price", "Written quote you can keep", "We install what we make"],
    about: "A small workshop making and installing metal structures for homes.",
    contactTitle: "Shall we start?", contactCta: "Send a photo of the place and rough sizes, and we'll call you back.",
    imageQuery: "steel staircase interior", galleryQuery: "welding metal workshop",
  } : {
    template: "ipari", accent: "orange",
    hero: { eyebrow: "Tervezés · Gyártás · Szerelés", title: "Fémből, pontosan", subtitle: "Kapuk, kerítések, korlátok és lépcsők. Helyben felmérjük, együtt megtervezzük, és be is szereljük, amit legyártunk.", cta: "Kérjen ajánlatot" },
    services: [
      { title: "Kapuk", text: "Nyíló és tolókapuk a házhoz illő stílusban.", icon: "home" },
      { title: "Kerítések", text: "Lamellás, zártszelvényes vagy klasszikus, a kapuval összhangban.", icon: "shield" },
      { title: "Korlátok", text: "Lépcső- és erkélykorlátok beltérre és kültérre.", icon: "tools" },
      { title: "Lépcsők", text: "Bel- és kültéri acél lépcsőszerkezetek.", icon: "hammer" },
    ],
    statement: { title: "Egy kézben a tervtől a szerelésig", text: "Tervezés, gyártás és beépítés ugyanattól a csapattól." },
    process: [
      { title: "Helyszíni bejárás", text: "Megnézzük a helyet, és pontosan felmérjük." },
      { title: "Terv és ajánlat", text: "Rajz és tételes, írásos árajánlat." },
      { title: "Saját műhely", text: "A szerkezet a műhelyünkben készül." },
      { title: "Beépítés", text: "Helyszínen szereljük, és tisztán adjuk át." },
    ],
    why: ["Felmérés helyben, ár csak utána", "Írásos ajánlat, amit megtarthat", "Amit gyártunk, azt mi szereljük"],
    about: "Kis műhely, amely otthonokba készít és szerel fémszerkezeteket.",
    contactTitle: "Kezdjük el?", contactCta: "Küldjön egy fotót a helyszínről és hozzávetőleges méreteket, és visszahívjuk.",
    imageQuery: "steel staircase interior", galleryQuery: "welding metal workshop",
  }, input);
}

// ---- Közös Anthropic-hívás ---------------------------------------------------
async function askModel(system, content, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await r.json();
  if (!data.content) throw new Error(JSON.stringify(data).slice(0, 300));
  return parseJson(data.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
}
const complete = (p) => p.hero.title && p.services.length >= 3 && p.process.length >= 3;
const useMock = () => process.env.SITE_PREVIEW_MOCK === "1" || !process.env.ANTHROPIC_API_KEY;

// ---- Végpontok -------------------------------------------------------------
router.post("/site-preview", limitPerIp(Number(process.env.SITE_PREVIEW_PER_IP || 3), 24 * 60 * 60 * 1000, "sp"), async (req, res) => {
  const b = req.body || {};
  // Honeypot: ha a rejtett mező ki van töltve, robot — csendben eldobjuk
  if (b.website) return res.status(400).json({ error: "trade_required" });
  const lang = b.language === "en" ? "en" : "hu";
  const input = { trade: clip(b.trade, 120).trim(), city: clip(b.city, 60).trim(), company: clip(b.company, 60).trim() };
  if (input.trade.length < 3) return res.status(400).json({ error: "trade_required" });

  if (useMock()) return res.json({ preview: mockPreview(input, lang), image: null, gallery: [], live: false });

  dailyCap(req, res, async () => {
    try {
      const preview = sanitize(await askModel(systemPrompt(lang), userPrompt(input), 2200), input);
      if (!complete(preview)) throw new Error("incomplete");
      const { image, gallery } = await findImages(preview);
      console.log(`site-preview ok: "${input.trade}" (${lang}) img=${image ? "yes" : "no"} gallery=${gallery?.length || 0}`);
      res.json({ preview, image, gallery, live: true });
    } catch (e) {
      console.error("site-preview error", e.message);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });
});

router.post("/site-preview/refine", limitPerIp(Number(process.env.SITE_PREVIEW_REFINE_PER_IP || 6), 24 * 60 * 60 * 1000, "spr"), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(400).json({ error: "invalid" });
  const lang = b.language === "en" ? "en" : "hu";
  const instruction = clip(b.instruction, 300).trim();
  const current = sanitize(b.preview || {}, { trade: b.preview?.trade, city: b.preview?.city, company: "" });
  if (instruction.length < 3 || !current.hero.title) return res.status(400).json({ error: "invalid" });

  if (useMock()) {
    const next = { ...current, hero: { ...current.hero, subtitle: `${current.hero.subtitle} (${instruction})`.slice(0, 240) } };
    return res.json({ preview: next, image: null, gallery: null, note: lang === "en" ? "Sample change (test mode)." : "Minta módosítás (teszt mód).", live: false });
  }

  dailyCap(req, res, async () => {
    try {
      const { trade, city, ...content } = current;
      const raw = await askModel(
        refinePrompt(lang),
        `Trade: ${trade}${city ? `\nTown: ${city}` : ""}\nCurrent draft JSON:\n${JSON.stringify(content)}\n\nOwner's request: ${instruction}`,
        2400,
      );
      const preview = sanitize(raw, { trade, city, company: "" });
      if (!complete(preview)) throw new Error("incomplete");
      const hero = raw.newImage === true || preview.imageQuery !== current.imageQuery;
      const gallery = raw.newGallery === true || preview.galleryQuery !== current.galleryQuery;
      const excludeIds = (Array.isArray(b.currentImageIds) ? b.currentImageIds : []).slice(0, 8).map((x) => clip(x, 40));
      const imgs = hero || gallery ? await findImages(preview, { hero, gallery, excludeIds }) : { image: null, gallery: null };
      console.log(`site-preview refine ok: "${trade}" hero=${hero} gallery=${gallery}`);
      res.json({ preview, image: imgs.image, gallery: imgs.gallery, note: clip(typeof raw.note === "string" ? raw.note : "", 200), live: true });
    } catch (e) {
      console.error("site-preview refine error", e.message);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });
});

const esc = (v, n = 400) => clip(v, n).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));


// --- E-mail cím ellenőrzés (a lead-végponton) ---
// 1) kitalált / eldobható / tesztdomainek tiltólistája, 2) a domainnek legyen levelezési (MX) rekordja.
// Hálózati hiba esetén NEM utasítunk el (inkább átengedünk egy rossz címet, mint hogy elveszítsünk egy valódit).
const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "example.hu", "test.com", "test.hu", "teszt.hu", "pelda.hu", "valami.hu", "domain.com", "email.com",
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "throwawaymail.com", "dispostable.com", "maildrop.cc", "fakeinbox.com", "mailnesia.com", "mintemail.com",
]);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms))]);
const mxCache = new Map(); // domain -> { ok, at }
export async function emailDomainOk(email) {
  const domain = String(email).split("@").pop().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || BLOCKED_EMAIL_DOMAINS.has(domain)) return false;
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.ok;
  let ok;
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 3000);
    ok = mx.some((m) => m.exchange && m.exchange !== "."); // null MX ("."): a domain kifejezetten nem fogad levelet
  } catch (e) {
    if (e.code === "ENOTFOUND" || e.code === "ENODATA") {
      // nincs MX: az RFC szerint az A/AAAA rekord is elég
      try { ok = (await withTimeout(dns.resolve4(domain), 3000)).length > 0; } catch (e2) { ok = !(e2.code === "ENOTFOUND" || e2.code === "ENODATA"); }
    } else {
      return true; // átmeneti DNS hiba: átengedjük, és nem tároljuk el
    }
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

router.post("/site-preview/lead", limitPerIp(5, 60 * 60 * 1000, "spl"), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: robotnak "siker", de nem küldünk semmit
  const name = clip(b.name, 80).trim();
  const contact = clip(b.contact, 120).trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  const isPhone = /^[+\d][\d\s/()-]{6,}$/.test(contact);
  if (!name || !(isEmail || isPhone) || b.consent !== true) return res.status(400).json({ error: "invalid" });
  if (isEmail && !(await emailDomainOk(contact))) return res.status(400).json({ error: "invalid_email" });

  const p = b.preview || {};
  const li = (arr, f) => (Array.isArray(arr) ? arr : []).slice(0, 6).map(f).join("");
  const html = `<p><b>${esc(name)}</b> — ${esc(contact)}</p>
<p>Tevékenység: <b>${esc(b.trade, 120)}</b>${b.city ? `, ${esc(b.city, 60)}` : ""}${b.company ? ` (${esc(b.company, 60)})` : ""}</p>
<p>Nyelv: ${b.language === "en" ? "angol" : "magyar"}</p>
<hr><p><b>Generált vázlat</b> (sablon: ${esc(p.template, 20)}, szín: ${esc(p.accent, 20)})</p>
<p><small>${esc(p.hero?.eyebrow, 80)}</small><br><b>${esc(p.hero?.title, 90)}</b><br>${esc(p.hero?.subtitle, 240)}</p>
<p><b>Szolgáltatások</b></p><ul>${li(p.services, (x) => `<li><b>${esc(x?.title, 60)}</b>: ${esc(x?.text, 200)}</li>`)}</ul>
<p><b>${esc(p.statement?.title, 80)}</b> ${esc(p.statement?.text, 180)}</p>
<p><b>Folyamat</b></p><ol>${li(p.process, (x) => `<li><b>${esc(x?.title, 40)}</b>: ${esc(x?.text, 140)}</li>`)}</ol>
<p><b>Rólunk:</b> ${esc(p.about, 360)}</p>`;
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
