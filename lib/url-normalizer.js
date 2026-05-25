export function normalizeNapopravkuUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.hostname !== "napopravku.ru" && !url.hostname.endsWith(".napopravku.ru")) return null;

    if (/\/doctors\/[^/]+\/?$/.test(url.pathname) || /\/doctors\/?$/.test(url.pathname)) {
      return url.toString();
    }

    if (/\/vrachi\/?$/.test(url.pathname)) {
      url.hash = "doctors";
      return url.toString();
    }

    if (/\/clinics\/[^/]+\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/?$/, "/vrachi/");
      url.hash = "doctors";
      return url.toString();
    }

    if (url.hash === "#doctors" && /\/clinics\/[^/]+\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/?$/, "/vrachi/");
      return url.toString();
    }

    return null;
  } catch {
    return null;
  }
}
