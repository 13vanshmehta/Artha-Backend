import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvConfig } from '../../config/env.validation';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly memoryStore = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRedisActive = false;

  constructor(
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
  ) {}

  onModuleInit(): void {
    // Start periodic background eviction for memory fallback store
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memoryStore.entries()) {
        if (entry.expiresAt !== null && entry.expiresAt <= now) {
          this.memoryStore.delete(key);
        }
      }
    }, 60_000);

    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    this.logger.log(
      `CacheService initialized (Tier: ${this.isRedisActive ? 'Distributed Redis' : 'Resilient In-Memory Fallback'}, Env: ${nodeEnv})`,
    );
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.memoryStore.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.memoryStore.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.memoryStore.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.memoryStore.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.memoryStore.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  /** Drops every entry (used to isolate tests). */
  async clear(): Promise<void> {
    this.memoryStore.clear();
  }

  isRedisConnected(): boolean {
    return this.isRedisActive;
  }
}
