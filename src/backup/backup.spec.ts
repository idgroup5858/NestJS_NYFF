import { backupCaption, dueMonth, monthLabel, partNames } from './backup.service';

/** Oylik zaxira nusxa: qaysi oy, fayl nomlari, izoh (bazasiz). Vaqt — mahalliy. */

describe('zaxira nusxa', () => {
  it("nusxasi kerak oy: oyning oxirgi kuni 23:00 dan — shu oy, undan oldin — o'tgan oy", () => {
    expect(dueMonth(new Date(2026, 10, 30, 22, 59))).toBe('2026-10');
    expect(dueMonth(new Date(2026, 10, 30, 23, 0))).toBe('2026-11');
    expect(dueMonth(new Date(2026, 11, 1, 0, 30))).toBe('2026-11');
    expect(dueMonth(new Date(2026, 11, 31, 23, 10))).toBe('2026-12');
    expect(dueMonth(new Date(2027, 0, 15, 12, 0))).toBe('2026-12');
    // fevral: oddiy yil — 28, kabisa — 29
    expect(dueMonth(new Date(2027, 1, 28, 23, 5))).toBe('2027-02');
    expect(dueMonth(new Date(2028, 1, 28, 23, 5))).toBe('2028-01');
    expect(dueMonth(new Date(2028, 1, 29, 23, 5))).toBe('2028-02');
  });

  it("fayl nomlari: bitta — .dump, bo'laklar — .dump.001, .002, …", () => {
    expect(partNames('2026-11', 1)).toEqual(['nyff-2026-11.dump']);
    expect(partNames('2026-11', 3)).toEqual([
      'nyff-2026-11.dump.001',
      'nyff-2026-11.dump.002',
      'nyff-2026-11.dump.003',
    ]);
  });

  it("izoh: oy nomi, olingan vaqt, hajm; bo'lakda — qism va hammasi kerakligi", () => {
    expect(monthLabel('2026-01')).toBe('Yanvar 2026');
    expect(monthLabel('2026-12')).toBe('Dekabr 2026');
    const at = new Date(2026, 10, 30, 23, 4);
    expect(backupCaption('2026-11', at, 35_861_299, 1, 1)).toBe(
      'Zaxira nusxa — Noyabr 2026\nOlingan: 30.11.2026 23:04 · 34,2 MB',
    );
    expect(backupCaption('2026-11', at, 120 * 1024 * 1024, 2, 3)).toBe(
      'Zaxira nusxa — Noyabr 2026, 2/3-qism\nOlingan: 30.11.2026 23:04 · 120,0 MB\nTiklash uchun 3 ta qismning hammasi kerak',
    );
  });
});
