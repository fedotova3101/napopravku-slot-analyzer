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

test("starts only the configured number of jobs and queues the next one", async () => {
  const runs = [];
  const manager = new JobManager({
    maxParallel: 5,
    analyze: (_url, job) => {
      const run = deferred();
      runs.push({ job, run });
      return run.promise;
    }
  });

  const jobs = Array.from({ length: 6 }, (_, index) => manager.createJob(`https://napopravku.ru/${index}`));

  assert.equal(runs.length, 5);
  assert.deepEqual(jobs.slice(0, 5).map(job => manager.publicJob(job).status), ["running", "running", "running", "running", "running"]);
  assert.equal(manager.publicJob(jobs[5]).status, "queued");
  assert.equal(manager.publicJob(jobs[5]).progress.queuePosition, 1);

  runs.forEach(({ run }) => run.resolve({ ok: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  runs[5]?.run.resolve({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 0));
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
