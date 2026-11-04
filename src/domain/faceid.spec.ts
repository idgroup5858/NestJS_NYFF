import { faceIdAllows, isValidEmployeeNo, parseEmployeeNo, type LastFaceIdEvent } from './faceid';

describe('FaceID qoidasi', () => {
  const now = new Date('2026-11-04T09:00:00+05:00');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const event = (status: LastFaceIdEvent['status'], minutes: number, branchId = 'br_a'): LastFaceIdEvent => ({
    branchId,
    status,
    occurredAt: minutesAgo(minutes),
  });

  it("hodisa yo'q — hech narsa mumkin emas", () => {
    for (const need of ['open', 'resume', 'close'] as const) expect(faceIdAllows(need, null, 'br_a', now)).toBe(false);
  });

  it('smena ochish — shu filialda «Kirish», 10 daqiqa ichida', () => {
    expect(faceIdAllows('open', event('checkIn', 0), 'br_a', now)).toBe(true);
    expect(faceIdAllows('open', event('checkIn', 10), 'br_a', now)).toBe(true);
    expect(faceIdAllows('open', event('checkIn', 11), 'br_a', now)).toBe(false);
    expect(faceIdAllows('open', event('checkOut', 1), 'br_a', now)).toBe(false);
    expect(faceIdAllows('open', event('checkIn', 1, 'br_b'), 'br_a', now)).toBe(false);
  });

  it('smenani topshirish — shu filialda «Chiqish», 10 daqiqa ichida', () => {
    expect(faceIdAllows('close', event('checkOut', 3), 'br_a', now)).toBe(true);
    expect(faceIdAllows('close', event('checkOut', 11), 'br_a', now)).toBe(false);
    expect(faceIdAllows('close', event('checkIn', 1), 'br_a', now)).toBe(false);
    expect(faceIdAllows('close', event('checkOut', 1, 'br_b'), 'br_a', now)).toBe(false);
  });

  it("davom ettirish — «Kirish» dan keyin 16 soat, «Chiqish» dan keyin 10 daqiqa; boshqa filial — yo'q", () => {
    expect(faceIdAllows('resume', event('checkIn', 60 * 8), 'br_a', now)).toBe(true);
    expect(faceIdAllows('resume', event('checkIn', 60 * 16), 'br_a', now)).toBe(true);
    expect(faceIdAllows('resume', event('checkIn', 60 * 16 + 1), 'br_a', now)).toBe(false);
    expect(faceIdAllows('resume', event('checkOut', 5), 'br_a', now)).toBe(true);
    expect(faceIdAllows('resume', event('checkOut', 11), 'br_a', now)).toBe(false);
    // 1-filialda smena ochiq qoldi, 2-filialda «Kirish» bosdi — 1-filial kassasiga kira olmaydi
    expect(faceIdAllows('resume', event('checkIn', 1, 'br_b'), 'br_a', now)).toBe(false);
  });

  it('kelajakdagi vaqt (soat noto\'g\'ri) — hisobga olinmaydi', () => {
    expect(faceIdAllows('open', { branchId: 'br_a', status: 'checkIn', occurredAt: minutesAgo(-5) }, 'br_a', now)).toBe(false);
  });

  it('tabel raqami', () => {
    expect(parseEmployeeNo('17')).toBe(17);
    expect(parseEmployeeNo(' 0017 ')).toBe(17);
    expect(parseEmployeeNo(17)).toBe(17);
    expect(parseEmployeeNo('0')).toBeNull();
    expect(parseEmployeeNo('A17')).toBeNull();
    expect(parseEmployeeNo('1234567890')).toBeNull();
    expect(parseEmployeeNo('')).toBeNull();
    expect(parseEmployeeNo(null)).toBeNull();
    expect(isValidEmployeeNo(1)).toBe(true);
    expect(isValidEmployeeNo(999_999_999)).toBe(true);
    expect(isValidEmployeeNo(0)).toBe(false);
    expect(isValidEmployeeNo(1.5)).toBe(false);
    expect(isValidEmployeeNo('17')).toBe(false);
  });
});
