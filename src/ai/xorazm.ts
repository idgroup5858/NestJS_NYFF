/**
 * Xorazm shevasi (2026-10-29): AI direktor bilan **doim** shu shevada gaplashadi (web chat va Telegram), savol esa adabiy
 * tilda ham, shevada ham bo'lishi mumkin. Kod hech narsani almashtirmaydi — lug'at va qonuniyatlar modelga ko'rsatma
 * bo'lib boradi, u o'zi qo'llaydi (qo'shimchali shakllarni ham). Lug'at — direktor bergan ro'yxat (takrorlar
 * birlashtirilgan); qonuniyatlar — shu ro'yxatdan chiqarilgan. Yangi so'z — shu ro'yxatga.
 */

/** "Sen kimsan?" va shunga o'xshash har qanday savolga javob — tayyor, shevada; o'girish qadami unga tegmaydi. */
export const IDENTITY_ANSWER = 'Man ID GROUP tomonidan ishlab chiqilgan AI man.';

/**
 * Salom (2026-10-29): har chatda kunning birinchi xabariga javobdan oldin va yangi suhbat boshlanganda — alohida xabar,
 * AI yozmaydi (har safar aynan shu matn). Matn o'zgartirilsa, o'sha kuni bir marta qayta salom berishi mumkin (salom
 * tarixdan matni bo'yicha topiladi).
 */
export const GREETING = "Assalomu aleykum og'a! Yaxshimisiz, sog'liqlariz yaxshimi? Nagapla?";

/** adabiy → xorazmcha */
export const XORAZM_GLOSSARY: [literary: string, khorezm: string][] = [
  ['nima', 'novi'],
  ['nimalar', 'novilo'],
  ['nima gap', 'nagap (bir nechta odamga — nagapla)'],
  ['aka', "og'a"],
  ['men', 'man'],
  ['senga', 'songo'],
  ['sizga', 'siza'],
  ['uning', 'vuning'],
  ['ular', 'vulo'],
  ['qanday', 'nichik'],
  ['qanday yordam kerak', 'nichik yordam garak adi'],
  ['kerak', 'garak'],
  ['nega', 'nachun'],
  ['shunday', 'shunin'],
  ['quyidagicha', 'shunin'],
  ['necha', 'nichcha'],
  ['nechta', 'nichcha'],
  ['esa', 'asa'],
  ['edi', 'adi'],
  ['bor edi', 'bor adi'],
  ['yana', 'yenam'],
  ['faqat', 'tolko'],
  ['yoki', 'yo'],
  ['juda', 'dim jolli'],
  ['mana', 'ino'],
  ['bugungi', 'bugunki'],
  ['mavzusida', 'mavzusinda'],
  ["bo'yicha", "bo'yincha"],
  ['ombordagi', 'ombordaki'],
  ['skladdagi', 'skladdaki'],
  ["ma'lumotlar", 'malumotlo'],
  ["ma'lumotlari", 'malumotlori'],
  ['mahsulotlar', 'mahsulotlo'],
  ['miqdori', 'mikdori'],
  ['qolgan', "qolg'on"],
  ['sotilgan', "sotilg'on"],
  ['qilgan', 'atgan'],
  ['etgan', 'atgan'],
  ['qiladi', 'atadi'],
  ['etadi', 'atadi'],
  ['ber', 'bar'],
  ['beraman', 'baraman'],
  ['beravering', 'baravaring'],
  ['berish', 'barish'],
  ['berishingizni', 'barishingizni'],
  ["so'rayman", "so'rimon"],
  ["so'rayvering", "so'rivaring"],
];

/** Ro'yxatdan chiqarilgan qonuniyatlar — lug'atda yo'q so'zlarga ham qo'llanadi. */
export const XORAZM_PATTERNS: string[] = [
  'plural -lar at the end of a word → -lo (mahsulotlar → mahsulotlo, filiallar → filiallo, ular → vulo); -lar followed by another suffix → -lor- (ma\'lumotlari → malumotlori, mahsulotlarni → mahsulotlorni)',
  '-dagi → -daki (ombordagi → ombordaki); -gi → -ki (bugungi → bugunki, kechagi → kechaki)',
  "-gan → -g'on (qolgan → qolg'on, sotilgan → sotilg'on), except qilgan / etgan → atgan",
  '-sida → -sinda (mavzusida → mavzusinda)',
  'the verbs qil- and et- → at- (qiladi → atadi, qilgan → atgan)',
  'e → a in edi, esa and the verb ber- (edi → adi, esa → asa, beraman → baraman, berish → barish)',
  'u- at the start of the pronouns u / ular / uning → vu- (uning → vuning, ular → vulo)',
];

/**
 * Qonuniyatlarni hisobotlarda ko'p uchraydigan so'zlarga qo'llash namunalari — model qoidadan ko'ra misolga yaxshiroq
 * ergashadi (faqat qoida berilganda "buyurtmalar", "to'langan" o'girilmay qolgan). Hammasi yuqoridagi qoidalardan.
 */
