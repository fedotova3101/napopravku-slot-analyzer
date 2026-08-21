import test from "node:test";
import assert from "node:assert/strict";

import { JobManager } from "../lib/job-manager.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

test("starts three jobs and keeps fourth, fifth, and sixth jobs queued in order", async () => {
  const runs = [];
  const manager = new JobManager({
    maxParallel: 3,
    analyze: (_url, job) => {
      const run = deferred();
      runs.push({ job, run });
      return run.promise;
    }
  });

  const jobs = Array.from({ length: 6 }, (_, index) => manager.createJob(`https://napopravku.ru/${index}`));

  assert.equal(runs.length, 3);
  assert.deepEqual(jobs.slice(0, 3).map(job => manager.publicJob(job).status), ["running", "running", "running"]);
  assert.deepEqual(jobs.slice(3).map(job => manager.publicJob(job).status), ["queued", "queued", "queued"]);
  assert.deepEqual(jobs.slice(3).map(job => manager.publicJob(job).progress.queuePosition), [1, 2, 3]);

  runs[0].run.resolve({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(manager.publicJob(jobs[3]).status, "running");
  assert.equal(manager.publicJob(jobs[4]).status, "queued");
  assert.equal(manager.publicJob(jobs[4]).progress.queuePosition, 1);
  assert.equal(manager.publicJob(jobs[5]).status, "queued");
  assert.equal(manager.publicJob(jobs[5]).progress.queuePosition, 2);

  while (runs.some(({ job }) => manager.publicJob(job).status === "running")) {
    const activeRuns = runs.filter(({ job }) => manager.publicJob(job).status === "running");
    activeRuns.forEach(({ run }) => run.resolve({ ok: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  assert.deepEqual(jobs.map(job => manager.publicJob(job).status), ["done", "done", "done", "done", "done", "done"]);
});

test("starts the first queued job after an active job finishes", async () => {
  const runs = [];
  const manager = new JobManager({
    maxParallel: 1,
    analyze: (_url, job) => {
      const run = deferred();
      runs.push({ job, run });
      return run.promise;
    }
  });

  const first = manager.createJob("https://napopravku.ru/first");
  const second = manager.createJob("https://napopravku.ru/second");

  assert.equal(manager.publicJob(first).status, "running");
  assert.equal(manager.publicJob(second).status, "queued");

  runs[0].run.resolve({ ok: true, result: "first done" });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(manager.publicJob(first).status, "done");
  assert.equal(manager.publicJob(second).status, "running");
  assert.equal(runs.length, 2);

  runs[1].run.resolve({ ok: true, result: "second done" });
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("cleanup keeps queued and running jobs even when they are old", async () => {
  let now = 10_000_000;
  const runs = [];
  const manager = new JobManager({
    maxParallel: 1,
    now: () => now,
    analyze: () => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    }
  });

  const running = manager.createJob("https://napopravku.ru/running");
  const queued = manager.createJob("https://napopravku.ru/queued");

  now += 2 * 60 * 60 * 1000;
  manager.cleanupJobs();

  assert.equal(manager.getJob(running.id), running);
  assert.equal(manager.getJob(queued.id), queued);

  runs[0].resolve({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  runs[1].resolve({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("marks a stuck job as failed and frees the next queued job", async () => {
  const runs = [];
  const manager = new JobManager({
    maxParallel: 1,
    analysisTimeoutMs: 5,
    analyze: (_url, job, _updateProgress, signal) => {
      runs.push(job);
      if (job.url.includes("/next")) {
        return Promise.resolve({ ok: true, result: "next done" });
      }
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });

  const stuck = manager.createJob("https://napopravku.ru/stuck");
  const next = manager.createJob("https://napopravku.ru/next");

  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(manager.publicJob(stuck).status, "failed");
  assert.equal(manager.publicJob(next).status, "done");
  assert.equal(runs.length, 2);
});

test("finalizes unreliable partial analysis at 100 percent instead of leaving it at 98", async () => {
  const manager = new JobManager({
    maxParallel: 1,
    analyze: (_url, _job, updateProgress) => {
      updateProgress({
        percent: 98,
        stage: "Готовим результат",
        loadedDoctors: 56,
        totalDoctors: 56,
        analyzedDoctors: 56
      });
      return Promise.resolve({
        ok: false,
        status: "partial",
        message: "Расписание есть, но даты не распознаны надежно."
      });
    }
  });

  const job = manager.createJob("https://napopravku.ru/partial");
  await new Promise(resolve => setTimeout(resolve, 0));

  const publicJob = manager.publicJob(job);
  assert.equal(publicJob.status, "partial");
  assert.equal(publicJob.progress.percent, 100);
  assert.equal(publicJob.progress.loadedDoctors, 56);
  assert.equal(publicJob.progress.totalDoctors, 56);
  assert.equal(publicJob.progress.analyzedDoctors, 56);
  assert.equal(publicJob.progress.stage, "Анализ остановлен");
});

test("finalizes failed analysis at 100 percent so the UI cannot look stuck", async () => {
  const manager = new JobManager({
    maxParallel: 1,
    analyze: (_url, _job, updateProgress) => {
      updateProgress({ percent: 98, analyzedDoctors: 4, totalDoctors: 4 });
      return Promise.resolve({ ok: false, message: "Не удалось надежно разобрать расписание." });
    }
  });

  const job = manager.createJob("https://napopravku.ru/failed");
  await new Promise(resolve => setTimeout(resolve, 0));

  const publicJob = manager.publicJob(job);
  assert.equal(publicJob.status, "failed");
  assert.equal(publicJob.progress.percent, 100);
  assert.equal(publicJob.progress.stage, "Анализ остановлен");
});
