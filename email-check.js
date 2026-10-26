import { promises as dns } from "node:dns";

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
