# KlementForge AI Chatbot — Termékesítési és Beüzemelési Playbook

Ez a dokumentum leírja a saját fejlesztésű AI chatbot rendszer teljes architektúráját, és lépésről lépésre bemutatja, hogyan lehet ugyanezt a rendszert egy új ügyfélnél, személyre szabva bevezetni.

---

## 1. Az architektúra áttekintése

A rendszer három, egymástól független részből áll:

```
┌─────────────────┐      HTTPS       ┌──────────────────┐      HTTPS       ┌─────────────────┐
│  widget.js        │ ───────────────▶ │  server.js         │ ───────────────▶ │  Claude API       │
│  (ügyfél oldala)   │ ◀─────────────── │  (Render.com)       │ ◀─────────────── │  (Anthropic)      │
└─────────────────┘                  └──────────────────┘                  └─────────────────┘
                                              │
                                              │ HTTPS (ha email cím szerepel a beszélgetésben)
                                              ▼
                                      ┌──────────────────┐
                                      │  Resend API        │
                                      │  → lead-email       │
                                      └──────────────────┘
```

**Miért ez a felépítés, és nem egy kész SaaS (pl. Chatbase)?**
Egy korábbi projektnél a Chatbase ingyenes csomagja nem támogatta a lead-gyűjtést (fizetős funkció volt), ami miatt egy valós érdeklődő adatai elvesztek. A saját fejlesztésű rendszer ezt kiküszöböli: teljes kontroll van a lead-kezelés, a márkahang és a költségek felett.

### Miért nem SMTP (Gmail) az email küldéshez?
Sok felhő-hosting szolgáltató (pl. Render ingyenes csomagja) blokkolja vagy megbízhatatlanná teszi a kimenő SMTP-forgalmat. Ehelyett egy HTTP-alapú tranzakciós email API-t (Resend) érdemes használni, ami HTTPS-en (443-as port) megy, amit szinte sosem blokkolnak.

---

## 2. Komponensek

| Komponens | Mit csinál | Hol fut |
|---|---|---|
| `widget.js` | A látogató böngészőjében megjelenő chat-buborék és -ablak. Vanilla JS, semmilyen függőség, bármilyen weboldalba beilleszthető egy `<script>` taggel. | Az ügyfél saját tárhelyén (statikus fájlként, pl. FTP-vel feltöltve) |
| `server.js` | Node/Express backend. Fogadja a widget kéréseit, meghívja a Claude API-t egy egyedi rendszerprompttal, és ha lead-adatot (email címet) észlel, emailt küld a Resend API-n keresztül. | Render.com (vagy hasonló Node-hosting) |
| Rendszerprompt | Az AI "személyisége" és tudásbázisa — tartalmazza a cég hangnemét, valamint a konkrét, aktuális szolgáltatásokat és árakat. | A `server.js`-en belül, `SYSTEM_PROMPT` konstansként |

---

## 3. Beüzemelési lépések egy új ügyfélnél

### 3.1 Előkészítés
1. Hozz létre egy új GitHub repót az ügyfél kódjának (pl. `ugyfelnev-chat-widget`)
2. Másold be a `widget.js` és `server.js` sablonfájlokat

### 3.2 Testreszabás — rendszerprompt
A `SYSTEM_PROMPT` konstansban:
- Cégnév, hangnem, márka-specifikus kifejezések
- **Valódi, aktuális szolgáltatások és árak** az ügyfél weboldaláról (ne találj ki adatot!)
- Egyedi korlátok (mit ne állítson a bot, mikor kérjen elérhetőséget)

**Tipp:** mindig az élő weboldal tartalmát nézd át közvetlenül (böngészőben, nem csak feltételezésből), mert az árak és csomagok gyakran változnak.

### 3.3 Testreszabás — dizájn
A `widget.js` `STYLE` blokkjában lévő CSS-változók (`--kf-accent`, `--kf-bg`, `--kf-bg-panel`, `--kf-border`) igazítandók az ügyfél márkaszíneihez. Nézd meg az ügyfél weboldalának domináns színeit és stílusát (pl. neon/ipari, meleg/barátságos, minimalista), és ez alapján válaszd meg a paletta.

