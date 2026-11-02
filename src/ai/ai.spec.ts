import { ApiError } from '@google/genai';
import { BOT_COMMANDS, COMMANDS_HELP, parseCommand } from '../telegram/commands';
import { splitMessage } from '../telegram/telegram.api';
import { systemPrompt, type PromptContext } from './ai.prompt';
import { GeminiClient } from './gemini.client';
import { plainText } from './plain-text';
import { waitingText, WAITING, WAITING_GENERIC } from './waiting';
import { rewritePrompt, XORAZM_GLOSSARY } from './xorazm';

/** AI yordamchining toza funksiyalari (bazasiz). */

describe('javob matni', () => {
  it("Markdown belgilari olib tashlanadi, ro'yxat — «•»", () => {
    expect(plainText("## Hisobot\n**Tushum:** 1 200 000 so'm\n- Chilonzor\n* Yunusobod\n`net` — sof\n")).toBe(
      "Hisobot\nTushum: 1 200 000 so'm\n• Chilonzor\n• Yunusobod\nnet — sof",
    );
    // manfiy son va chiziqcha matn ichida o'zgarmaydi
    expect(plainText('Farq: -5% (o‘tgan hafta — 10)')).toBe('Farq: -5% (o‘tgan hafta — 10)');
  });

  it('Telegram uchun bo\'lish: qatorlar chegarasida, juda uzun qator — kesiladi', () => {
    expect(splitMessage('salom')).toEqual(['salom']);
    expect(splitMessage('')).toEqual(['']);
    expect(splitMessage('aaa\nbbb\nccc', 7)).toEqual(['aaa\nbbb', 'ccc']);
    expect(splitMessage('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    const long = Array.from({ length: 300 }, (_, i) => `• ${i} qator`).join('\n');
    const chunks = splitMessage(long);
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
    expect(chunks.join('\n')).toBe(long);
  });
});

describe('system prompt', () => {
  const ctx = (now: Date): PromptContext => ({
    now,
    userName: 'Admin',
    channel: 'web',
    branches: [
      { id: 'br_chilonzor', name: 'Chilonzor', active: true },
      { id: 'br_old', name: 'Eski', active: false },
    ],
    warehouses: [{ id: 'wh_central', name: 'Markaziy ombor' }],
  });

  it('tayyor oraliqlar: hafta dushanbadan, o\'tgan oy, yil boshi', () => {
    const wednesday = systemPrompt(ctx(new Date(2026, 9, 28, 14, 5)));
    expect(wednesday).toContain('Now: 2026-10-28 (Wednesday), 14:05');
    expect(wednesday).toContain('"today" = 2026-10-28');
    expect(wednesday).toContain('"yesterday" = 2026-10-27');
    expect(wednesday).toContain('"this week" = 2026-10-26..2026-10-28');
    expect(wednesday).toContain('"last week" = 2026-10-19..2026-10-25');
    expect(wednesday).toContain('"this month" = 2026-10-01..2026-10-28');
    expect(wednesday).toContain('"last month" = 2026-09-01..2026-09-30');
    expect(wednesday).toContain('"this year" = 2026-01-01..2026-10-28');
    expect(wednesday).toContain('• br_old — Eski (inactive)');
    // "sen kimsan?" — ID GROUP, model / kompaniya nomi aytilmaydi
    expect(wednesday).toContain('answer exactly: "Man ID GROUP tomonidan ishlab chiqilgan AI man."');
    // o'girish ko'rsatmasida eslatilmaydi — aks holda model uni so'ralmagan javobga qo'shib yuboradi
    expect(rewritePrompt()).not.toContain('ID GROUP');
    // javob adabiy yoziladi, shevaga 2-so'rov o'giradi; savol shevada bo'lsa — lug'at bilan tushunadi
    expect(wednesday).toContain('converted to the Khorezm dialect afterwards');
    const rewrite = rewritePrompt();
    expect(rewrite).toContain('Return ONLY the rewritten text');
    // asosiy ko'rsatmada — teskari (sheva → adabiy, faqat tushunish uchun), o'girishda — adabiy → sheva
    expect(wednesday).toContain('Never use Khorezm dialect forms');
    for (const [literary, khorezm] of XORAZM_GLOSSARY) {
      expect(wednesday).toContain(`• ${khorezm} → ${literary}`);
      expect(rewrite).toContain(`• ${literary} → ${khorezm}`);
    }
    expect(rewrite).toContain("-gan → -g'on");
    expect(wednesday).not.toContain('Telegram');

    // yakshanba — hafta hali dushanbadan; yanvar — o'tgan oy o'tgan yilda
    expect(systemPrompt(ctx(new Date(2026, 10, 1, 9, 0)))).toContain('"this week" = 2026-10-26..2026-11-01');
    expect(systemPrompt(ctx(new Date(2027, 0, 10)))).toContain('"last month" = 2026-12-01..2026-12-31');
    expect(systemPrompt({ ...ctx(new Date(2026, 9, 28)), channel: 'telegram' })).toContain('Telegram chat');
  });
});

describe('Gemini mijozi', () => {
  // kalit konstruktorda o'qiladi; so'rov tarmoqqa ketmaydi — SDK metodi almashtiriladi
  const client = () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const gemini = new GeminiClient();
    const generate = jest.fn();
    (gemini as unknown as { ai: { models: { generateContent: jest.Mock } } }).ai.models.generateContent = generate;
    return { gemini, generate };
  };

  it("vaqtinchalik xato (503) — bir marta qayta urinadi; doimiy xato (400) — yo'q", async () => {
    const busy = client();
    busy.generate
      .mockRejectedValueOnce(new ApiError({ message: 'high demand', status: 503 }))
      .mockResolvedValueOnce({ text: 'salom', candidates: [] });
    expect(await busy.gemini.rewrite('system', 'matn')).toBe('salom');
    expect(busy.generate).toHaveBeenCalledTimes(2);

    const bad = client();
    bad.generate.mockRejectedValue(new ApiError({ message: 'bad request', status: 400 }));
    await expect(bad.gemini.rewrite('system', 'matn')).rejects.toThrow('bad request');
    expect(bad.generate).toHaveBeenCalledTimes(1);
  });
});

describe('kutish matni', () => {
  it('savol turiga qarab: qoldiq, ombor, pul (adabiy, sheva, ruscha); bir nechtasi bo\'lsa — qoldiq ustun', () => {
    expect(waitingText('Qaysi mahsulotlar kam qoldi?')).toBe(WAITING.stock);
    expect(waitingText("novi mahsulotlo kam qolg'on?")).toBe(WAITING.stock);
    expect(waitingText('Каких продуктов осталось мало?')).toBe(WAITING.stock);
    expect(waitingText('Omborda nima qoldi?')).toBe(WAITING.stock);
    expect(waitingText('Ombordaki holatni ayt')).toBe(WAITING.warehouse);
    expect(waitingText('sklatda nima bor')).toBe(WAITING.warehouse);
    expect(waitingText('Bugungi tushum qancha?')).toBe(WAITING.money);
    expect(waitingText('Kecha qancha pul tushdi?')).toBe(WAITING.money);
    expect(waitingText('Bu oy rasxodlar qancha?')).toBe(WAITING.money);
    expect(waitingText('Kartaga qancha to‘landi?')).toBe(WAITING.money);
    expect(waitingText("Kechagi smenalar bo'yicha kim qancha topdi?")).toBe(WAITING.money);
    expect(waitingText('Какая выручка сегодня?')).toBe(WAITING.money);
  });

  it('boshqa savollarga — umumiy iboralardan tasodifiy biri', () => {
    expect(waitingText('Hozir qaysi filiallar ishlayapti?', () => 0)).toBe(WAITING_GENERIC[0]);
    expect(waitingText('menyuda novilo bor?', () => 0.5)).toBe(WAITING_GENERIC[1]);
    expect(waitingText('Sen kimsan?', () => 0.99)).toBe(WAITING_GENERIC.at(-1));
    // "kartoshka" — karta emas, "kassir" — kassa emas
    expect(WAITING_GENERIC).toContain(waitingText('Kartoshka fri bormi?'));
    expect(WAITING_GENERIC).toContain(waitingText('Kassirlar kimlar?'));
  });
});

describe('Telegram buyruqlari', () => {
  it("nomlari Telegram talabiga mos (lotin kichik harf, raqam, _; 32 gacha), takrorlanmaydi; har biriga savol yoki /new", () => {
    const names = BOT_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
    for (const c of BOT_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThanOrEqual(3);
      expect(c.description.length).toBeLessThanOrEqual(256);
      if (c.command !== 'new') expect(c.question).toBeTruthy();
    }
    expect(COMMANDS_HELP).toContain('/tushum — Bugungi tushum');
  });

  it('buyruqni ajratish: /tushum, /tushum@bot, katta harf; oddiy matn — buyruq emas', () => {
    expect(parseCommand('/tushum')).toBe('tushum');
    expect(parseCommand(' /Qoldiq@nyff_bot ')).toBe('qoldiq');
    expect(parseCommand('/tushum bugun')).toBeNull();
    expect(parseCommand('Bugungi tushum?')).toBeNull();
  });
});
