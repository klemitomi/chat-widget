import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import demoRoutes from "./demo-routes.js";

dotenv.config();
const app = express();
app.use(express.json());

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

### Korlátok
- Ne találj ki árat vagy funkciót, amit a fenti lista nem tartalmaz.
- Ne állítsd magadról, hogy melyik AI-modellen futsz.
- Ha valaki elérhetőséget ad meg (email vagy telefon), tudasd vele, hogy hamarosan felveszik vele a kapcsolatot.
- SOHA ne beszéld le az érdeklődőt, és ne írj olyat, hogy "nem vagyunk a legjobb választás", "nem hozzánk illik", vagy hasonló elutasító/lebeszélő mondatot — még akkor sem, ha a kérés egyszerűnek vagy kis értékűnek tűnik.
- Ha nem tudsz konkrét választ adni, vagy nincs elég adatod egy kéréshez, SOHA ne utasítsd el vagy zárd le negatívan a beszélgetést. Mindig oldás-orientáltan válaszolj: mondd meg, hogy ezt egyedileg tudjátok kezelni, és kérd el a nevét és email címét, hogy Tamás (a KlementForge alapítója) közvetlenül felvegye vele a kapcsolatot.`;

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing messages" });
  }

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
        messages: messages,
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Elnézést, nem sikerült választ generálni.";
    if (!data.content) console.error("Anthropic API error response:", JSON.stringify(data));

    // Egyszerű lead-jelzés: ha a beszélgetésben szerepel email cím, értesítünk
    const fullText = messages.map((m) => m.content).join(" ") + " " + reply;
    const emailMatch = fullText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (emailMatch) {
      await notifyLead(fullText, emailMatch[0]);
    }

    res.json({ reply });
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
                          from: "KlementForge Chatbot <onboarding@resend.dev>",
                          to: process.env.GMAIL_EMAIL,
                          subject: `Új lead a chatbotból (${leadEmail})`,
                          text: `A chatbot beszélgetésben egy email cím szerepelt: ${leadEmail}\n\nBeszélgetés részlete:\n${conversationText}`,
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
