const form = document.querySelector("#analyzeForm");
const input = document.querySelector("#urlInput");
const button = document.querySelector("#analyzeButton");
const statusPill = document.querySelector("#statusPill");
const notice = document.querySelector("#notice");
const summary = document.querySelector("#summary");
const resultsToolbar = document.querySelector("#resultsToolbar");
const results = document.querySelector("#results");
const allBlock = document.querySelector("#allBlock");
const allContent = document.querySelector("#allContent");
const allToggle = document.querySelector("[data-toggle-all]");
const progressPanel = document.querySelector("#progressPanel");
const progressPercent = document.querySelector("#progressPercent");
const progressBar = document.querySelector("#progressBar");
const progressLoaded = document.querySelector("#progressLoaded");
const progressAnalyzed = document.querySelector("#progressAnalyzed");
const progressQueue = document.querySelector("#progressQueue");
const proposalBlock = document.querySelector("#proposalBlock");
const proposalText = document.querySelector("#proposalText");
const lists = {
  today: document.querySelector("#todayList"),
  tomorrow: document.querySelector("#tomorrowList")
};
const lastData = { value: null };

const proposalTemplate = `Здравствуйте!

Я проанализировала расписание врачей вашей клиники и обратила внимание, что у некоторых специалистов на сегодня-завтра остаются свободные окна. Такие слоты особенно важно закрывать оперативно: смена врача уже запланирована, ресурсы клиники задействованы, но при незаполненном расписании часть потенциальной выручки может быть потеряна.

В этой ситуации можно точечно подключить Горящие слоты и Аукцион на НаПоправку. Горящие слоты помогут выделить ближайшие окна для пациентов с помощью специальной скидки и дополнительной подсветки, а Аукцион повысит видимость нужных врачей или услуг в выдаче. Так мы будем продвигать не всех специалистов подряд, а именно тех, кому сейчас нужна дозагрузка.

Это позволит быстрее закрывать свободные окна на ближайшие даты, снизить простой врачей и получить дополнительные записи без массового снижения цен по всей клинике.`;

function setBusy(isBusy) {
  button.disabled = isBusy;
  button.textContent = isBusy ? "Идет анализ..." : "Анализировать";
  statusPill.textContent = isBusy ? "Анализ" : "Готово";
  statusPill.classList.toggle("busy", isBusy);
}

function resetOutput() {
  summary.hidden = true;
  resultsToolbar.hidden = true;
  results.hidden = true;
  allBlock.hidden = true;
  proposalBlock.hidden = true;
  document.querySelector("#allRows").innerHTML = "";
  toggleAllDoctors(false);
}

function showNotice(message = "") {
  notice.hidden = !message;
  notice.textContent = message;
}

function updateProgress(progress = {}) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent || 0))));
  const queuePosition = Number(progress.queuePosition || 0);
  progressPanel.hidden = false;
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  const loaded = Number(progress.loadedDoctors || 0);
  const total = Number(progress.totalDoctors || 0);
  const analyzed = Number(progress.analyzedDoctors || 0);
  progressLoaded.textContent = total ? `Врачей найдено: ${loaded} из ${total}` : `Врачей найдено: ${loaded}`;
  progressAnalyzed.textContent = `Проверено: ${analyzed}`;
  progressQueue.hidden = !queuePosition;
  progressQueue.textContent = queuePosition ? `Позиция в очереди: ${queuePosition}` : "";
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Сервер анализа перезапустился во время работы. Запустите анализ еще раз.");
  }
}

async function waitForJob(jobId) {
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 1800));
    const response = await fetch(`/api/job/${encodeURIComponent(jobId)}`);
    const data = await readJsonResponse(response);
    if (data.progress) updateProgress(data.progress);
    statusPill.textContent = data.status === "queued" ? "Очередь" : "Анализ";
    if (data.status === "queued" || data.status === "running") continue;
    if (!response.ok || !data.ok) throw new Error(data.message || "Не удалось провести анализ.");
    return data;
  }
  throw new Error("Анализ идет слишком долго. Попробуйте запустить его еще раз.");
}

