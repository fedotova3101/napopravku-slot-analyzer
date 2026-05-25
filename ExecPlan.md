# ExecPlan: Stabilize and Finish Napopravku Slot Analyzer

This document is self-contained. A reader does not need previous conversation context to continue the work.

## Current State

The project is a Node.js web service that analyzes public doctor schedule pages on `napopravku.ru`. A manager opens the analyzer site, pastes a Napopravku clinic/doctors/specialty URL, and receives a list of doctors with more than 3 available appointment slots today or tomorrow.

Definitions used in this document:

- **Slot**: a visible appointment time on a doctor's card, for example `09:00` or `14:30`.
- **Doctor card**: one rendered doctor block on a Napopravku page.
- **Job**: one analyzer request started by one user. A job has its own ID, progress, status, and result.
- **Progress**: the percentage, stage label, and detail text shown while a job is running.
- **Headless browser**: Chromium running in the background through Playwright, without opening a visible browser window for the user.
- **Render**: the hosting service that runs the public analyzer as a Docker web service.
- **Worker**: the part of the server that performs the heavy Playwright analysis for a job.

Key project files:

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/server.js`
  - Node HTTP server.
  - Serves static files from `public/`.
  - Exposes `POST /api/analyze` and `GET /api/job/:id`.
  - Launches Playwright Chromium.
  - Reuses one shared Chromium process and creates a separate browser context per analysis job to reduce memory pressure on Render.
  - Blocks images, media, fonts, and stylesheets in Playwright contexts because slot analysis only needs DOM text.
  - Delegates in-memory jobs, progress, and parallel analysis limits to `lib/job-manager.js`.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/lib/job-manager.js`
  - Owns `JobManager`.
  - Creates one `jobId` per request.
  - Keeps `queued`, `running`, `done`, and `failed` states separate per job.
  - Enforces the parallel analysis limit and starts queued jobs in order.
  - Stops stuck jobs by timeout so they cannot hold the queue forever.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/lib/browser-options.js`
  - Builds Chromium launch options.
  - Avoids forcing Chromium into single-process mode, which is risky for five parallel analyses.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/lib/analyzer-timings.js`
  - Defines bounded waits for page loading, doctor loading, `Показать ещё`, and slot switching.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/lib/url-normalizer.js`
  - Accepts clinic, `/vrachi/`, and specialty `/doctors/.../` Napopravku links.
  - Rejects non-Napopravku and unsafe URLs before a job is created.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/index.html`
  - Main analyzer page.
  - Contains the URL form, progress panel, result sections, Excel button, and commercial proposal block.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/app.js`
  - Browser-side JavaScript.
  - Starts analysis jobs, polls job status, renders results, downloads Excel, and builds the editable commercial proposal text.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/style.css`
  - UI styles for the page, progress panel, result tables, and proposal block.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/package.json`
  - Project metadata.
  - Defines `npm start` as `node server.js`.
  - Defines `npm test` as `node --test tests/*.test.js`.
  - Uses Playwright `1.59.1`.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/Dockerfile`
  - Builds the service from `mcr.microsoft.com/playwright:v1.59.1-noble`.
  - Installs production dependencies.
  - Starts `npm start`.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/render.yaml`
  - Render service blueprint.
  - Sets `PLAYWRIGHT_HEADLESS=true`.
  - Sets `MAX_PARALLEL_ANALYSES=5`.
  - Sets `ANALYSIS_TIMEOUT_MS=900000`.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/README.md`
  - User-facing project description.

- `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/Agens.Md`
  - Agent instructions: stack, commands, code rules, and self-check steps.

The current implementation contains support for:

- per-job progress;
- multiple jobs with a configurable parallel limit;
- faster Playwright waits;
- Excel download from the browser;
- editable commercial proposal text.
- tests for queueing, stuck-job timeout, Chromium options, and bounded waits.
- tests for accepted and rejected Napopravku URLs.

These changes still need local browser/API validation and publication to GitHub/Render.

## Plan of Work

First, validate the edited code. In `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/lib/job-manager.js`, run tests and inspect the lifecycle around `createJob`, `publicJob`, `updateJobProgress`, `startNextJobs`, and `runAnalysis`. The goal is to confirm that each job moves from `queued` to `running` to either `done` or `failed`, that a stuck job times out, and that `GET /api/job/:id` returns the correct status for each state through `server.js`.

Second, verify the frontend wiring. In `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/index.html`, confirm that these elements exist and have IDs used by `public/app.js`: `progressPanel`, `progressStage`, `progressDetail`, `progressPercent`, `progressBar`, `progressLoaded`, `progressAnalyzed`, `proposalBlock`, and `proposalText`. In `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/app.js`, confirm that `updateProgress`, `waitForJob`, `render`, `downloadExcel`, and `buildProposal` use those IDs.

Third, run a local server smoke test. Start the server from the project root. Load `http://localhost:4355`. Confirm that the page opens and no browser console errors appear. Submit a known Napopravku URL. Confirm that a job ID is created and the progress panel updates. This validates the API and UI connection.

Fourth, test the API directly. Use `curl` to call `POST /api/analyze`, copy the returned `jobId`, then poll `GET /api/job/<jobId>`. This proves that the service works even without the UI and that each job has independent progress.

Fifth, validate the result behavior after a completed analysis. In the UI, confirm that the result cards show doctors with more than 3 slots today or tomorrow, the summary counters update, the Excel button downloads a file with one table, and the commercial proposal block appears with editable text and a copied proposal.

Sixth, validate parallel behavior. Start six analyses close together from browser tabs or `curl` commands. Confirm that the first five jobs can run at the same time, the sixth job returns `queued`, the UI shows `Анализ в очереди`, and the queued job starts automatically after one active job finishes. Confirm that every response has a different `jobId`, every `GET /api/job/:id` returns its own progress, and results do not mix. This matters because multiple managers may use the analyzer at the same time.

Seventh, prepare publication. If validation passes, commit the changed files and deploy through GitHub/Render. If validation fails, fix only the narrow failing area, then rerun the same validation steps.

## Concrete Steps

All commands in this section run from:

```bash
cd "/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами"
```

Step 1: confirm the project files are present.

```bash
pwd
rg --files
```

Expected transcript:

```text
/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами
server.js
public/app.js
public/index.html
public/style.css
package.json
Dockerfile
render.yaml
README.md
Agens.Md
ExecPlan.md
```

Step 2: check JavaScript syntax.

```bash
node --check server.js
node --check public/app.js
node --check lib/job-manager.js
node --check lib/browser-options.js
node --check lib/analyzer-timings.js
```

Expected transcript:

```text
```

No output means the syntax check passed.

If the local shell does not have `node`, use the bundled Node available in this Codex environment:

```bash
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check server.js
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check public/app.js
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check lib/job-manager.js
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check lib/browser-options.js
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check lib/analyzer-timings.js
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check lib/url-normalizer.js
```

Expected transcript:

```text
```

Step 2.5: run automated tests.

```bash
npm test
```

If `npm` is unavailable in the local Codex environment:

```bash
/Users/go_ksen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.js
```

Expected transcript shape:

```text
tests 8
pass 8
fail 0
```

Step 3: install dependencies if `node_modules/` is missing.

```bash
npm install
```

Expected transcript, shortened:

```text
added ... packages
```

If dependencies are already installed, `npm install` may instead report that packages are up to date. That is also acceptable.

Step 4: start the local server.

```bash
npm start
```

Expected transcript:

```text
> napopravku-slot-analyzer@1.0.0 start
> node server.js

Дашборд открыт: http://localhost:4355
```

Keep this process running while performing browser and API checks. Stop it with `Ctrl+C` when done.

Step 5: exercise the API manually in a second terminal from the same working directory.

```bash
curl -sS -X POST http://localhost:4355/api/analyze \
  -H "content-type: application/json" \
  --data '{"url":"https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors"}'
```

Expected transcript shape:

```json
{"ok":true,"jobId":"...","status":"running","progress":{"percent":2,"stage":"Запускаем анализ",...}}
```

If five analyses are already running, the same endpoint returns `status: "queued"` instead.

Then poll the job:

```bash
curl -sS http://localhost:4355/api/job/<jobId>
```

Expected transcript while running:

```json
{"ok":true,"jobId":"...","status":"running","progress":{"percent":14,"stage":"Ждем данные",...}}
```

Expected transcript when finished:

```json
{"ok":true,"status":"done","todayMoreThan3":[...],"tomorrowMoreThan3":[...],"allDoctors":[...]}
```

Step 6: test invalid input.

```bash
curl -sS -X POST http://localhost:4355/api/analyze \
  -H "content-type: application/json" \
  --data '{"url":"https://example.com"}'
```

Expected transcript:

```json
{"ok":false,"message":"Вставьте ссылку на страницу клиники, врачей или специальности на napopravku.ru."}
```

Step 7: test parallel jobs and queue behavior.

```bash
for i in 1 2 3 4 5 6; do
  curl -sS -X POST http://localhost:4355/api/analyze \
    -H "content-type: application/json" \
    --data '{"url":"https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors"}'
  printf '\n'
done
```

Expected transcript shape:

```json
{"ok":true,"jobId":"first-id","status":"running",...}
{"ok":true,"jobId":"second-id","status":"running",...}
{"ok":true,"jobId":"third-id","status":"running",...}
{"ok":true,"jobId":"fourth-id","status":"running",...}
{"ok":true,"jobId":"fifth-id","status":"running",...}
{"ok":true,"jobId":"sixth-id","status":"queued","progress":{"stage":"Анализ в очереди","queuePosition":1,...}}
```

All six `jobId` values must be different. The sixth job must stay queued until one active analysis finishes.

Step 8: after validation, check changed files.

```bash
git status --short
```

Expected transcript shape:

```text
 M server.js
 M public/app.js
 M public/index.html
 M public/style.css
 M README.md
 M render.yaml
?? Agens.Md
?? ExecPlan.md
```

The exact list can differ if some files were already committed.

## Validation and Acceptance

Start the system with:

```bash
cd "/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами"
npm start
```

Open:

```text
http://localhost:4355
```

Acceptance behavior:

1. With input `https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors`, clicking `Анализировать` shows the progress panel. The panel must display a stage, detail text, a percentage, found doctor count, and checked doctor count.

2. While the job is running, `GET http://localhost:4355/api/job/<jobId>` returns JSON with `status` equal to `queued` or `running` and a `progress` object.

3. When the job succeeds, the UI displays:
   - summary counters;
   - doctors with more than 3 slots today;
   - doctors with more than 3 slots tomorrow;
   - all doctors with any found slots;
   - a `Скачать Excel` button;
   - a `Коммерческое предложение` block.

4. The Excel button downloads one `.xls` file. Opening the file shows one table with columns:
   - `Врач`
   - `Специализация`
   - `Филиал / клиника`
   - `Адрес`
   - `Окна на сегодня`
   - `Окна на завтра`
   - `Количество окон сегодня`
   - `Количество окон завтра`

5. The commercial proposal text area is editable. Clicking `Скопировать КП` copies the current edited text, not only the original template.

6. With invalid input `https://example.com`, the server returns a 400 response with a clear Russian message asking for a Napopravku clinic/doctors/specialty link.

7. When six analyses are started close together, each receives its own `jobId`. The first five jobs may run at once. The sixth job returns `status: "queued"`, includes `progress.queuePosition`, and later becomes `running` after one active job finishes. Polling each `jobId` shows independent progress and independent results.

There is no project test command yet. Use `node --check server.js` and `node --check public/app.js` as syntax validation, then use the manual API and browser checks above as functional validation.

## Idempotence and Recovery

Most validation steps are safe to repeat:

- `node --check ...` is read-only.
- `curl POST /api/analyze` creates temporary in-memory jobs only.
- Browser UI checks do not write project files.
- Restarting `npm start` is safe.

Potentially risky steps:

- Running many analyses at once can start multiple Chromium processes and use significant memory. The target is five simultaneous analyses on paid Render, but run six-job queue tests intentionally and watch memory/logs.
- `npm install` changes `package-lock.json` if the project starts tracking one in the future. Review changes before committing.
- Docker builds can consume disk space. Remove unused images if needed.

Safe recovery:

1. Stop the local server with `Ctrl+C`.
2. If Playwright or Chromium processes remain, close them from Activity Monitor or restart the terminal session.
3. If a code edit breaks syntax, run `node --check ...`, read the reported line, fix that file only, and rerun the same check.
4. If a UI change breaks the page, revert only the relevant file from version control after confirming it is not a user-authored unrelated change.

Keep the environment clean:

- Stop local servers before ending work.
- Do not leave extra visible Chrome windows from analyzer tests.
- Do not commit downloaded Excel files.
- Do not commit local archives such as `napopravku-slot-analyzer.zip` unless explicitly requested.

## Artifacts and Notes

Important snippets proving the current intended interfaces:

From `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/server.js`:

```js
const jobs = new Map();
const pendingJobs = [];
let activeAnalyses = 0;
const MAX_PARALLEL_ANALYSES = Math.max(1, Number(process.env.MAX_PARALLEL_ANALYSES || 5));
```

This proves that the server is designed to track separate jobs and limit concurrent analyses.

From `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/server.js`:

```js
function publicJob(job) {
  return {
    ok: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}
```

This is the response shape expected by the frontend while a job is not finished.

From `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/app.js`:

```js
function updateProgress(progress = {}) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent || 0))));
  progressPanel.hidden = false;
  progressStage.textContent = progress.stage || "Идет анализ";
  progressDetail.textContent = progress.detail || "Пожалуйста, подождите.";
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
}
```

This proves that progress returned by the server is visible to users.

Expected successful syntax-check transcript:

```text
$ node --check server.js
$ node --check public/app.js
```

No output means both files parse correctly.

## Interfaces and Dependencies

Use these libraries and services:

- Node.js built-in `node:http`, because the project intentionally avoids adding an Express-style framework.
- Node.js built-in `node:fs/promises`, `node:path`, and `node:child_process`, because they are already used in `server.js`.
- Playwright `chromium`, because the analyzer must load and interact with Napopravku pages that render client-side.
- Plain browser APIs in `public/app.js`, because the frontend currently has no build system and should remain simple.
- Render Docker Web Service, because the app needs a server-side browser and cannot be hosted on static hosting such as GitHub Pages.

Required server-side function signatures at the end of this milestone:

In `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/server.js`:

```js
function createJob(url) -> job
```

Creates one independent job, stores it, and starts or queues analysis.

```js
function publicJob(job) -> object
```

Returns the safe JSON representation of a queued or running job.

```js
function updateJobProgress(job, patch = {}) -> void
```

Merges progress updates into one job.

```js
function startNextJobs() -> void
```

Starts pending jobs while `activeAnalyses < MAX_PARALLEL_ANALYSES`.

```js
function normalizeNapopravkuUrl(value) -> string | null
```

Accepts supported Napopravku links and normalizes clinic links to `/vrachi/` where needed.

```js
async function navigateAndAnalyze(pageUrl, job) -> analysisResult
```

Launches Playwright Chromium and returns the analysis result.

```js
async function evaluateWithNavigationRetry(page, analyzer, job) -> analysisResult
```

Runs the page analyzer and retries if the Napopravku page navigates or rerenders during analysis.

```js
async function browserAnalyzer() -> analysisResult
```

Runs inside the browser page. It scrolls, clicks `Показать ещё`, reads doctor cards, counts slots, and reports progress through `window.reportAnalyzerProgress`.

Required API responses:

`POST /api/analyze` with body:

```json
{"url":"https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors"}
```

Returns:

```json
{"ok":true,"jobId":"...","status":"running","progress":{...}}
```

If all five parallel analysis slots are occupied, it returns:

```json
{"ok":true,"jobId":"...","status":"queued","progress":{"stage":"Анализ в очереди","queuePosition":1,"maxParallelAnalyses":5}}
```

`GET /api/job/:id` while running returns:

```json
{"ok":true,"jobId":"...","status":"running","progress":{...}}
```

`GET /api/job/:id` while queued returns:

```json
{"ok":true,"jobId":"...","status":"queued","progress":{"stage":"Анализ в очереди","queuePosition":1,"maxParallelAnalyses":5}}
```

`GET /api/job/:id` when done returns:

```json
{
  "ok": true,
  "status": "done",
  "todayMoreThan3": [],
  "tomorrowMoreThan3": [],
  "targetRows": [],
  "allDoctors": []
}
```

Required frontend functions at the end of this milestone:

In `/Users/go_ksen/Documents/Напоправку анализ врачей со свободными слотами/public/app.js`:

```js
function updateProgress(progress = {}) -> void
```

Updates the visible progress panel.

```js
async function waitForJob(jobId) -> analysisResult
```

Polls `GET /api/job/:id` until the job finishes.

```js
function render(data) -> void
```

Renders the completed analysis.

```js
function rowsForExport(data) -> Array
```

Returns rows with more than 3 slots today or tomorrow.

```js
function buildProposal(data) -> string
```

Builds the editable commercial proposal text.

```js
function downloadExcel(data) -> void
```

Downloads one `.xls` file containing one table.

## Change Notes

2026-05-22: Created this ExecPlan to make the next implementation and validation pass self-contained. The reason is to let a stateless agent or a human novice continue from the current repository state without relying on previous conversation history.

2026-05-25: Updated the plan for the required production queue behavior: five analyses may run simultaneously, while the sixth and later jobs remain queued with a visible queue status and automatically start when a running analysis finishes. The reason is that the analyzer is intended for several colleagues working at the same time on paid Render.
