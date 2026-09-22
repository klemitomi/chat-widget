/**
 * KlementForge AI Chat Widget
 * Önálló, függőségmentes beágyazható chat widget.
 * Dizájn: neon kék, fémes szürke, indusztriális stílus — illeszkedve a klementforge.com márkájához.
 *
 * Használat a weboldalon (pl. index.html végén, a </body> előtt):
 *   <script>
 *     window.KF_CHAT_API_URL = "https://your-backend.example.com/api/chat";
 *   </script>
 *   <script src="/widget.js"></script>
 */
(function () {
  const API_URL = window.KF_CHAT_API_URL || "/api/chat";

  const STYLE = `
    :root {
      --kf-accent: #00d4ff;
      --kf-accent-dim: #0ea5c4;
      --kf-bg: #0d141c;
      --kf-bg-panel: #131c26;
      --kf-border: #2a3744;
      --kf-text: #e8edf2;
      --kf-muted: #8a97a6;
    }
    #kf-chat-launcher {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 60px; height: 60px; border-radius: 12px;
      background: linear-gradient(145deg, #1a2530, #0d141c);
      border: 1px solid var(--kf-border);
      box-shadow: 0 0 0 1px rgba(0,212,255,0.15), 0 4px 20px rgba(0,0,0,0.5), 0 0 16px rgba(0,212,255,0.25);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }
    #kf-chat-launcher:hover {
      box-shadow: 0 0 0 1px rgba(0,212,255,0.35), 0 4px 20px rgba(0,0,0,0.5), 0 0 24px rgba(0,212,255,0.4);
      transform: translateY(-1px);
    }
    #kf-chat-launcher svg { width: 28px; height: 28px; }
    #kf-chat-label {
      position: fixed; bottom: 92px; right: 24px; z-index: 999999;
      background: var(--kf-bg-panel); color: var(--kf-text);
      border: 1px solid var(--kf-border);
      padding: 6px 12px; border-radius: 6px;
      font-family: system-ui, sans-serif; font-size: 12px; opacity: 0.95;
    }
    #kf-chat-window {
      position: fixed; bottom: 96px; right: 24px; z-index: 999999;
      width: 340px; max-width: 90vw; height: 480px; max-height: 70vh;
      background: var(--kf-bg);
      border: 1px solid var(--kf-border);
      border-radius: 10px;
      display: none; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif;
      box-shadow: 0 0 0 1px rgba(0,212,255,0.1), 0 16px 48px rgba(0,0,0,0.6);
    }
    #kf-chat-window.open { display: flex; }
    #kf-chat-header {
      background: var(--kf-bg-panel);
      color: var(--kf-text);
      border-bottom: 1px solid var(--kf-border);
      padding: 12px 16px;
      font-weight: 600; font-size: 14px; display:flex; justify-content:space-between; align-items:center;
    }
    #kf-chat-header small { display:block; font-weight:400; color: var(--kf-accent); font-size: 11px; letter-spacing: 0.02em; }
    #kf-chat-messages {
      flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
      background:
        linear-gradient(var(--kf-bg), var(--kf-bg)),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 3px);
    }
    .kf-msg { max-width: 85%; padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.4; }
    .kf-msg.bot { background: var(--kf-bg-panel); border: 1px solid var(--kf-border); color: var(--kf-text); align-self: flex-start; }
    .kf-msg.user { background: linear-gradient(135deg, var(--kf-accent), var(--kf-accent-dim)); color: #06131a; font-weight: 500; align-self: flex-end; }
    #kf-chat-input-row { display: flex; border-top: 1px solid var(--kf-border); background: var(--kf-bg-panel); }
    #kf-chat-input {
      flex: 1; background: transparent; border: none; color: var(--kf-text);
      padding: 12px; font-size: 13px; outline: none;
    }
    #kf-chat-input::placeholder { color: var(--kf-muted); }
    #kf-chat-send {
      background: transparent; border: none; color: var(--kf-accent); padding: 0 14px; cursor: pointer; font-weight: 600;
    }
    #kf-chat-send:hover { color: #fff; }
    #kf-chat-close { background: none; border: none; color: var(--kf-muted); cursor: pointer; font-size: 16px; }
    #kf-chat-close:hover { color: var(--kf-text); }
  `;

  const styleTag = document.createElement("style");
  styleTag.textContent = STYLE;
  document.head.appendChild(styleTag);

  const label = document.createElement("div");
  label.id = "kf-chat-label";
  label.textContent = "AI asszisztens — kérdezz bátran";
  document.body.appendChild(label);

  const launcher = document.createElement("button");
  launcher.id = "kf-chat-launcher";
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        stroke="#00d4ff" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="8" cy="11" r="1" fill="#00d4ff"/>
      <circle cx="12" cy="11" r="1" fill="#00d4ff"/>
      <circle cx="16" cy="11" r="1" fill="#00d4ff"/>
    </svg>
  `;
  document.body.appendChild(launcher);

  const win = document.createElement("div");
  win.id = "kf-chat-window";
  win.innerHTML = `
    <div id="kf-chat-header">
      <div>KlementForge <small>AI ASSZISZTENS</small></div>
      <button id="kf-chat-close">✕</button>
    </div>
    <div id="kf-chat-messages"></div>
    <div id="kf-chat-input-row">
      <input id="kf-chat-input" type="text" placeholder="Írj üzenetet..." />
      <button id="kf-chat-send">Küldés</button>
    </div>
  `;
  document.body.appendChild(win);

  const messagesEl = win.querySelector("#kf-chat-messages");
  const inputEl = win.querySelector("#kf-chat-input");
  const history = [];

  function addMessage(role, text) {
    const div = document.createElement("div");
    div.className = "kf-msg " + (role === "user" ? "user" : "bot");
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function openChat() {
    win.classList.add("open");
    label.style.display = "none";
    if (history.length === 0) {
      addMessage("assistant", "Szia! KlementForge AI asszisztense vagyok. Miben segíthetek?");
    }
  }

  launcher.addEventListener("click", () => {
    win.classList.contains("open") ? win.classList.remove("open") : openChat();
  });
  win.querySelector("#kf-chat-close").addEventListener("click", () => win.classList.remove("open"));

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    addMessage("user", text);
    history.push({ role: "user", content: text });

    const thinkingEl = document.createElement("div");
    thinkingEl.className = "kf-msg bot";
    thinkingEl.textContent = "...";
    messagesEl.appendChild(thinkingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      thinkingEl.remove();
      const reply = data.reply || "Elnézést, most nem tudok válaszolni. Próbáld meg később.";
      addMessage("assistant", reply);
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      thinkingEl.remove();
      addMessage("assistant", "Hiba történt a kapcsolódás közben. Kérlek próbáld meg később.");
    }
  }

  win.querySelector("#kf-chat-send").addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
})();