function doctorCard(row, dayKey) {
  const count = row[dayKey].count;
  const times = row[dayKey].times.join(", ");
  const clinic = [row.clinic, row.address].filter(Boolean).join(", ");
  return `
    <article class="doctor-card">
      <strong>${escapeHtml(row.name)}</strong>
      <div class="meta">${escapeHtml(row.specialties || "Специализация не указана")}</div>
      <div class="meta">${escapeHtml(clinic || "Клиника не указана")}</div>
      <div class="slot-line">${count} слотов: ${escapeHtml(times)}</div>
    </article>
  `;
}

function renderList(container, rows, dayKey) {
  if (!rows.length) {
    container.innerHTML = `<div class="empty">Врачей с более чем 3 свободными слотами не найдено.</div>`;
    return;
  }
  container.innerHTML = rows.map(row => doctorCard(row, dayKey)).join("");
}

function renderAllRows(rows) {
  const withSlots = rows.filter(row => row.today.count > 0 || row.tomorrow.count > 0);
  document.querySelector("#allRows").innerHTML = withSlots.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.name)}</strong><div class="meta">${escapeHtml(row.specialties || "")}</div></td>
      <td>${row.today.count ? `${row.today.count}: ${escapeHtml(row.today.times.join(", "))}` : "0"}</td>
      <td>${row.tomorrow.count ? `${row.tomorrow.count}: ${escapeHtml(row.tomorrow.times.join(", "))}` : "0"}</td>
      <td>${escapeHtml([row.clinic, row.address].filter(Boolean).join(", "))}</td>
    </tr>
  `).join("");
}

function toggleAllDoctors(isExpanded = !allContent.hidden) {
  allContent.hidden = !isExpanded;
  allToggle.setAttribute("aria-expanded", String(isExpanded));
  allToggle.setAttribute("aria-label", isExpanded ? "Скрыть полный список" : "Показать полный список");
  allToggle.querySelector(".chevron").textContent = isExpanded ? "⌃" : "⌄";
}

function render(data) {
  lastData.value = data;
  updateProgress({ ...(data.progress || {}), percent: 100 });
  document.querySelector("#loadedDoctors").textContent = data.loadedDoctors;
  document.querySelector("#totalDoctors").textContent = data.totalDoctors;
  document.querySelector("#todayCount").textContent = data.todayMoreThan3.length;
  document.querySelector("#tomorrowCount").textContent = data.tomorrowMoreThan3.length;
  document.querySelector("#todayTitle").textContent = `Сегодня, ${data.today}`;
  document.querySelector("#tomorrowTitle").textContent = `Завтра, ${data.tomorrow}`;
  renderList(lists.today, data.todayMoreThan3, "today");
  renderList(lists.tomorrow, data.tomorrowMoreThan3, "tomorrow");
  renderAllRows(data.allDoctors);
  proposalText.value = buildProposal(data);
  summary.hidden = false;
  resultsToolbar.hidden = false;
  results.hidden = false;
  allBlock.hidden = false;
  toggleAllDoctors(false);
  proposalBlock.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rowsForExport(data) {
  return (data.targetRows?.length ? data.targetRows : data.allDoctors.filter(row => row.today.count > 3 || row.tomorrow.count > 3));
}

function rowsForExcelExport(data) {
  const rows = rowsForExport(data);
  return rows.flatMap(row => {
    const clinic = [row.clinic, row.address].filter(Boolean).join(", ");
    const base = {
      name: row.name,
      specialties: row.specialties,
      clinic: row.clinic || clinic,
      address: row.address,
      fullClinic: clinic
    };
    const dayRows = [];
    if (row.today.count > 3) {
      dayRows.push({
        ...base,
        day: `Сегодня, ${data.today}`,
        count: row.today.count,
        times: row.today.times.join(", ")
      });
    }
    if (row.tomorrow.count > 3) {
      dayRows.push({
        ...base,
        day: `Завтра, ${data.tomorrow}`,
        count: row.tomorrow.count,
        times: row.tomorrow.times.join(", ")
      });
    }
    return dayRows;
  });
}

function rowsToText(rows, dayKey) {
  if (!rows.length) return "Врачей с более чем 3 свободными слотами не найдено.";
  return rows.map(row => {
    const clinic = [row.clinic, row.address].filter(Boolean).join(", ");
    return `${row.name} — ${row[dayKey].count} слотов (${row[dayKey].times.join(", ")})${clinic ? ` — ${clinic}` : ""}`;
  }).join("\n");
}

function buildProposal(data) {
  const rows = rowsForExport(data);
  if (!rows.length) return proposalTemplate;
  const doctorLines = rows.map(row => {
    const today = row.today.count ? `сегодня: ${row.today.times.join(", ")}` : "";
    const tomorrow = row.tomorrow.count ? `завтра: ${row.tomorrow.times.join(", ")}` : "";
    const slots = [today, tomorrow].filter(Boolean).join("; ");
    const clinic = [row.clinic, row.address].filter(Boolean).join(", ");
    return `- ${row.name}${row.specialties ? `, ${row.specialties}` : ""}${clinic ? ` (${clinic})` : ""}: ${slots}.`;
  }).join("\n");
  return `${proposalTemplate}

