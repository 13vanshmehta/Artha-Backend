import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheService } from './common/cache/cache.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let mockPrismaService: { verifyConnectivity: jest.Mock };
  let mockCacheService: { isRedisConnected: jest.Mock };

  beforeEach(async () => {
    mockPrismaService = {
      verifyConnectivity: jest.fn().mockResolvedValue(true),
    };
    mockCacheService = {
      isRedisConnected: jest.fn().mockReturnValue(false),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root & observability', () => {
    it('should return the Artha application discovery message', () => {
      expect(appController.getHello()).toContain('Artha Backend API');
    });

    it('should return general health status and uptime', () => {
      const health = appController.getHealth();
      expect(health.status).toBe('ok');
      expect(typeof health.uptimeSeconds).toBe('number');
      expect(typeof health.timestamp).toBe('string');
    });

    it('should return process liveness probe', () => {
      const liveness = appController.getLiveness();
      expect(liveness.status).toBe('alive');
      expect(liveness.memoryUsage).toBeDefined();
    });

    it('should return readiness probe verifying database connectivity', async () => {
      const readiness = await appController.getReadiness();
      expect(readiness.status).toBe('ready');
      expect(readiness.database).toBe('connected');
    });
  });
});
