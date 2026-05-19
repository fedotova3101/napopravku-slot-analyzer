import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const PORT = Number(process.env.PORT || 4355);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const jobs = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function createJob(url) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    status: "running",
    createdAt: Date.now(),
    data: null,
    error: null
  };
  jobs.set(id, job);
  navigateAndAnalyze(url)
    .then(data => {
      job.status = data.ok ? "done" : "failed";
      job.data = data;
    })
    .catch(error => {
      job.status = "failed";
      job.error = error.message || "Не удалось провести анализ.";
    });
  return job;
}

function cleanupJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Слишком большой запрос"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeNapopravkuUrl(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith("napopravku.ru")) return null;

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

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function minimizeWorkerBrowserWindows() {
  if (process.platform !== "darwin") return;
  const script = `
tell application "System Events"
  repeat with appName in {"Google Chrome for Testing", "Chromium"}
    try
      set visible of application process appName to false
    end try
  end repeat
end tell
`;
  spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
}

async function navigateAndAnalyze(pageUrl) {
  const headless = process.env.PLAYWRIGHT_HEADLESS === "true" || process.env.RENDER === "true" || process.platform === "linux";
  const browser = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-component-update",
      "--disable-background-networking",
      "--disable-features=site-per-process,Translate,BackForwardCache",
      "--single-process",
      "--no-zygote",
      "--start-minimized",
      "--window-position=-32000,-32000",
      "--window-size=1200,900",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding"
    ]
  });
  const minimizeTimer = setInterval(minimizeWorkerBrowserWindows, 900);
  try {
    minimizeWorkerBrowserWindows();
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      locale: "ru-RU",
      timezoneId: "Europe/Moscow"
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    setTimeout(minimizeWorkerBrowserWindows, 800);
    await page.waitForTimeout(7000);

    return await evaluateWithNavigationRetry(page, browserAnalyzer);
  } finally {
    clearInterval(minimizeTimer);
    minimizeWorkerBrowserWindows();
    await browser.close().catch(() => {});
  }
}

async function evaluateWithNavigationRetry(page, analyzer) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await page.evaluate(analyzer);
    } catch (error) {
      lastError = error;
      const message = error.message || "";
      const canRetry = /Execution context was destroyed|navigation|Target page/i.test(message);
      if (!canRetry || attempt === 4) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
  throw lastError;
}

