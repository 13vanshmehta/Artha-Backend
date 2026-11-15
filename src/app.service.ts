import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CacheService } from './common/cache/cache.service';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  getHello(): string {
    return 'Artha Backend API — Know. Spend. Grow.';
  }

  getHealth(): { status: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  getLiveness(): {
    status: string;
    uptimeSeconds: number;
    memoryUsage: NodeJS.MemoryUsage;
    timestamp: string;
  } {
    return {
      status: 'alive',
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<{
    status: string;
    database: string;
    cache: string;
    timestamp: string;
  }> {
    let dbStatus = 'connected';
    try {
      const isDbOk = await this.prisma.verifyConnectivity();
      if (!isDbOk) {
        dbStatus = 'unhealthy';
      }
    } catch {
      dbStatus = 'disconnected';
    }

    if (dbStatus !== 'connected') {
      throw new ServiceUnavailableException({
        status: 'unready',
        database: dbStatus,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ready',
      database: dbStatus,
      cache: this.cache.isRedisConnected() ? 'redis' : 'in-memory-fallback',
      timestamp: new Date().toISOString(),
    };
  }
}
