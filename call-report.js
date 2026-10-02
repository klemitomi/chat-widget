// call-report.js — a Vapi telefonos asszisztens hívás utáni jelentése → e-mail összefoglaló
//
// Bekötés a server.js-ben:
//   import callReport from "./call-report.js";
//   app.use("/api", callReport);
// FONTOS: a hívásjelentés nagy lehet (teljes átirat), ezért a server.js-ben az
//   app.use(express.json());  sort cseréld erre:  app.use(express.json({ limit: "2mb" }));
//
// Környezeti változók (Render → Environment):
//   VAPI_SECRET  – tetszőleges hosszú jelszó, ugyanezt kell a Vapiban a Server URL "Secret" mezőjébe írni
//   RESEND_API_KEY – már megvan
//   CALL_REPORT_TO – opcionális, alapból info@klementforge.com
//
// Vapi beállítás: Assistant → Advanced → Server URL:
//   https://chat-widget-ggyi.onrender.com/api/call-report

import express from "express";

const router = express.Router();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch { return String(iso); }
}

router.post("/call-report", async (req, res) => {
  // Csak a Vapitól fogadunk el jelentést
  const secret = process.env.VAPI_SECRET;
  if (secret && req.get("x-vapi-secret") !== secret) return res.status(401).json({ error: "unauthorized" });

  const m = req.body?.message || {};
  // A Vapi más üzeneteket is küldhet erre a címre (állapotváltozás stb.) – ezeket csak nyugtázzuk
  if (m.type !== "end-of-call-report") return res.json({ ok: true });
  res.json({ ok: true }); // azonnal válaszolunk, az e-mail a háttérben megy

  try {
    const call = m.call || {};
    const caller = call.customer?.number || m.customer?.number || "ismeretlen szám";
    const summary = m.analysis?.summary || m.summary || "Nincs összefoglaló.";
    const data = m.analysis?.structuredData || {};
    const transcript = m.artifact?.transcript || m.transcript || "";
    const recording = m.artifact?.recordingUrl || m.recordingUrl || "";
    const started = m.startedAt || call.startedAt;
    const ended = m.endedAt || call.endedAt;
    const secs = started && ended ? Math.round((new Date(ended) - new Date(started)) / 1000) : null;

    const rows = [
      ["Hívó száma", caller],
      ["Név", data.name],
      ["Visszahívható szám", data.phone],
      ["Cég / vállalkozás", data.company],
      ["Igény", data.request],
      ["Lefoglalt időpont", data.appointment],
      ["Konzultáció módja", data.channel],
      ["E-mail", data.email],
      ["Hívás ideje", fmtTime(started)],
      ["Hossz", secs != null ? `${Math.floor(secs / 60)} perc ${secs % 60} mp` : "—"],
      ["Befejezés oka", m.endedReason],
    ].filter(([, v]) => v);

    const subject = data.appointment
      ? `📅 Új konzultáció: ${data.name || caller} – ${data.appointment}`
      : `📞 Nem fogadott hívás: ${data.name || caller}`;

    const html = `
      <h2 style="margin:0 0 8px">${esc(subject)}</h2>
      <p style="font-size:15px">${esc(summary)}</p>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="color:#666">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}
      </table>
      ${recording ? `<p><a href="${esc(recording)}">Hívásfelvétel meghallgatása</a></p>` : ""}
      ${transcript ? `<h3>Átirat</h3><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:#333">${esc(transcript).slice(0, 20000)}</pre>` : ""}
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Réka – KlementForge AI asszisztens <ai@klementforge.com>",
        to: (process.env.CALL_REPORT_TO || "info@klementforge.com").split(",").map((x) => x.trim()),
        subject,
        html,
      }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    console.log("call report sent", caller);
  } catch (e) {
    console.error("call report error", e.message);
  }
});

export default router;
