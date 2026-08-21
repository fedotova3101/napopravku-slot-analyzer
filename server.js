import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { ANALYZER_TIMINGS } from "./lib/analyzer-timings.js";
import { getChromiumLaunchOptions } from "./lib/browser-options.js";
import { dateLabelForOffset, resolveNapopravkuTimezone } from "./lib/city-timezones.js";
import { JobManager } from "./lib/job-manager.js";
import { parseSlotDateText, slotDatesEqual, summarizeSlotDiagnostics } from "./lib/slot-date.js";
import { normalizeNapopravkuUrl } from "./lib/url-normalizer.js";
import { XLSX_CONTENT_TYPE, buildXlsxBuffer } from "./lib/xlsx-export.js";

const PORT = Number(process.env.PORT || 4355);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let sharedBrowserPromise = null;

const MAX_PARALLEL_ANALYSES = Math.max(1, Number(process.env.MAX_PARALLEL_ANALYSES || 3));
const ANALYSIS_TIMEOUT_MS = Math.max(60_000, Number(process.env.ANALYSIS_TIMEOUT_MS || 15 * 60 * 1000));
const jobManager = new JobManager({
  maxParallel: MAX_PARALLEL_ANALYSES,
  analysisTimeoutMs: ANALYSIS_TIMEOUT_MS,
  analyze: navigateAndAnalyze
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
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

function sendXlsx(res, rows) {
  const body = buildXlsxBuffer(rows);
  const fileName = `napopravku-slots-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.writeHead(200, {
    "content-type": XLSX_CONTENT_TYPE,
    "content-length": body.length,
    "content-disposition": `attachment; filename="${fileName}"`
  });
  res.end(body);
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

function createRequestDiagnostics(jobId, pageUrl) {
  const stats = {
    jobId,
    url: pageUrl,
    totalRequests: 0,
    napopravkuRequests: 0,
    blockedRequests: 0,
    failedRequests: 0,
    byResourceType: {},
    byStatus: {},
    startedAt: new Date().toISOString()
  };

  const isNapopravku = url => {
    try {
      return new URL(url).hostname.endsWith("napopravku.ru");
    } catch {
      return false;
    }
  };

  return {
    recordRequest(request, { blocked = false } = {}) {
      const resourceType = request.resourceType();
      stats.totalRequests += 1;
      stats.byResourceType[resourceType] = (stats.byResourceType[resourceType] || 0) + 1;
      if (isNapopravku(request.url())) stats.napopravkuRequests += 1;
      if (blocked) stats.blockedRequests += 1;
    },
    recordResponse(response) {
      const status = String(response.status());
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    },
    recordFailure() {
      stats.failedRequests += 1;
    },
    snapshot() {
      return {
        ...stats,
        finishedAt: new Date().toISOString()
      };
    }
  };
}

async function getSharedBrowser(headless) {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium.launch(getChromiumLaunchOptions({ headless }))
      .then(browser => {
        browser.on("disconnected", () => {
          sharedBrowserPromise = null;
        });
        return browser;
      })
      .catch(error => {
        sharedBrowserPromise = null;
        throw error;
      });
  }
  return sharedBrowserPromise;
}

async function navigateAndAnalyze(pageUrl, job, updateProgress, signal) {
  updateProgress({
    percent: 4,
    stage: "Запускаем браузер",
    detail: "Готовим фоновый браузер для анализа."
  });
  const headless = process.env.PLAYWRIGHT_HEADLESS === "true" || process.env.RENDER === "true" || process.platform === "linux";
  const clinicTimeZone = resolveNapopravkuTimezone(pageUrl);
  const targetDates = {
    today: dateLabelForOffset(clinicTimeZone, 0),
    tomorrow: dateLabelForOffset(clinicTimeZone, 1),
    clinicTimeZone
  };
  const browser = await getSharedBrowser(headless);
  let context = null;
  const minimizeTimer = setInterval(minimizeWorkerBrowserWindows, 900);
  const requestDiagnostics = createRequestDiagnostics(job.id, pageUrl);
  try {
    minimizeWorkerBrowserWindows();
    updateProgress({
      percent: 8,
      stage: "Открываем страницу",
      detail: "Переходим по ссылке НаПоправку."
    });
    context = await browser.newContext({
      viewport: { width: 1000, height: 800 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      locale: "ru-RU",
      timezoneId: clinicTimeZone
    });
    signal?.addEventListener("abort", () => {
      context?.close().catch(() => {});
    }, { once: true });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await context.addInitScript({
      content: `window.parseSlotDateText = ${parseSlotDateText.toString()};\nwindow.slotDatesEqual = ${slotDatesEqual.toString()};`
    });
    await context.route("**/*", route => {
      const request = route.request();
      const blockedTypes = new Set(["image", "media", "font"]);
      if (blockedTypes.has(request.resourceType())) {
        requestDiagnostics.recordRequest(request, { blocked: true });
        route.abort().catch(() => {});
        return;
      }
      requestDiagnostics.recordRequest(request);
      route.continue().catch(() => {});
    });
    const page = await context.newPage();
    page.on("response", response => requestDiagnostics.recordResponse(response));
    page.on("requestfailed", () => requestDiagnostics.recordFailure());
    await page.exposeFunction("reportAnalyzerProgress", patch => {
      updateProgress(patch);
    });
    page.setDefaultTimeout(ANALYZER_TIMINGS.pageDefaultTimeoutMs);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: ANALYZER_TIMINGS.pageGotoTimeoutMs });
    setTimeout(minimizeWorkerBrowserWindows, 800);
    updateProgress({
      percent: 14,
      stage: "Ждем данные",
      detail: "Страница открыта, ждем карточки врачей."
    });
    await page.waitForTimeout(ANALYZER_TIMINGS.initialPageSettleMs);

    const result = await evaluateWithNavigationRetry(page, browserAnalyzer, job, updateProgress, {
      timings: ANALYZER_TIMINGS,
      targetDates
    });
    const analysisDiagnostics = summarizeSlotDiagnostics(result.allDoctors);
    const diagnostics = {
      ...analysisDiagnostics,
      requestDiagnostics: requestDiagnostics.snapshot()
    };
    console.info(JSON.stringify({
      event: "analysis_completed",
      jobId: job.id,
      url: pageUrl,
      ok: result.ok,
      loadedDoctors: result.loadedDoctors,
      totalDoctors: result.totalDoctors,
      analyzedDoctors: result.allDoctors?.length || 0,
      diagnostics
    }));
    if (result.ok && analysisDiagnostics.scheduleFormatMismatch) {
      return {
        ...result,
        ok: false,
        status: "partial",
        analysisDiagnostics: diagnostics,
        message: "НаПоправку отдал расписание, но анализатор не смог надежно распознать даты. Ложный нулевой результат не показан; нужно обновить разбор расписания."
      };
    }
    return { ...result, analysisDiagnostics: diagnostics };
  } finally {
    clearInterval(minimizeTimer);
    minimizeWorkerBrowserWindows();
    await context?.close().catch(() => {});
  }
}

async function evaluateWithNavigationRetry(page, analyzer, job, updateProgress, payload) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await page.evaluate(analyzer, payload);
    } catch (error) {
      lastError = error;
      const message = error.message || "";
      const canRetry = /Execution context was destroyed|navigation|Target page/i.test(message);
      if (!canRetry || attempt === 4) throw error;
      updateProgress({
        percent: Math.max(18, job.progress.percent - 2),
        stage: "Повторяем анализ",
        detail: "Страница обновилась во время анализа, пробуем продолжить."
      });
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(ANALYZER_TIMINGS.navigationRetryWaitMs);
    }
  }
  throw lastError;
}

async function browserAnalyzer({ timings, targetDates }) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = text => String(text || "").replace(/[\u200b\u200c\u200d\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  const report = async patch => {
    try {
      if (typeof window.reportAnalyzerProgress === "function") {
        await window.reportAnalyzerProgress(patch);
      }
    } catch {
      // Progress is helpful, but the analysis must continue if a report is missed.
    }
  };
  const visible = el => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const rendered = el => {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const disabled = el => (
    !el ||
    el.disabled ||
    el.getAttribute("aria-disabled") === "true" ||
    /\bdisabled\b/i.test(String(el.className || ""))
  );
  const unique = items => Array.from(new Set(items));
  function extractTimesFromText(text) {
    return unique(
      (String(text || "").match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || [])
        .map(time => time.padStart(5, "0"))
    );
  }
  function collectSlotTimes(card) {
    const slotSelectors = [
      ".n-time-slot",
      ".time-slots-list__time-slot",
      "button[class*='time-slot']",
      "[class*='time-slots-list'] button"
    ].join(", ");
    const timesFromButtons = Array.from(card.querySelectorAll(slotSelectors))
      .filter(el => rendered(el) && !disabled(el))
      .flatMap(el => extractTimesFromText(el.innerText || el.textContent));

    if (timesFromButtons.length > 0) return unique(timesFromButtons);
    return extractTimesFromText(card.innerText || card.textContent);
  }
  function firstDateFromCardText(card) {
    const text = clean(card.innerText || card.textContent);
    const weekdayDate = text.match(/(?:пн|вт|ср|чт|пт|сб|вс)\s*\u200b?\s*(\d{1,2}(?:\.\d{1,2}|\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)))/i);
    if (weekdayDate) return weekdayDate[1];
    return window.parseSlotDateText(text) ? text : null;
  }
  function inferSlotsFromCardText(card, targetDate) {
    const firstDate = firstDateFromCardText(card);
    if (!firstDate || !window.slotDatesEqual(firstDate, targetDate)) return null;
    const times = collectSlotTimes(card);
    return times.length > 0 ? { count: times.length, times, available: true } : null;
  }
  const dateButtonMatches = (el, targetDate) => window.slotDatesEqual(clean(el.innerText || el.textContent), targetDate);
  const selectedDateButton = el => /\bselected\b/i.test(String(el.className || "")) || el.getAttribute("aria-selected") === "true";
  const today = targetDates.today;
  const tomorrow = targetDates.tomorrow;
  const clinicTimeZone = targetDates.clinicTimeZone;

  const getTotalDoctorsFromText = fallback => {
    const text = document.body.innerText || "";
    const match = text.match(/Врачи[^\n]*?\s(\d+)\s+специалист/);
    return match ? Number(match[1]) : fallback;
  };

  async function waitForDoctors() {
    const started = Date.now();
    while (Date.now() - started < timings.doctorListMaxWaitMs) {
      const cards = document.querySelectorAll(".doctor-card-v2").length;
      const text = document.body.innerText || "";
      if (cards > 0) {
        await report({
          percent: 22,
          stage: "Список врачей найден",
          detail: `Нашли первые карточки врачей: ${cards}.`,
          loadedDoctors: cards,
          totalDoctors: getTotalDoctorsFromText(cards)
        });
        return { ok: true, cards };
      }
      if (/captcha|капч|провер/i.test(text)) {
        window.scrollTo(0, 0);
      }
      await report({
        percent: 16,
        stage: "Ждем список врачей",
        detail: "НаПоправку еще загружает карточки врачей."
      });
      await sleep(timings.doctorListPollMs);
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
  while (clicks < 80 && quietPasses < timings.quietPassesToStop) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(timings.loadMoreScrollWaitMs);
    const before = document.querySelectorAll(".doctor-card-v2").length;
    const total = getTotalDoctorsFromText(before);
    await report({
      percent: Math.min(48, 24 + Math.round((Math.min(before, total || before) / Math.max(total || before || 1, 1)) * 22)),
      stage: "Подгружаем врачей",
      detail: `Загружено карточек: ${before}${total ? ` из ${total}` : ""}.`,
      loadedDoctors: before,
      totalDoctors: total
    });
    if (total && before >= total) {
      quietPasses += 1;
      await sleep(timings.loadMoreIdleWaitMs);
      continue;
    }
    const button = findLoadMore();
    if (!button) {
      quietPasses += 1;
      await sleep(timings.loadMoreIdleWaitMs);
      continue;
    }
    button.scrollIntoView({ block: "center" });
    await sleep(timings.loadMoreButtonSettleMs);
    button.click();
    clicks += 1;
    const started = Date.now();
    while (Date.now() - started < timings.loadMoreMaxWaitMs) {
      await sleep(timings.loadMorePollMs);
      const after = document.querySelectorAll(".doctor-card-v2").length;
      if (after > before) {
        quietPasses = 0;
        break;
      }
    }
  }

  const cards = Array.from(document.querySelectorAll(".doctor-card-v2"));
  const totalDoctors = getTotalDoctorsFromText(cards.length);
  await report({
    percent: 50,
    stage: "Анализируем слоты",
    detail: `Проверяем расписание врачей: 0 из ${cards.length}.`,
    loadedDoctors: cards.length,
    totalDoctors,
    analyzedDoctors: 0
  });

  async function waitForSlotRender(card, targetDate) {
    const started = Date.now();
    while (Date.now() - started < Math.max(1_000, timings.slotSwitchWaitMs * 4)) {
      const selectedText = Array.from(card.querySelectorAll(".slider-calendar__day-button"))
        .filter(selectedDateButton)
        .map(el => clean(el.innerText || el.textContent))
        .join(" ");
      const times = collectSlotTimes(card);
      if (times.length > 0 && (!targetDate || window.slotDatesEqual(selectedText, targetDate))) return times;
      await sleep(120);
    }
    return collectSlotTimes(card);
  }

  async function countSlotsForDate(card, targetDate) {
    const slotDebug = {
      targetDate,
      reason: "",
      dateButtons: [],
      selectedDates: [],
      visibleTimesBefore: [],
      visibleTimesAfter: []
    };
    card.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(timings.dateButtonSettleMs);
    slotDebug.visibleTimesBefore = await waitForSlotRender(card);

    const dateButtons = Array.from(card.querySelectorAll(".slider-calendar__day-button"));
    slotDebug.dateButtons = dateButtons.map(el => clean(el.innerText || el.textContent)).filter(Boolean);
    slotDebug.selectedDates = dateButtons.filter(selectedDateButton).map(el => clean(el.innerText || el.textContent)).filter(Boolean);
    const button = (
      dateButtons.find(el => dateButtonMatches(el, targetDate) && visible(el)) ||
      dateButtons.find(el => dateButtonMatches(el, targetDate))
    );
    const textFallback = reason => {
      const fallback = inferSlotsFromCardText(card, targetDate);
      if (fallback) {
        return { ...fallback, slotDebug: { ...slotDebug, reason: `${reason}:text-fallback` } };
      }
      return { count: 0, times: [], available: false, slotDebug: { ...slotDebug, reason } };
    };
    if (!button) return textFallback("target-date-not-found");
    if (disabled(button)) return textFallback("target-date-disabled");

    if (!selectedDateButton(button)) {
      button.scrollIntoView({ block: "center", inline: "center" });
      await sleep(timings.dateButtonSettleMs);
      button.click();
      await waitForSlotRender(card, targetDate);
    }

    const selectedButton = dateButtons.find(el => dateButtonMatches(el, targetDate) && selectedDateButton(el));
    slotDebug.selectedDates = dateButtons.filter(selectedDateButton).map(el => clean(el.innerText || el.textContent)).filter(Boolean);
    if (!selectedButton && dateButtons.some(selectedDateButton)) {
      return textFallback("target-date-not-selected");
    }

    const times = await waitForSlotRender(card, targetDate);
    slotDebug.visibleTimesAfter = times;
    return times.length > 0
      ? { count: times.length, times, available: true, slotDebug: { ...slotDebug, reason: "slot-times-found" } }
      : textFallback("slot-times-not-found");
  }

  const rows = [];
  for (const [index, card] of cards.entries()) {
    try {
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
    } catch {
      // One broken card should not break the whole clinic analysis.
    } finally {
      await report({
        percent: Math.min(96, 52 + Math.round(((index + 1) / Math.max(cards.length, 1)) * 43)),
        stage: "Анализируем слоты",
        detail: `Проверяем расписание врачей: ${index + 1} из ${cards.length}.`,
        loadedDoctors: cards.length,
        totalDoctors,
        analyzedDoctors: index + 1
      });
    }
  }

  await report({
    percent: 98,
    stage: "Готовим результат",
    detail: "Собираем списки врачей, Excel и коммерческое предложение.",
    loadedDoctors: rows.length,
    totalDoctors,
    analyzedDoctors: cards.length
  });

  const todayMoreThan3 = rows.filter(row => row.today.count > 3);
  const tomorrowMoreThan3 = rows.filter(row => row.tomorrow.count > 3);
  const targetRows = rows.filter(row => row.today.count > 3 || row.tomorrow.count > 3);

  return {
    ok: true,
    url: location.href,
    title: document.title,
    today,
    tomorrow,
    clinicTimeZone,
    loadedDoctors: rows.length,
    totalDoctors,
    loadMoreClicks: clicks,
    todayMoreThan3,
    tomorrowMoreThan3,
    targetRows,
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
      jobManager.cleanupJobs();
      const payload = JSON.parse(await readBody(req) || "{}");
      const url = normalizeNapopravkuUrl(String(payload.url || "").trim());
      if (!url) {
        sendJson(res, 400, { ok: false, message: "Вставьте ссылку на страницу клиники, врачей или специальности на napopravku.ru." });
        return;
      }
      const job = jobManager.createJob(url);
      sendJson(res, 202, jobManager.publicJob(job));
      return;
    }

    if (req.method === "POST" && req.url === "/api/export-xlsx") {
      const payload = JSON.parse(await readBody(req) || "{}");
      sendXlsx(res, Array.isArray(payload.rows) ? payload.rows : []);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/job/")) {
      jobManager.cleanupJobs();
      const id = decodeURIComponent(req.url.replace("/api/job/", "").split("?")[0]);
      const job = jobManager.getJob(id);
      if (!job) {
        sendJson(res, 404, { ok: false, message: "Анализ не найден. Запустите его еще раз." });
        return;
      }
      if (job.status === "queued" || job.status === "running") {
        sendJson(res, 200, jobManager.publicJob(job));
        return;
      }
      if (job.status === "failed") {
        sendJson(res, 409, job.data || {
          ok: false,
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          message: job.error || "Не удалось провести анализ."
        });
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
