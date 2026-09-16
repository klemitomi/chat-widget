# KlementForge saját AI chat widget

Ez a Chatbase kiváltására szánt, saját fejlesztésű chatbot induló változata. Két részből áll:

- **`widget.js`** — a látogató böngészőjében fut, ez a beágyazott chat-buborék
- **`server.js`** — egy kis Node/Express backend, ami biztonságosan hívja a Claude API-t (az API-kulcs SOHA nem kerülhet a frontendbe), és emailt küld, ha egy beszélgetésben email cím jelenik meg

## Miért kell külön backend?

A Rackhost tárhelyed csak PHP-t futtat, ez a szerver viszont Node.js-t igényel. Ezért a backendet **külön kell hostolni** — nem a Rackhostra kerül.

## 1. Backend beüzemelése

1. Regisztrálj egy ingyenes fiókot a [Vercel](https://vercel.com)-en vagy a [Render](https://render.com)-en (mindkettő fut Node.js-t ingyenes csomagban)
2. Töltsd fel ezt a mappát (vagy kösd össze egy GitHub repóval)
3. Állítsd be a környezeti változókat (lásd `.env.example`):
   - `ANTHROPIC_API_KEY` — ezt a [console.anthropic.com](https://console.anthropic.com/settings/keys) oldalon tudod létrehozni
   - `GMAIL_EMAIL` és `GMAIL_APP_PASSWORD` — ugyanaz a fajta Gmail App Password, amit a korábbi `ai-email-assistant` projektben is használtál
   - `ALLOWED_ORIGINS` — a klementforge.com domain(ek)
4. Telepítés után kapsz egy URL-t, pl. `https://klementforge-chat.vercel.app`

## 2. Widget beillesztése a weboldalba

A `dist/index.html` fájlba (vagy a build folyamat megfelelő helyére) illeszd be a `</body>` elé:

```html
<script>
  window.KF_CHAT_API_URL = "https://klementforge-chat.vercel.app/api/chat";
</script>
<script src="/widget.js"></script>
```

A `widget.js` fájlt magát is fel kell töltened a Rackhost tárhelyre, a weboldal gyökerébe (ugyanoda, ahova az `index.html`-t is töltötted FileZilla-val).

## 3. A Chatbase widget eltávolítása

Miután a saját widget működik és tesztelve van, a `Chatbot.jsx` komponens (ami a Chatbase embed scriptjét tölti be) kivehető a React kódból, hogy ne fusson egyszerre a kettő.

## Amit még érdemes hozzáadni (következő lépések)

- **Streaming válaszok** — jelenleg a bot csak a teljes válasz elkészülte után jelenik meg, nem karakterenként
- **Tudásbázis bővítése** — a rendszerprompt jelenleg tömör; érdemes hosszabb távon a Chatbase-be feltöltött Q&A-kat is beépíteni a promptba vagy egy egyszerű RAG-megoldással
- **Rate limiting** — hogy ne lehessen visszaélni a végponttal és felesleges API-költséget generálni
- **Jobb lead-detektálás** — jelenleg csak email cím mintázatra figyel; érdemes lenne a modellt megkérni, hogy explicit jelezze, ha lead-adatot gyűjtött össze
