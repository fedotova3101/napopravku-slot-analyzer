const form = document.querySelector("#analyzeForm");
const input = document.querySelector("#urlInput");
const button = document.querySelector("#analyzeButton");
const statusPill = document.querySelector("#statusPill");
const notice = document.querySelector("#notice");
const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
const allBlock = document.querySelector("#allBlock");
const lists = {
  today: document.querySelector("#todayList"),
  tomorrow: document.querySelector("#tomorrowList")
};
const lastData = { value: null };

function setBusy(isBusy) {
  button.disabled = isBusy;
  button.textContent = isBusy ? "Идет анализ..." : "Анализировать";
  statusPill.textContent = isBusy ? "Анализ" : "Готово";
  statusPill.classList.toggle("busy", isBusy);
}

function showNotice(message = "") {
  notice.hidden = !message;
  notice.textContent = message;
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

function render(data) {
  lastData.value = data;
  document.querySelector("#loadedDoctors").textContent = data.loadedDoctors;
  document.querySelector("#totalDoctors").textContent = data.totalDoctors;
  document.querySelector("#todayCount").textContent = data.todayMoreThan3.length;
  document.querySelector("#tomorrowCount").textContent = data.tomorrowMoreThan3.length;
  document.querySelector("#todayTitle").textContent = `Сегодня, ${data.today}`;
  document.querySelector("#tomorrowTitle").textContent = `Завтра, ${data.tomorrow}`;
  renderList(lists.today, data.todayMoreThan3, "today");
  renderList(lists.tomorrow, data.tomorrowMoreThan3, "tomorrow");
  renderAllRows(data.allDoctors);
  summary.hidden = false;
  results.hidden = false;
  allBlock.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rowsToText(rows, dayKey) {
  if (!rows.length) return "Врачей с более чем 3 свободными слотами не найдено.";
  return rows.map(row => {
    const clinic = [row.clinic, row.address].filter(Boolean).join(", ");
    return `${row.name} — ${row[dayKey].count} слотов (${row[dayKey].times.join(", ")})${clinic ? ` — ${clinic}` : ""}`;
  }).join("\n");
}

document.addEventListener("click", async event => {
  const copyType = event.target?.dataset?.copy;
  if (!copyType || !lastData.value) return;
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
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  showNotice("");
  setBusy(true);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: input.value.trim() })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || "Не удалось провести анализ.");
    render(data);
    const gap = data.totalDoctors && data.loadedDoctors < data.totalDoctors ? ` Загружено ${data.loadedDoctors} из ${data.totalDoctors}; возможно, сайт ограничил подгрузку.` : "";
    showNotice(`Готово. Нажатий «Показать ещё»: ${data.loadMoreClicks}.${gap}`);
  } catch (error) {
    showNotice(error.message || "Не удалось провести анализ.");
  } finally {
    setBusy(false);
  }
});