### 3.4 Backend beüzemelése (Render.com)
1. Render fiók (ügyfél sajátja vagy a tiéd, attól függően, ki fizeti az előfizetést)
2. New Web Service → Public Git Repository → repo URL megadása
3. Build Command: `npm install`, Start Command: `node server.js`
4. Environment változók (mind az ügyfél/saját adataival):
   - `ANTHROPIC_API_KEY`
   - `RESEND_API_KEY`
   - `GMAIL_EMAIL` (értesítések célcíme)
   - `ALLOWED_ORIGINS` (az ügyfél domainje, vesszővel elválasztva több domain esetén)
5. Deploy, majd az élő URL bemásolása a widgetbe

### 3.5 Widget beillesztése az ügyfél oldalába
```html
<script>
  window.KF_CHAT_API_URL = "https://ugyfelnev-chat.onrender.com/api/chat";
</script>
<script src="/widget.js"></script>
```
A `widget.js` fájlt magát is fel kell tölteni az ügyfél tárhelyére (FTP-vel vagy build-folyamat részeként).

### 3.6 Tesztelés
- Helyi HTML tesztfájllal (nem közvetlenül a szerver URL-jén — az egy sima szöveges válasz, amin a böngésző szigorú CSP-t alkalmaz)
- Élő oldalon, valódi beszélgetéssel, ellenőrizve hogy a lead-email tényleg megérkezik

---

## 4. Ismert buktatók (amiket ennél a projektnél megtapasztaltunk)

| Probléma | Ok | Megoldás |
|---|---|---|
| "Hiba történt a kapcsolódás közben" | CORS: a teszt `file://`-ról fut, "null" origin | Teszteléshez adj hozzá `null`-t az `ALLOWED_ORIGINS`-hoz, vagy futtass helyi dev szervert |
| "Your credit balance is too low" | Az Anthropic API nem rendelkezik állandó ingyenes csomaggal | Fel kell tölteni pár dollárt a console.anthropic.com-on |
| "Lead notification failed: Connection timeout" | SMTP (Gmail) blokkolva a felhő-hostingon | Resend HTTP API használata SMTP helyett |
| A widget lassan válaszol pár perc inaktivitás után | Render ingyenes csomagja "elalszik" 15 perc után | Fizetős csomagra váltás, vagy külső "ébren tartó" pingelés (UptimeRobot) |
| Render nem deployol automatikusan | Public Git Repository módnál ez néha manuális "Deploy latest commit"-ot igényel | Ellenőrizd a Deploys fület minden commit után |

---

## 5. Termékesítési szempontok (értékesítéshez ügyfeleknek)

**Mit kapnak az ügyfelek:**
- Saját AI-chatbot, ami a *saját* márkájukat és adataikat képviseli (nem egy generikus, bárki által elérhető SaaS-termék)
- Automatikus lead-értesítés emailben, minden alkalommal amikor egy érdeklődő elérhetőséget hagy
- Teljes vizuális testreszabás a saját arculatukhoz

**Mire figyelj ügyfélnél ajánlatadáskor:**
- Havi működési költség: Render (ingyenes vagy $7/hó), Anthropic API használat (pár dollár/hó kis-közepes forgalomnál), Resend (ingyenes 3000 emailig/hó) — ezt vagy te állod, vagy beépíted a havidíjba
- Karbantartás: a rendszerpromptot időnként frissíteni kell, ha változnak az árak/szolgáltatások
- Egyszeri beüzemelési díj + opcionális havi karbantartási csomag reális modell

---

## 6. Sablonfájlok helye

A jelen projekt GitHub repója (`chat-widget`) tartalmazza a legfrissebb, működő verziót — ebből érdemes kiindulni minden új ügyfélnél. Ne a legelső verziót másold, hanem mindig a legutóbbi, éles környezetben tesztelt commitot.
