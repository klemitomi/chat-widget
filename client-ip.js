// client-ip.js — a látogató valódi IP-címe, közösen a server.js, demo-routes.js és site-preview.js számára
//
// Az X-Forwarded-For fejlécet a kérés küldője szabadon kitöltheti, a Render csak hozzáfűz.
// Ezért NEM az első értéket használjuk vakon, hanem a CLIENT_IP_MODE env változó dönt:
//   first        – az XFF első értéke (régi viselkedés, hamisítható)
//   last         – az XFF utolsó értéke
//   second-last  – az XFF utolsó előtti értéke
//   header:<név> – egy külön fejléc, pl. header:true-client-ip vagy header:cf-connecting-ip
// Alapértelmezés: first (változatlan működés, amíg a helyes módot be nem állítod Renderen).
//
// IP_DEBUG=1 esetén kérésenként (legfeljebb 30-szor újraindulásonként) kiírja a releváns fejléceket
// a Render naplóba — ebből lehet eldönteni, melyik a helyes mód. Utána kapcsold ki (töröld a változót).

const MODE = (process.env.CLIENT_IP_MODE || "first").trim().toLowerCase();
const DEBUG = process.env.IP_DEBUG === "1";
let debugCount = 0;

export function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (DEBUG && debugCount < 30) {
    debugCount++;
    console.log(
      "IP_DEBUG",
      JSON.stringify({
        path: req.path,
        xff: req.headers["x-forwarded-for"] || null,
        trueClientIp: req.headers["true-client-ip"] || null,
        cfConnectingIp: req.headers["cf-connecting-ip"] || null,
        xRealIp: req.headers["x-real-ip"] || null,
        socket: req.socket?.remoteAddress || null,
      })
    );
  }

  let ip;
  if (MODE.startsWith("header:")) ip = String(req.headers[MODE.slice(7)] || "").split(",")[0].trim();
  else if (MODE === "last") ip = xff[xff.length - 1];
  else if (MODE === "second-last") ip = xff.length >= 2 ? xff[xff.length - 2] : xff[0];
  else ip = xff[0];

  return ip || req.socket?.remoteAddress || "unknown";
}

// Egyszerű napi plafon (az egész szerverre, nem IP-nként) — a hamisított IP-k ellen is véd.
export function dailyLimiter(max) {
  let state = { day: new Date().toDateString(), count: 0 };
  return () => {
    const today = new Date().toDateString();
    if (state.day !== today) state = { day: today, count: 0 };
    if (state.count >= max) return false;
    state.count++;
    return true;
  };
}
