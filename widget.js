/**
 * KlementForge AI Chat Widget
 * Önálló, függőségmentes beágyazható chat widget.
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
    #kf-chat-launcher {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 60px; height: 60px; border-radius: 50%;
      background: #ff5a1f; color: #fff; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px;
    }
    #kf-chat-label {
      position: fixed; bottom: 92px; right: 24px; z-index: 999999;
      background: #111; color: #fff; padding: 6px 12px; border-radius: 8px;
      font-family: system-ui, sans-serif; font-size: 12px; opacity: 0.9;
    }
    #kf-chat-window {
      position: fixed; bottom: 96px; right: 24px; z-index: 999999;
      width: 340px; max-width: 90vw; height: 480px; max-height: 70vh;
      background: #0b0f14; border: 1px solid #222; border-radius: 14px;
      display: none; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    }
    #kf-chat-window.open { display: flex; }
    #kf-chat-header {
      background: #111; color: #fff; padding: 12px 16px;
      font-weight: 600; font-size: 14px; display:flex; justify-content:space-between; align-items:center;
    }
    #kf-chat-header small { display:block; font-weight:400; opacity:0.6; font-size: 11px; }
    #kf-chat-messages {
      flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .kf-msg { max-width: 85%; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.4; }
    .kf-msg.bot { background: #1a1f26; color: #eee; align-self: flex-start; }
    .kf-msg.user { background: #ff5a1f; color: #fff; align-self: flex-end; }
    #kf-chat-input-row { display: flex; border-top: 1px solid #222; }
    #kf-chat-input {
      flex: 1; background: transparent; border: none; color: #fff;
      padding: 12px; font-size: 13px; outline: none;
    }
    #kf-chat-send {
      background: transparent; border: none; color: #ff5a1f; padding: 0 14px; cursor: pointer; font-weight: 600;
    }
    #kf-chat-close { background: none; border: none; color: #999; cursor: pointer; font-size: 16px; }
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
  launcher.innerHTML = "💬";
  document.body.appendChild(launcher);

  const win = document.createElement("div");
  win.id = "kf-chat-window";
  win.innerHTML = `
    <div id="kf-chat-header">
      <div>KlementForge <small>AI asszisztens</small></div>
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
