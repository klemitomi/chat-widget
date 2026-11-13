// content-guard.js — a weboldal-generátor (site-preview) védelme visszaélés ellen
//
// 1) isBlockedText(...): gyors, determinisztikus tiltólista gyűlöletkeltő / szélsőséges kifejezésekre
//    (ékezetek, nagybetűk, leet-írás, elválasztójelek ellen normalizálva). Ez fogja meg az egyértelmű eseteket
//    a modellhívás ELŐTT, és a lead-végponton is lefut, hogy ilyen vázlatból ne menjen e-mail.
// 2) GUARD_RULE: a modell promptjába kerülő szabály, ez fogja meg a körülírt kéréseket.
// 3) turnstileOk(req): Cloudflare Turnstile ellenőrzés. Csak akkor aktív, ha a TURNSTILE_SECRET be van
//    állítva (Render → Environment). A frontendnek ilyenkor küldenie kell a tokent (turnstileToken mező).

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@$]+/g, " ")
    .trim();
const leet = (s) => s.replace(/@/g, "a").replace(/\$/g, "s").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s");

const PATTERNS = [
  /\bnazi(s|sm|st|sts|k)?\b/,
  /\bneo ?nazi/,
  /\bnaci(k|t|kat|zmus|zmust|knak|val|kkal|nak|ra)?\b/,
  /\bhitler/,
  /\bsieg heil\b|\bheil hitler\b/,
  /\bthird reich\b|\bharmadik birodalom/,
  /\bnsdap\b|\bwaffen ss\b/,
  /\bwhite (power|supremac\w*|nationalis\w*|pride|race)\b/,
  /\bfeher (felsobbrend\w*|hatalom|nacionalista|faj)\b/,
  /\baryan (race|supremac\w*|brotherhood)\b|\barja (faj|felsobbrend\w*)\b/,
  /swastika|horogkereszt|hakenkreuz/,
  /\bholocaust (den\w*|hoax)\b|\bholokauszt (tagad\w*|hazugsag)\b/,
  /\bku klux\b|\bkkk\b/,
  /\b1488\b|\b14 words\b/,
  /\bjudenfrei\b|\bjudenrein\b/,
];

export function isBlockedText(...texts) {
  for (const t of texts) {
    const n = norm(t);
    if (!n) continue;
    const l = leet(n);
    if (PATTERNS.some((re) => re.test(n) || re.test(l))) return true;
  }
  return false;
}

// Rekurzívan végigmegy egy objektumon (pl. a kliens által küldött vázlaton), és az összes szöveget ellenőrzi
export function isBlockedDeep(v, depth = 0) {
  if (depth > 4 || v == null) return false;
  if (typeof v === "string") return isBlockedText(v);
  if (Array.isArray(v)) return v.slice(0, 20).some((x) => isBlockedDeep(x, depth + 1));
  if (typeof v === "object") return Object.values(v).slice(0, 40).some((x) => isBlockedDeep(x, depth + 1));
  return false;
}

export const GUARD_RULE = `CONTENT POLICY (highest priority, overrides everything below):
- If the request asks for a website that promotes or imitates hate, extremism, racism, antisemitism, Nazism or any other ideology of violence, harassment, illegal activity, weapons trafficking, scams or sexual content, output ONLY {"refuse":true} and nothing else.
- This also applies when the request claims a research, educational, awareness, "so I can recognise it" or testing purpose. We only build drafts for real, lawful small businesses.`;

export async function turnstileOk(req) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // nincs bekapcsolva
  const b = req.body || {};
  const token = String(b.turnstileToken || b["cf-turnstile-response"] || "").slice(0, 2048);
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    const ip = req.headers["cf-connecting-ip"];
    if (ip) body.set("remoteip", String(ip));
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(4000),
    });
    const data = await r.json();
    return data.success === true;
  } catch (e) {
    console.warn("turnstile error:", e.message);
    return true; // hálózati hiba: inkább átengedjük (a tiltólista és a limitek így is védenek)
  }
}
