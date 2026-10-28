import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Xato kodlari. Birinchi qismi — ReactJS_NYFF `src/domain/errors.ts` dagi kodlar bilan bir xil (UI matnni shu kod
 * bo'yicha o'z tilida ko'rsatadi), qolganlari — faqat serverda paydo bo'ladiganlar (API.md da tavsifi bor).
 */
export type ErrorCode =
  | 'not_found'
  | 'wrong_pin'
  | 'invalid_pin'
  | 'user_inactive'
  | 'empty_order'
  | 'product_unavailable'
  | 'invalid_qty'
  | 'invalid_price'
  | 'invalid_status'
  | 'already_decided'
  | 'same_warehouse'
  | 'shift_not_open'
  | 'name_required'
  | 'insufficient_stock'
  | 'branch_required'
  | 'invalid_amount'
  | 'self_action'
  | 'recipe_required'
  | 'phone_required'
  | 'address_required'
  | 'zone_too_small'
  | 'invalid_location'
  | 'forbidden'
  | 'invalid_image'
  // ── faqat backend ──
  | 'unauthorized'
  | 'invalid_input'
  | 'too_many_attempts'
  | 'branch_closed'
  | 'location_required'
  // ── kuryer ──
  | 'off_duty'
  | 'already_taken'
  | 'other_branch'
  | 'courier_busy'
  | 'not_ready'
  // ── kuryer kirishi (login va parol) ──
  | 'wrong_login'
  | 'invalid_login'
  | 'invalid_password'
  | 'login_taken';

const STATUS: Partial<Record<ErrorCode, HttpStatus>> = {
  unauthorized: HttpStatus.UNAUTHORIZED,
  wrong_pin: HttpStatus.UNAUTHORIZED,
  wrong_login: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  user_inactive: HttpStatus.FORBIDDEN,
  self_action: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  invalid_status: HttpStatus.CONFLICT,
  already_decided: HttpStatus.CONFLICT,
  shift_not_open: HttpStatus.CONFLICT,
  insufficient_stock: HttpStatus.CONFLICT,
  branch_closed: HttpStatus.CONFLICT,
  off_duty: HttpStatus.CONFLICT,
  already_taken: HttpStatus.CONFLICT,
  other_branch: HttpStatus.CONFLICT,
  courier_busy: HttpStatus.CONFLICT,
  not_ready: HttpStatus.CONFLICT,
  login_taken: HttpStatus.CONFLICT,
  too_many_attempts: HttpStatus.TOO_MANY_REQUESTS,
};

/** `message` — o'zbekcha standart matn (loglar va matnni o'zi tarjima qilmaydigan mijozlar uchun). */
const MESSAGES: Record<ErrorCode, string> = {
  not_found: 'Topilmadi',
  wrong_pin: "PIN noto'g'ri",
  invalid_pin: "PIN 4 tadan 8 tagacha raqamdan iborat bo'lishi kerak",
  user_inactive: 'Bu xodim bloklangan',
  empty_order: "Ro'yxat bo'sh",
  product_unavailable: "Bu taom hozir sotuvda yo'q",
  invalid_qty: "Miqdor noto'g'ri",
  invalid_price: 'Narx kiritilmagan',
  invalid_status: "Holat allaqachon o'zgargan",
  already_decided: "Bu kirim allaqachon ko'rib chiqilgan",
  same_warehouse: "Bir xil omborga ko'chirib bo'lmaydi",
  shift_not_open: 'Smena ochilmagan',
  name_required: 'Nomini kiriting',
  insufficient_stock: "Omborda yetarli mahsulot yo'q",
  branch_required: 'Filialni tanlang',
  invalid_amount: "Summa noto'g'ri",
  self_action: "O'zingizni bloklay olmaysiz va o'z rolingizni o'zgartira olmaysiz",
  recipe_required: "Retseptga kamida bitta mahsulot qo'shing",
  phone_required: 'Telefon raqamini kiriting',
  address_required: 'Yetkazib berish manzilini kiriting',
  zone_too_small: "Hudud kamida 3 ta nuqtadan iborat bo'lishi kerak",
  invalid_location: "Xaritadagi nuqta noto'g'ri",
  forbidden: 'Bu amal sizning rolingiz uchun emas',
  invalid_image: "Rasm JPG, PNG, WEBP yoki AVIF bo'lishi va 5 MB dan oshmasligi kerak",
  unauthorized: 'Avval tizimga kiring',
  invalid_input: "So'rov ma'lumotlari noto'g'ri",
  too_many_attempts: "Ko'p marta xato kiritildi — birozdan keyin urinib ko'ring",
  branch_closed: 'Filial hozir buyurtma qabul qilmayapti',
  location_required: 'Yetkazib berish joyini xaritada belgilang (GPS)',
  off_duty: 'Avval «Ishdaman» ni yoqing',
  already_taken: 'Bu buyurtmani boshqa kuryer oldi',
  other_branch: "Qo'lingizda boshqa filial buyurtmalari bor",
  courier_busy: "Avval yo'ldagi buyurtmalarni yetkazing",
  not_ready: 'Hamma buyurtma hali tayyor emas',
  wrong_login: "Login yoki parol noto'g'ri",
  invalid_login: 'Login 3–40 belgi: lotin harflari, raqam, «.», «_», «-»',
  invalid_password: "Parol kamida 6 belgidan iborat bo'lishi kerak",
  login_taken: 'Bu login band — boshqasini tanlang',
};

/** Javob tanasi: `{ statusCode, code, message, detail? }`. `detail` — texnik izoh (qaysi taom, qaysi id). */
export function appError(code: ErrorCode, detail?: string): HttpException {
  const status = STATUS[code] ?? HttpStatus.BAD_REQUEST;
  return new HttpException({ statusCode: status, code, message: MESSAGES[code], ...(detail && { detail }) }, status);
}

/** Frontend mantiqidagi `fail()` bilan bir xil: xato kodi bilan to'xtatadi. */
export function fail(code: ErrorCode, detail?: string): never {
  throw appError(code, detail);
}
