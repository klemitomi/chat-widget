import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import demoRoutes from "./demo-routes.js";
import callReport from "./call-report.js";
import sitePreview from "./site-preview.js";
import { clientIp, dailyLimiter } from "./client-ip.js";

dotenv.config();
const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS: csak a saját domained(ek)ről engedélyezett a hívás
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins,
  })
);
app.use("/api", demoRoutes);
app.use("/api", callReport);
app.use("/api", sitePreview);


// A rendszerprompt — ugyanaz a szöveg, amit a Chatbase Instructions mezőjébe is feltöltöttünk
const SYSTEM_PROMPT = `### Szerep
Te vagy a KlementForge digitális asszisztense. A KlementForge modern weboldalakat készít vállalkozásoknak, AI-alapú ügyfélkapcsolati és automatizációs megoldásokkal kiegészítve.

### Ismert szolgáltatások és árak (mindig ezekre támaszkodj, ha weboldal-csomagról kérdeznek)
Minden csomag tartalmazza: reszponzív mobilnézet, modern letisztult design, gyors betöltés, alap SEO, domain+tárhely beállítás, 30 nap támogatás.

- Starter Weboldal — 129 990 Ft-tól: 1 hosszú landing oldal, 5–7 szekció, kapcsolati űrlap, alap SEO, social media linkek. Egyéni vállalkozóknak ajánlott.
- Business Weboldal (legkedveltebb) — 224 990 Ft-tól: 3–5 aloldal, blog integráció, animációk, Google Analytics, social media integráció. Kisvállalkozásoknak ajánlott.
- Weboldal Redizájn — 119 990 Ft-tól: meglévő oldal UX audit + teljes vizuális megújulás, React+Bootstrap, sebességoptimalizálás.

Opcionális extrák: logó készítés 30 000–50 000 Ft, SEO bővített csomag 60 000–120 000 Ft, tartalomszöveg írás 20 000–50 000 Ft, Google Cégem beállítás 15 000–30 000 Ft, Facebook/Instagram üzleti oldal beállítás 20 000–50 000 Ft.

Átfutási idő: 5–14 nap. Fix árak, nincs rejtett költség.

Az AI ügyfélkapcsolati és automatizációs szolgáltatások ára mindig egyedi, projektfüggő — ezekre soha ne mondj konkrét számot.

### Hangnem
Barátságos, magabiztos, tömör, magyarul kommunikálsz alapértelmezésben. Finoman használhatod a „kovácsolás” metaforát, de ne túlzásba vive minden mondatban. Alapértelmezésben MINDIG tegezz. Ha és csak akkor, ha a felhasználó kifejezetten magázva ír (pl. "Segítene?", "Köszönöm", "Ön"), válts át magázásra, és onnantól a beszélgetés végéig következetesen maradj a magázásnál — ne keverd a kettőt egy beszélgetésen belül.

### Cél minden beszélgetésben
1. Ha valaki egy csomagról vagy árról kérdez, válaszolj KONKRÉTAN a fenti adatok alapján — ne küldd el őt árajánlat-kérésre, ha már tudod a választ.
2. Miután megadtad a konkrét információt, mindig tedd hozzá: ha egyedi igénye van (pl. speciális funkció, AI-integráció, vagy a csomagoktól eltérő igény), kérdezd meg a nevét és email címét, hogy személyre szabott ajánlatot tudjatok készíteni.
3. Ha valaki bemutatkozik, reagálj rá név szerint, és vidd tovább a beszélgetést konkrét következő lépés felé.

### Elérhetőség (csak ezeket add meg, SOHA ne találj ki más címet vagy számot)
- Email: info@klementforge.com
- Telefon: +36 30 852 9593
- Weboldal: klementforge.com
Ha valaki telefonszámot vagy emailt kér, ezeket add meg azonnal, pontosan így.

### Témakör
- Kizárólag a KlementForge szolgáltatásairól beszélj: weboldal-készítés, redizájn, AI-megoldások, árak, folyamat, átfutási idő, kapcsolatfelvétel.
- Programozási, házi feladat, tanulási vagy bármilyen más általános kérdésre (pl. Python, matematika, fordítás, szövegírás) NE adj kódot, magyarázatot vagy példát — egy része sem. Udvariasan, egy mondatban jelezd, hogy ebben nem tudsz segíteni, mert a KlementForge szolgáltatásairól adsz tájékoztatást, és kérdezd meg, van-e weboldallal vagy AI-megoldással kapcsolatos kérdése.
- Ha a felhasználó ismételten témán kívüli kérdést tesz fel, maradj ennél a válasznál, ne engedj.

### Stílus
- Rövid válaszok: legfeljebb 3–5 mondat.
- Nyelvtanilag hibátlan, természetes magyar nyelv.
- Tamás egyedül dolgozik, soha ne beszélj „csapatról” vagy „kollégákról”.

### Korlátok
- Ne találj ki árat, funkciót vagy elérhetőséget, amit a fenti lista nem tartalmaz.
- Ne állítsd magadról, hogy melyik AI-modellen futsz.
- Ha valaki elérhetőséget ad meg (email vagy telefon), tudasd vele, hogy hamarosan felveszik vele a kapcsolatot.
- SOHA ne beszéld le az érdeklődőt, és ne írj olyat, hogy "nem vagyunk a legjobb választás", "nem hozzánk illik", vagy hasonló elutasító/lebeszélő mondatot — még akkor sem, ha a kérés egyszerűnek vagy kis értékűnek tűnik.
- Ha nem tudsz konkrét választ adni, vagy nincs elég adatod egy kéréshez, SOHA ne utasítsd el vagy zárd le negatívan a beszélgetést. Mindig oldás-orientáltan válaszolj: mondd meg, hogy ezt egyedileg tudjátok kezelni, és kérd el a nevét és email címét, hogy Tamás (a KlementForge alapítója) közvetlenül felvegye vele a kapcsolatot.`;

