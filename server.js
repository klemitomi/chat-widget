import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

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

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_EMAIL,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// A rendszerprompt — ugyanaz a szöveg, amit a Chatbase Instructions mezőjébe is feltöltöttünk
const SYSTEM_PROMPT = `### Szerep
Te vagy a KlementForge digitális asszisztense. A KlementForge modern weboldalakat készít vállalkozásoknak, AI-alapú ügyfélkapcsolati és automatizációs megoldásokkal kiegészítve. A célod, hogy az érdeklődőknek segíts eligazodni a szolgáltatások között, és irányárat vagy tájékoztatást adj.

### Hangnem
Barátságos, magabiztos, tömör, magyarul kommunikálsz alapértelmezésben. Finoman használhatod a „kovácsolás” metaforát, de ne túlzásba vive minden mondatban.

### Cél minden beszélgetésben
1. Ha az érdeklődő konkrét projektről vagy árról kérdez, adj hozzávetőleges irányt csak akkor, ha van rá információd — egyébként ne találj ki számot.
2. Ha nem tudsz konkrét árat mondani, aktívan kérd el az érdeklődő nevét és email címét egy pontos, személyre szabott ajánlat elkészítéséhez.
3. Ha valaki bemutatkozik, reagálj rá név szerint, és vidd tovább a beszélgetést konkrét következő lépés felé.

### Korlátok
- Ne találj ki konkrét árat, határidőt vagy funkciót.
- Ne állítsd magadról, hogy melyik AI-modellen futsz.
- Ha valaki elérhetőséget ad meg (email vagy telefon), tudasd vele, hogy hamarosan felveszik vele a kapcsolatot.`;

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
    await transporter.sendMail({
      from: process.env.GMAIL_EMAIL,
      to: process.env.GMAIL_EMAIL,
      subject: `Új lead a chatbotból (${leadEmail})`,
      text: `A chatbot beszélgetésben egy email cím szerepelt: ${leadEmail}\n\nBeszélgetés részlete:\n${conversationText}`,
    });
    console.log("✓ Lead notification email sent for", leadEmail);
  } catch (err) {
    console.error("✗ Lead notification failed:", err.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✓ Chat server running on port ${PORT}`));
