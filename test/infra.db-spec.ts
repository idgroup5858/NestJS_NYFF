import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAll } from './test-app';

describe('test infratuzilmasi', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await truncateAll(app);
  });

  afterAll(() => app.close());

  it('ilova nyff_test bazasida ishlaydi, himoyalangan endpoint tokensiz yopiq', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200, { ok: true });
    const res = await request(app.getHttpServer()).get('/api/orders/active').expect(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it("DTO xatosi — invalid_input, noma'lum maydonsiz", async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ userId: 5 }).expect(400);
    expect(res.body.code).toBe('invalid_input');
  });
});
