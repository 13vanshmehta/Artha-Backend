import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

export interface BackgroundJob<T = unknown> {
  id: string;
  name: string;
  payload: T;
  retriesRemaining: number;
  backoffMs: number;
  scheduledAt: number;
}

export type JobHandler<T = any> = (payload: T) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queue: BackgroundJob[] = [];
  private workerTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  onModuleInit(): void {
    // Process queue every 250ms
    this.workerTimer = setInterval(() => {
      void this.processQueue();
    }, 250);
  }

  onModuleDestroy(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
    this.queue.length = 0;
  }

  registerHandler<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler);
  }

  async dispatch<T>(
    jobName: string,
    payload: T,
    options?: { delayMs?: number; retries?: number },
  ): Promise<void> {
    const delayMs = options?.delayMs ?? 0;
    const retries = options?.retries ?? 3;

    const job: BackgroundJob<T> = {
      id: `${jobName}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: jobName,
      payload,
      retriesRemaining: retries,
      backoffMs: 1000,
      scheduledAt: Date.now() + delayMs,
    };

    this.queue.push(job);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      const readyIndices: number[] = [];

      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].scheduledAt <= now) {
          readyIndices.push(i);
        }
      }

      for (const index of readyIndices.reverse()) {
        const job = this.queue.splice(index, 1)[0];
        if (!job) continue;

        const handler = this.handlers.get(job.name);
        if (!handler) {
          this.logger.warn(`No handler registered for queue job: ${job.name}`);
          continue;
        }

        try {
          await handler(job.payload);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (job.retriesRemaining > 0) {
            job.retriesRemaining -= 1;
            job.scheduledAt = Date.now() + job.backoffMs;
            job.backoffMs *= 2; // Exponential backoff
            this.queue.push(job);
            this.logger.warn(
              `Job ${job.name} (${job.id}) failed: ${msg}. Retrying in ${job.backoffMs / 1000}s (${job.retriesRemaining} retries left)`,
            );
          } else {
            this.logger.error(
              `Job ${job.name} (${job.id}) failed permanently after retries: ${msg}`,
            );
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getPendingCount(): number {
    return this.queue.length;
  }
}
