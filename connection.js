export function normalizeNode(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== ""))
    throw Error("Use the Mac’s address without a path, password, or query.");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    throw Error("Use HTTPS for a Mac on your network.");
  return u.origin;
}

export function clientInfo(n) {
  const ua = n.userAgent || "";
  const tablet = /iPad/.test(ua) || (/Mac/.test(ua) && n.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const phone = !tablet && /iPhone|Android|Mobile/.test(ua);
  return {
    kind: tablet ? "tablet" : phone ? "phone" : /Mac|Windows|Linux/.test(ua) ? "desktop" : "browser",
    platform: /iPhone|iPad/.test(ua) || tablet && /Mac/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "",
    browser: /Edg\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Browser",
  };
}
