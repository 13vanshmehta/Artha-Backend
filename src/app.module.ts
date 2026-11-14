import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './common/cache/cache.module';
import { IpAwareThrottlerGuard } from './common/guards/ip-throttler.guard';
import { validateEnvironment } from './config/env.validation';
import { EmailModule } from './email/email.module';
import { FinanceModule } from './finance/finance.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? ['.env.production', '.env']
          : process.env.NODE_ENV === 'test'
            ? ['.env.local', '.env.test', '.env']
            : ['.env.local', '.env.development', '.env'],
      // Outside production the dotenv files are the single source of truth. Without
      // this, a stale `export DATABASE_URL=...` left in the developer's shell silently
      // shadows .env.local and the app boots pointed at the wrong database. In
      // production the opposite is correct: platform-injected variables must win.
      override: process.env.NODE_ENV !== 'production',
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    CacheModule,
    QueueModule,
    EmailModule,
    AuthModule,
    FinanceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: IpAwareThrottlerGuard,
    },
  ],
})
export class AppModule {}
