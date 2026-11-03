import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';

/**
 * Proksi (Apache) ortida: IP chegarasi har bir mijozning o'z IP si bo'yicha (`X-Forwarded-For`, `TRUST_PROXY` standart
 * `loopback`) — aks holda hamma so'rov 127.0.0.1 dan kelgandek ko'rinib, chegara hamma foydalanuvchiga birga qo'llanardi.
 * `POST /auth/login` — bir IP dan 60 s da 20 ta.
 */
describe('proksi ortida IP chegarasi', () => {
  let app: INestApplication;
  const login = (forwardedFor?: string) => {
    const req = request(app.getHttpServer()).post('/api/auth/login');
    return (forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req).send({ userId: 'usr_yoq', pin: '1234' });
  };

  beforeAll(async () => {
    app = await createTestApp();
    process.env.THROTTLE = 'on';
  });

  afterAll(async () => {
    process.env.THROTTLE = 'off';
    await app.close();
  });

  it("bir mijoz chegaraga yetsa — faqat u to'xtaydi; boshqa mijozlar (proksi orqali ham) ishlayveradi", async () => {
    for (let i = 0; i < 20; i++) expect((await login('203.0.113.1')).status).not.toBe(429);
    const blocked = await login('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('too_many_attempts');

    // boshqa mijoz (o'sha proksi orqali) — chegarasi alohida
    expect((await login('203.0.113.2')).status).toBe(404);
    // sarlavhasiz (proksisiz) so'rov — o'z IP si bo'yicha
    expect((await login()).status).toBe(404);
  });
});
