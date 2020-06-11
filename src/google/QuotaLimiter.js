'use strict';

const CONCURRENCY = 16;
const DELAY_AFTER_ERROR = 5;

export class QuotaLimiter {

  constructor(initialJobs = []) {
    this.jobs = [].concat((initialJobs || []));
    this.running = 0;
    setInterval(() => {
      this.handleQueue();
      if (this.saveHandler) {
        this.saveHandler(this.jobs.filter(job => !!job.ts));
      }
    }, 500);
    setInterval(() => {
      this.speedup();
    }, 5000);
  }

  setInitialLimit(queries, seconds) {
    this.initialLimit = { queries, seconds };
    this.setLimit(queries, seconds);
  }

  slowdown() {
    const newLimits = {};
    if (this.currentLimit.seconds > 1) {
      newLimits.queries = Math.floor(this.currentLimit.queries / 2);
      newLimits.seconds = Math.floor(this.currentLimit.seconds / 2);
    } else {
      newLimits.queries = Math.floor(this.currentLimit.queries / 2);
      newLimits.seconds = 1;
    }

    if (this.setLimit(newLimits.queries, newLimits.seconds)) {
      console.log('QuotaError, exponential slowdown: ' + newLimits.queries + ' queries per ' + newLimits.seconds + ' sec');
    }
  }

  speedup() {
    const newLimits = {};
    newLimits.queries = this.currentLimit.queries + 1;
    newLimits.seconds = this.currentLimit.seconds;
    this.setLimit(newLimits.queries, newLimits.seconds);
  }

  setLimit(queries, seconds) {
    if (seconds <= 0) return false;
    if (queries <= 0) return false;

    const now = +new Date() / 1000;

    if (this.currentLimit) {
      if (now - this.currentLimit.ts < DELAY_AFTER_ERROR) { // Don't add limits more often than once 10s
        return false;
      }
      this.currentLimit = { queries, seconds, ts: now };
    } else {
      this.currentLimit = { queries, seconds, ts: 0 }; // Because of DELAY_AFTER_ERROR in handleQueue
    }

    return true;
  }

  addJob(func) {
    this.jobs.push({
      done: false,
      func
    });
  }

  handleQueue() {
    if (this.running > CONCURRENCY) {
      return;
    }
    const now = +new Date() / 1000;
    const lastTs = this.currentLimit.ts;

    if (now - lastTs < DELAY_AFTER_ERROR) { // Limit added within last 10s
      return;
    }

    let maxLimiterSeconds = this.currentLimit ? this.currentLimit.seconds : 0;
    this.removeOlderThan(now - maxLimiterSeconds);

    let availableQuota = this.calculateAvailableQuota(now);


    while (availableQuota > 0) {
      const notStartedJob = this.jobs.find(job => !job.ts && job.func);
      if (!notStartedJob) {
        break;
      }

      availableQuota--;
      notStartedJob.ts = now;
      this.running++;
      process.nextTick(() => {

      notStartedJob.func()
        .then(() => {
          this.running--;
        })
        .catch(async (err) => {
          if (err.isQuotaError && this.currentLimit) {
            this.slowdown();
          }

          this.running--;
        });

      });
    }
  }

  removeOlderThan(minTime) {
    this.jobs = this.jobs.filter(job => !job.ts || job.ts >= minTime);
  }

  calculateAvailableQuota(now) {
    let availableQuota = CONCURRENCY;

    const limit = this.currentLimit;
    const quotaUsed = this.jobs.filter(job => !!job.ts && (now - job.ts) < limit.seconds).length;

    if (availableQuota > limit.queries - quotaUsed) {
      availableQuota = limit.queries - quotaUsed;
    }

    return availableQuota;
  }

  setSaveHandler(handler) {
    this.saveHandler = handler;
  }
}
