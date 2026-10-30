/**
 * Kutish matni (2026-10-29): AI javob yozguncha (bir necha soniya) ko'rsatiladigan xorazmcha ibora — savol turiga qarab.
 * Web'da kutish pufakchasida (javob kelganda yo'qoladi), Telegram'da alohida xabar (chatda qoladi), keyin asl javob.
 * Savol turi kalit so'zlar bilan aniqlanadi — matn javobdan oldin, darhol kerak (AI'ga qo'shimcha so'rov yo'q).
 * Iboralar — direktor bergan; yangi ibora — shu ro'yxatlarga (o'zim to'qimayman).
 */

export const WAITING = {
  stock: "Hozir og'a, sklata borib sonabarin, vajlani kutib during…",
  warehouse: "Hozir og'a, omborni qorabarin…",
  money: "Hozir yisoplabarin og'a, ozg'ona sabr ating…",
} as const;

/** Boshqa savollar (filiallar, menyu, smena, buyurtmalar) — tasodifiy biri. */
export const WAITING_GENERIC = ["Hozir og'a…", "Bo'ldi hozir ino…", "Hozir og'a, qorabarin…"];

/**
 * Savol turi → ibora; yuqoridagisi ustun ("omborda nima qoldi?" — qoldiq). Adabiy, xorazmcha, ruscha va inglizcha
 * shakllar; so'z boshi bo'yicha (qo'shimchalar bilan ham: "tushumi", "omborda", "pullo").
 */
const RULES: [pattern: RegExp, text: string][] = [
  [/qoldi|qolgan|qolg'on|kam qol|tugad|tugab|zapas|запас|остат|осталос|закончил|\bstock|\bleft\b|running low|remain/, WAITING.stock],
  [/ombor|sklad|sklat|склад|warehouse/, WAITING.warehouse],
  [
    /tushum|(^|[^a-z'])pul|summa|so'm|daromad|foyda|rasxod|xarajat|harajat|kassa|naqd|karta|click|hisob|yisop|topdi|topgan|topg'on|выручк|деньг|сумм|расход|доход|прибыл|касс|налич|revenue|money|income|expense|profit|cash|sales/,
    WAITING.money,
  ],
];

/** Savolga mos kutish matni. [random] — testlarda tasodifiy tanlovni qotirish uchun. */
export function waitingText(question: string, random: () => number = Math.random): string {
  // tutuq belgisining har xil yozilishi (o‘, oʻ, o`) — bitta shaklga
  const text = question.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
  const rule = RULES.find(([pattern]) => pattern.test(text));
  return rule ? rule[1] : WAITING_GENERIC[Math.floor(random() * WAITING_GENERIC.length)];
}
