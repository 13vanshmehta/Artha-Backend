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
      // Tests are the same: the runner sets NODE_ENV=test, EMAIL_PROVIDER and the
      // test database before boot, and .env.local (NODE_ENV=development, real SMTP,
      // the dev DATABASE_URL) must never override those — doing so once pointed the
      // destructive e2e suite at the developer's own database.
      override:
        process.env.NODE_ENV !== 'production' &&
        process.env.NODE_ENV !== 'test',
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
