/**
 * Telegram "Menu" tugmasidagi buyruqlar (`setMyCommands`): ko'p so'raladigan savollar — buyruq tayyor savolni AI'ga
 * yuboradi (salom, kutish xabari, javob — oddiy savoldagidek). Savol adabiy tilda — AI shevada javob beradi. Nomi —
 * lotin kichik harf, raqam, `_` (Telegram talabi). Ro'yxat o'zgarsa — bot qayta ulanganda / server ishga tushganda
 * Telegram'ga yangidan yuboriladi.
 */
export interface BotCommand {
  command: string;
  /** menyuda ko'rinadigan matn */
  description: string;
  /** AI'ga boradigan savol; `null` — maxsus buyruq (javobni bot o'zi beradi) */
  question: string | null;
}

export const BOT_COMMANDS: BotCommand[] = [
  { command: 'tushum', description: 'Bugungi tushum', question: "Bugungi tushum qancha? Filiallar va to'lov turlari bo'yicha." },
  { command: 'kecha', description: 'Kechagi tushum', question: "Kechagi tushum qancha? Filiallar bo'yicha." },
  { command: 'hafta', description: 'Shu haftadagi tushum', question: 'Shu haftadagi tushum va rasxodlar qancha?' },
  {
    command: 'oy',
    description: 'Shu oy: tushum, rasxod, foyda',
    question: "Bu oy tushum, rasxodlar va sof foyda qancha? O'tgan oy bilan solishtir.",
  },
  { command: 'qoldiq', description: 'Kam qolgan mahsulotlar', question: 'Qaysi mahsulotlar kam qoldi?' },
  { command: 'filiallar', description: 'Hozir ishlayotgan filiallar', question: 'Hozir qaysi filiallar ishlayapti?' },
  { command: 'smenalar', description: 'Bugungi smenalar', question: "Bugungi smenalar bo'yicha kim qancha topdi?" },
  { command: 'dostavka', description: 'Shu haftalik dostavka', question: 'Shu haftada dostavkadan qancha tushdi?' },
  { command: 'menyu', description: 'Menyu va narxlar', question: 'Menyuda qanday taomlar bor, narxi bilan?' },
  { command: 'new', description: 'Yangi suhbat', question: null },
];

/** `/tushum`, `/tushum@bot_nomi` → buyruq; buyruq emas — `null`. */
export function parseCommand(text: string): string | null {
  const match = /^\/([a-z0-9_]+)(?:@\w+)?$/i.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}

/** Noma'lum buyruqqa — mavjudlari ro'yxati. */
export const COMMANDS_HELP = [
  'Tez savollar:',
  ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
  '',
  'Yoki savolingizni oddiy yozing.',
].join('\n');