// ── Munkamenet- és IP-korlát ───────────────────────────────────────────
// Egy munkamenetben legfeljebb MAX_MESSAGES felhasználói üzenet.
// Ha ugyanarról az IP-ről új munkamenet indul (az IP_MEMORY_HOURS időn belül),
// a bot már csak ennyit válaszol: "Már válaszoltam."
// Az adatok memóriában vannak: a szerver újraindulásakor (Render free: alvás) törlődnek.
const MAX_MESSAGES = Number(process.env.CHAT_MAX_MESSAGES || 15);
const IP_MEMORY_MS = Number(process.env.CHAT_IP_MEMORY_HOURS || 24) * 60 * 60 * 1000;
const ALREADY_ANSWERED = "Már válaszoltam.";
const LIMIT_REACHED =
  "Ennek a beszélgetésnek elérted az üzenetkorlátját. Ha kérdésed van, írj az info@klementforge.com címre, vagy hívj a +36 30 852 9593 számon.";

// ip -> { sessionId, count, lastSeen, notified }
const ipState = new Map();

const getClientIp = clientIp;
// Napi plafon a teljes chatre (költségvédelem, akkor is, ha valaki IP-t hamisít)
const chatDaily = dailyLimiter(Number(process.env.CHAT_DAILY_MAX || 400));

// Régi bejegyzések takarítása óránként
setInterval(() => {
  const now = Date.now();
  for (const [ip, s] of ipState) if (now - s.lastSeen > IP_MEMORY_MS) ipState.delete(ip);
}, 60 * 60 * 1000).unref();

app.post("/api/chat", async (req, res) => {
  const { messages, sessionId } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing messages" });
  }

  const ip = getClientIp(req);
  const sid = typeof sessionId === "string" && sessionId ? sessionId.slice(0, 64) : "no-session";
  const now = Date.now();
  let state = ipState.get(ip);
  if (state && now - state.lastSeen > IP_MEMORY_MS) state = undefined;

  if (state && state.sessionId !== sid) {
    // Visszatérő IP új munkamenettel
    state.lastSeen = now;
    return res.json({ reply: ALREADY_ANSWERED, blocked: true });
  }
  if (!state) {
    state = { sessionId: sid, count: 0, lastSeen: now, notified: false };
    ipState.set(ip, state);
  }
  if (state.count >= MAX_MESSAGES) {
    state.lastSeen = now;
    return res.json({ reply: LIMIT_REACHED, blocked: true });
  }
  if (!chatDaily()) {
    return res.json({ reply: "Az AI asszisztens most nem elérhető. Írj az info@klementforge.com címre, vagy hívj a +36 30 852 9593 számon.", blocked: true });
  }
  state.count += 1;
  state.lastSeen = now;

  // A kliens által küldött előzményt is levágjuk, hogy ne lehessen felfújni
  const trimmed = messages
    .slice(-MAX_MESSAGES * 2)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) }));
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  if (!trimmed.length) return res.status(400).json({ error: "Missing messages" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Elnézést, nem sikerült választ generálni.";
    if (!data.content) console.error("Anthropic API error response:", JSON.stringify(data));

    // Lead-jelzés: CSAK a látogató saját üzeneteiben keresünk email címet vagy telefonszámot
    // (a bot válaszában szereplő saját címünk nem lead), és munkamenetenként egyszer értesítünk.
    const userText = trimmed.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const emails = (userText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).filter(
      (e) => !/klementforge\./i.test(e)
    );
    const phone = userText.match(/(\+?36|06)[\s\-/]?\d{1,2}[\s\-/]?\d{3}[\s\-/]?\d{3,4}/);
    const contact = emails[0] || phone?.[0];
    if (contact && !state.notified) {
      state.notified = true;
      const transcript = [...trimmed, { role: "assistant", content: reply }]
        .map((m) => `${m.role === "user" ? "Látogató" : "Bot"}: ${m.content}`)
        .join("\n\n");
      await notifyLead(transcript, contact);
    }

    res.json({ reply, remaining: Math.max(0, MAX_MESSAGES - state.count) });
  } catch (err) {
    console.error("Chat API error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

async function notifyLead(conversationText, leadEmail) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                          "Content-Type": "application/json",
              },
              body: JSON.stringify({
                          // Hitelesített domain után állítsd be Renderen: RESEND_FROM="KlementForge Chatbot <chatbot@klementforge.com>"
                          from: process.env.RESEND_FROM || "KlementForge Chatbot <onboarding@resend.dev>",
                          to: process.env.GMAIL_EMAIL,
                          subject: `Új lead a chatbotból (${leadEmail})`,
                          text: `A látogató elérhetőséget adott meg: ${leadEmail}\n\nBeszélgetés:\n\n${conversationText}`,
              }),
    });
          if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Resend API error: ${errText}`);
          }
    console.log("✓ Lead notification email sent for", leadEmail);
  } catch (err) {
    console.error("✗ Lead notification failed:", err.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✓ Chat server running on port ${PORT}`));