async function browserAnalyzer() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  const visible = el => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const dateLabel = offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  const today = dateLabel(0);
  const tomorrow = dateLabel(1);

  async function waitForDoctors() {
    const started = Date.now();
    while (Date.now() - started < 90_000) {
      const cards = document.querySelectorAll(".doctor-card-v2").length;
      const text = document.body.innerText || "";
      if (cards > 0) return { ok: true, cards };
      if (/captcha|капч|провер/i.test(text)) {
        window.scrollTo(0, 0);
      }
      await sleep(1000);
    }
    return { ok: false, cards: 0 };
  }

  const ready = await waitForDoctors();
  if (!ready.ok) {
    return {
      ok: false,
      message: "Не удалось дождаться списка врачей. Сайт не отдал карточки врачей фоновому браузеру. Запустите анализ еще раз; если повторится, сайт временно требует ручную проверку доступа.",
      url: location.href,
      today,
      tomorrow,
      totalDoctors: 0,
      loadedDoctors: 0,
      todayMoreThan3: [],
      tomorrowMoreThan3: [],
      allDoctors: []
    };
  }

  const findLoadMore = () => Array.from(document.querySelectorAll("button, a"))
    .find(el => visible(el) && /^Показать\s+ещ[её]$/i.test(clean(el.innerText || el.textContent)) && !el.disabled);

  let clicks = 0;
  let quietPasses = 0;
  while (clicks < 80 && quietPasses < 4) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(900);
    const before = document.querySelectorAll(".doctor-card-v2").length;
    const button = findLoadMore();
    if (!button) {
      quietPasses += 1;
      await sleep(700);
      continue;
    }
    button.scrollIntoView({ block: "center" });
    await sleep(250);
    button.click();
    clicks += 1;
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      await sleep(500);
      const after = document.querySelectorAll(".doctor-card-v2").length;
      if (after > before) {
        quietPasses = 0;
        break;
      }
    }
  }

  const cards = Array.from(document.querySelectorAll(".doctor-card-v2"));
  const getTotalDoctors = () => {
    const text = document.body.innerText || "";
    const match = text.match(/Врачи[^\n]*?\s(\d+)\s+специалист/);
    return match ? Number(match[1]) : cards.length;
  };

  async function countSlotsForDate(card, targetDate) {
    const dateButtons = Array.from(card.querySelectorAll(".slider-calendar__day-button"));
    const button = dateButtons.find(el => clean(el.innerText).includes(targetDate));
    if (!button || button.disabled) return { count: 0, times: [], available: false };

    button.scrollIntoView({ block: "center", inline: "center" });
    await sleep(120);
    button.click();
    await sleep(650);

    const times = Array.from(card.querySelectorAll(".n-time-slot, .time-slots-list__time-slot"))
      .filter(visible)
      .map(el => clean(el.innerText || el.textContent))
      .filter(text => /^\d{1,2}:\d{2}$/.test(text));
    return { count: new Set(times).size, times: Array.from(new Set(times)), available: true };
  }

  const rows = [];
  for (const card of cards) {
    const name = clean(
      card.querySelector(".object-info__title-link")?.innerText ||
      card.querySelector(".object-info__name")?.innerText
    );
    if (!name) continue;

    const clinic = clean(card.querySelector(".workplace-address-card__name")?.innerText);
    const address = clean(card.querySelector(".workplace-address-card__address")?.innerText);
    const specialties = Array.from(card.querySelectorAll(".speciality-list__chip"))
      .map(el => clean(el.innerText))
      .filter(Boolean)
      .join(", ");

    const todaySlots = await countSlotsForDate(card, today);
    const tomorrowSlots = await countSlotsForDate(card, tomorrow);

    rows.push({
      name,
      clinic,
      address,
      specialties,
      today: todaySlots,
      tomorrow: tomorrowSlots
    });
  }

  return {
    ok: true,
    url: location.href,
    title: document.title,
    today,
    tomorrow,
    loadedDoctors: rows.length,
    totalDoctors: getTotalDoctors(),
    loadMoreClicks: clicks,
    todayMoreThan3: rows.filter(row => row.today.count > 3),
    tomorrowMoreThan3: rows.filter(row => row.tomorrow.count > 3),
    allDoctors: rows
  };
}

async function serveStatic(req, res) {
  const requested = new URL(req.url, `http://localhost:${PORT}`).pathname;
  const pathname = requested === "/" ? "/index.html" : requested;
  const filePath = normalize(join(ROOT, "public", pathname));
  if (!filePath.startsWith(join(ROOT, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/analyze") {
      cleanupJobs();
      const payload = JSON.parse(await readBody(req) || "{}");
      const url = normalizeNapopravkuUrl(String(payload.url || "").trim());
      if (!url) {
        sendJson(res, 400, { ok: false, message: "Вставьте ссылку на страницу клиники, врачей или специальности на napopravku.ru." });
        return;
      }
      const job = createJob(url);
      sendJson(res, 202, { ok: true, jobId: job.id, status: job.status });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/job/")) {
      cleanupJobs();
      const id = decodeURIComponent(req.url.replace("/api/job/", "").split("?")[0]);
      const job = jobs.get(id);
      if (!job) {
        sendJson(res, 404, { ok: false, message: "Анализ не найден. Запустите его еще раз." });
        return;
      }
      if (job.status === "running") {
        sendJson(res, 200, { ok: true, jobId: job.id, status: job.status });
        return;
      }
      if (job.status === "failed") {
        sendJson(res, 409, job.data || { ok: false, status: job.status, message: job.error || "Не удалось провести анализ." });
        return;
      }
      sendJson(res, 200, job.data);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(405);
    res.end("Method not allowed");
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message || "Неизвестная ошибка" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Дашборд открыт: http://localhost:${PORT}`);
});