export const XORAZM_PATTERN_EXAMPLES: [literary: string, khorezm: string][] = [
  ['buyurtmalar', 'buyurtmalo'],
  ['buyurtmalarni', 'buyurtmalorni'],
  ['smenalar', 'smenalo'],
  ['filiallar', 'filiallo'],
  ['xarajatlar', 'xarajatlo'],
  ['rasxodlar', 'rasxodlo'],
  ['tushumlar', 'tushumlo'],
  ['kassirlar', 'kassirlo'],
  ["to'langan", "to'lang'on"],
  ['ochilgan', "ochilg'on"],
  ['yopilgan', "yopilg'on"],
  ['yopilmagan', "yopilmag'on"],
  ['boshlangan', "boshlang'on"],
  ['kelgan', "kelg'on"],
  ['kechagi', 'kechaki'],
  ['menyudagi', 'menyudaki'],
  ['filialdagi', 'filialdaki'],
];

const glossaryLines = () => XORAZM_GLOSSARY.map(([literary, khorezm]) => `• ${literary} → ${khorezm}`);
const patternLines = () => XORAZM_PATTERNS.map((pattern) => `• ${pattern}`);

/**
 * Asosiy ko'rsatma uchun: savol shevada bo'lishi mumkin — model uni tushunsin, javobni esa adabiy yozsin. Lug'at
 * teskari (sheva → adabiy) va "faqat tushunish uchun" deb beriladi: oddiy ko'rinishda model savoldagi shevaga qo'shilib,
 * "adabiy" javobni ham shevada yozib yuborgan (ovozli javob adabiy bo'lishi kerak — u shu matnni o'qiydi).
 */
export function understandRules(): string[] {
  return [
    'Questions may come in literary Uzbek, in the Khorezm dialect of Uzbek, or in Russian / English — understand all of them.',
    'Use this table ONLY to understand Khorezm words in questions (Khorezm → literary). Never use the Khorezm forms in your answer.',
    ...XORAZM_GLOSSARY.map(([literary, khorezm]) => `• ${khorezm} → ${literary}`),
  ];
}

/**
 * Ikkinchi so'rov: tayyor (adabiy) javobni shevaga o'girish. Alohida — tool'lar va hisob-kitobsiz model faqat shu
 * ishga e'tibor beradi: birga berilganda u lug'atda yo'q "sheva" so'zlarini to'qib, ma'noni buzib qo'ygan.
 */
export function rewritePrompt(): string {
  return [
    'You rewrite Uzbek text into the Khorezm dialect of Uzbek (Xorazm shevasi), Latin script. The text is an answer to a restaurant director.',
    'Return ONLY the rewritten text — no comments, no quotes, nothing added.',
    'Keep everything else exactly: the same lines and line breaks, bullets "•", indentation, numbers, money, units, dates, punctuation, and names of branches, warehouses, products, categories and people.',
    'Change ONLY:',
    '1) words from the glossary — also when they carry suffixes (mahsulotlarni → mahsulotlorni);',
    '2) word endings covered by the patterns.',
    "Every other word stays exactly as it is (for example bo'ldi, minimum, kassir, vaqti, hali, kun, oy, ishlayapti, tushum stay unchanged). Do not invent other dialect words or spellings, do not rephrase, do not add or remove information.",
    'Glossary (literary → Khorezm):',
    ...glossaryLines(),
    'Patterns:',
    ...patternLines(),
    'The patterns apply to every ordinary word, for example:',
    ...XORAZM_PATTERN_EXAMPLES.map(([literary, khorezm]) => `• ${literary} → ${khorezm}`),
  ].join('\n');
}

/**
 * Direktor savollarida ko'p uchraydigan so'zlar — ovozni matnga o'girishda noaniq tovush shularga moslanadi (kontekstsiz
 * Gemini "bugungi tushum" ni "bugungi Lunchum" deb eshitgan). Filial va taom nomlari bazadan qo'shiladi.
 */
export const BUSINESS_TERMS = [
  'tushum',
  'pul',
  "so'm",
  'summa',
  'rasxod',
  'xarajat',
  'chiqim',
  'foyda',
  'kassa',
  'naqd',
  'karta',
  'Click',
  'smena',
  'kassir',
  'ombor',
  'sklad',
  'qoldiq',
  'kam qoldi',
  'kirim',
  "ta'minotchi",
  'dostavka',
  'kuryer',
  'buyurtma',
  'zakaz',
  'bekor qilingan',
  'filial',
  'menyu',
  'taom',
  'hisobot',
  'bugun',
  'kecha',
  'hafta',
  'oy',
];

/**
 * Ovozli xabarni matnga o'girish (Telegram): gapiruvchi ko'pincha shevada — natija adabiy tilda (AI savolni shunday
 * yaxshiroq tushunadi; direktorga ko'rsatilmaydi). [names] — filial va taom nomlari (bazadan).
 */
export function transcribePrompt(names: string[] = []): string {
  return [
    'You transcribe a short voice message that a restaurant director sends to a business assistant bot.',
    'The speaker usually speaks Uzbek, often in the Khorezm dialect, sometimes Russian. The message is almost always a question about the business: revenue, expenses, shifts, stock, warehouses, delivery, orders, branches or the menu.',
    'Return ONLY the message as plain text — no quotes, no comments: Uzbek in literary Uzbek Latin script (turn Khorezm words into literary ones, see the glossary), Russian in Cyrillic. Keep numbers and names.',
    'When a word is unclear, choose the most likely word from the vocabulary below (for example a word that sounds like "tushum" is "tushum" — revenue). Do not invent product or brand names that are not in the vocabulary.',
    'If there is no understandable speech, return an empty string.',
    `Vocabulary: ${[...BUSINESS_TERMS, ...names].join(', ')}.`,
    'Glossary (literary → Khorezm; read right to left):',
    ...glossaryLines(),
  ].join('\n');
}
