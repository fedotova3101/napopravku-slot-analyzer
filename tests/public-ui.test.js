import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

async function readPublicFile(name) {
  return readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
}

async function readLibFile(name) {
  return readFile(new URL(`../lib/${name}`, import.meta.url), "utf8");
}

test("public UI keeps proposal before doctor results", async () => {
  const html = await readPublicFile("index.html");

  const proposalIndex = html.indexOf('id="proposalBlock"');
  const resultsIndex = html.indexOf('id="results"');

  assert.ok(proposalIndex > -1, "The editable proposal block must exist.");
  assert.ok(resultsIndex > -1, "The doctor results block must exist.");
  assert.ok(
    proposalIndex < resultsIndex,
    "The proposal should appear before doctor result lists so colleagues can copy it first."
  );
});

test("progress panel shows only quiet metrics instead of technical stages", async () => {
  const html = await readPublicFile("index.html");
  const appJs = await readPublicFile("app.js");

  assert.doesNotMatch(html, /progressStage|progressDetail/);
  assert.doesNotMatch(appJs, /progressStage|progressDetail/);
  assert.match(html, /id="progressPercent"/);
  assert.match(html, /id="progressLoaded"/);
  assert.match(html, /id="progressAnalyzed"/);
  assert.match(html, /id="progressQueue"/);
});

test("public UI uses orange Napopravku branding without internal tool label", async () => {
  const html = await readPublicFile("index.html");
  const css = await readPublicFile("style.css");

  assert.match(html, /class="brand-logo"/);
  assert.doesNotMatch(html, /внутренний инструмент/);
  assert.match(css, /--brand:\s*#ff6b00/);
  assert.doesNotMatch(css, /--brand:\s*#00a88f/);
});

test("target results expose shared Excel export before doctor lists", async () => {
  const html = await readPublicFile("index.html");

  const toolbarIndex = html.indexOf('class="results-toolbar"');
  const excelIndex = html.indexOf("data-download-excel");
  const resultsIndex = html.indexOf('id="results"');

  assert.ok(toolbarIndex > -1, "Results toolbar must exist.");
  assert.ok(excelIndex > toolbarIndex, "Excel button must live in the results toolbar.");
  assert.ok(excelIndex < resultsIndex, "Excel button should appear before today and tomorrow lists.");
});

test("all found doctors section is collapsed by default", async () => {
  const html = await readPublicFile("index.html");
  const appJs = await readPublicFile("app.js");

  assert.match(html, /data-toggle-all/);
  assert.match(html, /id="allContent"\s+hidden/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(appJs, /toggleAllDoctors/);
});

test("Excel export is one manager-friendly table split by day rows", async () => {
  const appJs = await readPublicFile("app.js");
  const xlsxExportJs = await readLibFile("xlsx-export.js");

  assert.match(appJs, /rowsForExcelExport/);
  assert.match(appJs, /fetch\("\/api\/export-xlsx"/);
  assert.match(appJs, /napopravku-slots-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.xlsx/);
  assert.match(xlsxExportJs, /"День"/);
  assert.match(xlsxExportJs, /"Количество окон"/);
  assert.match(xlsxExportJs, /"Время окон"/);
  assert.doesNotMatch(appJs, /application\/vnd\.ms-excel/);
  assert.doesNotMatch(appJs, /\.xls`/);
  assert.doesNotMatch(appJs, /"Окна на сегодня"/);
  assert.doesNotMatch(appJs, /"Окна на завтра"/);
});

test("proposal uses updated default text and lists only doctors with specialties", async () => {
  const appJs = await readPublicFile("app.js");

  assert.match(appJs, /const proposalTemplate = `Добрый день!/);
  assert.doesNotMatch(appJs, /Это позволит быстрее закрывать свободные окна/);
  assert.match(appJs, /По результатам анализа свободные окна больше 3 слотов найдены у следующих специалистов:/);
  assert.doesNotMatch(appJs, /const today = row\.today\.count/);
  assert.doesNotMatch(appJs, /const tomorrow = row\.tomorrow\.count/);
  assert.doesNotMatch(appJs, /const slots = \[today, tomorrow\]/);
  assert.match(appJs, /`- \$\{row\.name\}\$\{row\.specialties \? `, \$\{row\.specialties\}` : ""\}\.`/);
});
