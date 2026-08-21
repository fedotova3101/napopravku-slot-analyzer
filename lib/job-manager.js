export class JobManager {
  constructor({
    maxParallel = 5,
    analyze,
    now = () => Date.now(),
    idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ttlMs = 60 * 60 * 1000,
    analysisTimeoutMs = 15 * 60 * 1000
  } = {}) {
    if (typeof analyze !== "function") {
      throw new TypeError("JobManager requires an analyze function");
    }
    this.maxParallel = Math.max(1, Number(maxParallel || 1));
    this.analyze = analyze;
    this.now = now;
    this.idFactory = idFactory;
    this.ttlMs = ttlMs;
    this.analysisTimeoutMs = Math.max(1, Number(analysisTimeoutMs || 15 * 60 * 1000));
    this.jobs = new Map();
    this.pendingJobs = [];
    this.activeAnalyses = 0;
  }

  createJob(url) {
    const id = this.idFactory();
    const job = {
      id,
      url,
      status: "queued",
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
      progress: {
        percent: 0,
        stage: "Ожидает запуска",
        detail: "Анализ скоро начнется.",
        loadedDoctors: 0,
        totalDoctors: 0,
        analyzedDoctors: 0
      },
      data: null,
      error: null
    };
    this.jobs.set(id, job);
    this.pendingJobs.push(job);
    this.startNextJobs();
    return job;
  }

  getJob(id) {
    return this.jobs.get(id);
  }

  publicJob(job) {
    const queuePosition = job.status === "queued" ? this.pendingJobs.findIndex(pendingJob => pendingJob.id === job.id) + 1 : 0;
    const progress = job.status === "queued"
      ? {
          ...job.progress,
          percent: 0,
          stage: "Анализ в очереди",
          detail: `Сейчас уже выполняется ${this.maxParallel} анализов. Ваш анализ начнется автоматически, когда освободится место.`,
          queuePosition,
          activeAnalyses: this.activeAnalyses,
          maxParallelAnalyses: this.maxParallel
        }
      : {
          ...job.progress,
          queuePosition,
          activeAnalyses: this.activeAnalyses,
          maxParallelAnalyses: this.maxParallel
        };

    return {
      ok: true,
      jobId: job.id,
      status: job.status,
      progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt
    };
  }

  updateJobProgress(job, patch = {}) {
    const percent = Number.isFinite(Number(patch.percent))
      ? Math.max(0, Math.min(100, Math.round(Number(patch.percent))))
      : job.progress.percent;
    job.progress = {
      ...job.progress,
      ...patch,
      percent
    };
  }

  startNextJobs() {
    while (this.activeAnalyses < this.maxParallel && this.pendingJobs.length) {
      const job = this.pendingJobs.shift();
      this.activeAnalyses += 1;
      job.status = "running";
      job.startedAt = this.now();
      this.updateJobProgress(job, {
        percent: 2,
        stage: "Запускаем анализ",
        detail: "Открываем страницу НаПоправку в фоновом браузере."
      });

      this.runAnalysis(job)
        .then(data => {
          job.status = data.status === "partial" ? "partial" : data.ok ? "done" : "failed";
          job.finishedAt = this.now();
          if (data.ok) {
            this.updateJobProgress(job, {
              percent: 100,
              stage: "Готово",
              detail: "Анализ завершен."
            });
          } else if (job.status === "partial") {
            this.updateJobProgress(job, {
              percent: 100,
              stage: "Анализ остановлен",
              detail: data.message || "Расписание найдено, но результат нельзя показать надежно."
            });
          } else {
            this.updateJobProgress(job, {
              percent: 100,
              stage: "Анализ остановлен",
              detail: data.message || "Не удалось провести анализ."
            });
          }
          job.data = {
            ...data,
            jobId: job.id,
            status: job.status,
            progress: job.progress
          };
        })
        .catch(error => {
          job.status = "failed";
          job.error = error.message || "Не удалось провести анализ.";
          job.finishedAt = this.now();
          this.updateJobProgress(job, {
            percent: 100,
            stage: "Анализ остановлен",
            detail: job.error
          });
        })
        .finally(() => {
          this.activeAnalyses -= 1;
          this.startNextJobs();
        });
    }
  }

  runAnalysis(job) {
    const controller = new AbortController();
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("Анализ шел слишком долго и был остановлен. Запустите его еще раз."));
      }, this.analysisTimeoutMs);
    });
    const analysis = this.analyze(job.url, job, patch => this.updateJobProgress(job, patch), controller.signal);
    return Promise.race([analysis, timeout]).finally(() => clearTimeout(timeoutId));
  }

  cleanupJobs() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && job.finishedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}
