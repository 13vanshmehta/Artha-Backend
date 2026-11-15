import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureArthaApp } from '../src/app.setup';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Use the production bootstrap so prefixes, envelopes and filters match reality.
    app = moduleFixture.createNestApplication();
    configureArthaApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET) returns the service banner unwrapped', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Artha Backend API — Know. Spend. Grow.');
  });

  it('/health/ready (GET) reports a connected database', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.database).toBe('connected');
  });

  it('keeps error codes top-level on rejected API requests', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('MISSING_ACCESS_TOKEN');
  });
});
