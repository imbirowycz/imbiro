import type { Db, JobWithMetadata, PgBoss } from 'pg-boss'
import { QUEUES } from '../../core/boss'

// The queue of source checks. Jobs are created by the scheduler action and by "check now";
// nobody works the queue — the home collector claims jobs through the API and reports back.

export interface PriceCheckJobData {
  sourceId: string
  /** schedule = planned, now = "check now", confirm = re-check of a suspicious result. */
  reason: 'schedule' | 'now' | 'confirm'
}

export type PriceCheckJob = JobWithMetadata<PriceCheckJobData>

export class PriceQueue {
  constructor(private readonly boss: PgBoss) {}

  /** Returns null when the same check already waits (one job per source and reason). */
  async enqueue(data: PriceCheckJobData, options: { startAfter?: Date; db?: Db } = {}): Promise<string | null> {
    return this.boss.send(QUEUES.priceCheck, data, {
      singletonKey: data.reason === 'schedule' ? data.sourceId : `${data.sourceId}:${data.reason}`,
      // A check the user asked for goes before the planned ones.
      priority: data.reason === 'now' ? 10 : 0,
      startAfter: options.startAfter,
      db: options.db,
    })
  }

  /** Takes up to `limit` ready jobs; they stay "active" until completed, failed or expired. */
  async claim(limit: number): Promise<PriceCheckJob[]> {
    return this.boss.fetch<PriceCheckJobData>(QUEUES.priceCheck, { batchSize: limit, includeMetadata: true })
  }

  async find(jobId: string): Promise<PriceCheckJob | null> {
    const [job] = await this.boss.findJobs<PriceCheckJobData>(QUEUES.priceCheck, { id: jobId })
    return job ?? null
  }

  async complete(jobId: string, output: object): Promise<void> {
    await this.boss.complete(QUEUES.priceCheck, jobId, output)
  }

  /** Failing a job with retries left puts it back in the queue (with the queue's backoff). */
  async fail(jobId: string, output: object): Promise<void> {
    await this.boss.fail(QUEUES.priceCheck, jobId, output)
  }

  async queuedCount(): Promise<number> {
    return (await this.boss.findJobs(QUEUES.priceCheck, { queued: true })).length
  }
}

/**
 * Spreads source checks over the jitter window: each source gets a random time, and consecutive
 * times are at least `minGapSeconds` apart (not everything in the same minute).
 */
export function spreadStarts(count: number, base: Date, jitterMinutes: number, minGapSeconds = 45, random = Math.random): Date[] {
  const windowMs = Math.max(0, jitterMinutes) * 60_000
  const offsets = Array.from({ length: count }, () => Math.floor(random() * windowMs)).sort((a, b) => a - b)
  for (let i = 1; i < offsets.length; i++) {
    offsets[i] = Math.max(offsets[i], offsets[i - 1] + minGapSeconds * 1000)
  }
  // Random order of sources — the assigned times do not depend on the order in the list.
  const shuffled = offsets.map((o) => ({ o, r: random() })).sort((a, b) => a.r - b.r).map((x) => x.o)
  return shuffled.map((offset) => new Date(base.getTime() + offset))
}