По результатам анализа свободные окна больше 3 слотов найдены у следующих специалистов:
${doctorLines}`;
}

function downloadExcel(data) {
  const rows = rowsForExcelExport(data);
  const header = ["Врач", "Специализация", "Филиал / клиника", "Адрес", "День", "Количество окон", "Время окон"];
  const bodyRows = rows.map(row => [
    row.name,
    row.specialties,
    row.clinic,
    row.address,
    row.day,
    row.count,
    row.times
  ]);
  const tableRows = [header, ...bodyRows].map(values => `<Row>${values.map(value => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`).join("");
  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Свободные окна">
    <Table>${tableRows}</Table>
  </Worksheet>
</Workbook>`;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `napopravku-slots-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

document.addEventListener("click", async event => {
  if (event.target?.closest("[data-toggle-all]")) {
    toggleAllDoctors(allContent.hidden);
    return;
  }

  const copyType = event.target?.dataset?.copy;
  if (copyType && lastData.value) {
    const data = lastData.value;
    const text = copyType === "today"
      ? rowsToText(data.todayMoreThan3, "today")
      : copyType === "tomorrow"
        ? rowsToText(data.tomorrowMoreThan3, "tomorrow")
        : data.allDoctors.map(row => `${row.name}\tсегодня: ${row.today.count}\tзавтра: ${row.tomorrow.count}`).join("\n");
    await navigator.clipboard.writeText(text);
    event.target.textContent = "Скопировано";
    setTimeout(() => {
      event.target.textContent = copyType === "all" ? "Скопировать все" : "Скопировать список";
    }, 1400);
  }

  if (event.target?.hasAttribute("data-download-excel") && lastData.value) {
    downloadExcel(lastData.value);
  }

  if (event.target?.hasAttribute("data-copy-proposal")) {
    await navigator.clipboard.writeText(proposalText.value);
    event.target.textContent = "Скопировано";
    setTimeout(() => {
      event.target.textContent = "Скопировать КП";
    }, 1400);
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  showNotice("");
  resetOutput();
  updateProgress({ percent: 0, loadedDoctors: 0, analyzedDoctors: 0 });
  setBusy(true);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: input.value.trim() })
    });
    const started = await readJsonResponse(response);
    if (started.progress) updateProgress(started.progress);
    if (!response.ok || !started.ok) throw new Error(started.message || "Не удалось провести анализ.");
    const data = started.jobId ? await waitForJob(started.jobId) : started;
    render(data);
    const gap = data.totalDoctors && data.loadedDoctors < data.totalDoctors ? ` Загружено ${data.loadedDoctors} из ${data.totalDoctors}; возможно, сайт ограничил подгрузку.` : "";
    showNotice(`Готово. Нажатий «Показать ещё»: ${data.loadMoreClicks}.${gap}`);
  } catch (error) {
    showNotice(error.message || "Не удалось провести анализ.");
  } finally {
    setBusy(false);
  }
});
