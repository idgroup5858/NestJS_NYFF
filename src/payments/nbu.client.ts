import { Injectable, Logger } from '@nestjs/common';
import { publicKeyFrom, rsaPkcs1, signBody, uuidv7 } from '../nbu-test/nbu-crypto';

/**
 * Milliy Ecom (NBU ekvayring, API v1) — ishchi mijoz: mobil ilovada karta bilan to'lov. Test sahifasidagi
 * `NbuTestService` dan alohida (u qo'lda boshqariladi, tokenlari o'ziniki). Kalitlar — `.env` dagi `NBU_*`; token
 * (2 soat) xotirada, muddati yaqinlashsa yoki bank `401` / `403` qaytarsa — qaytadan login (ochiq kalit → `token/init`).
 * Bank faqat ro'yxatdan o'tgan IP'dan qabul qiladi — so'rovni doim server yuboradi, ilova emas.
 */

/** Bank javob berdi, lekin xato bilan (`status.code` ≠ 0 yoki HTTP xato). Tarmoq xatosi — oddiy `Error`. */
export class NbuError extends Error {
  constructor(
    message: string,
    readonly http: number | null = null,
  ) {
    super(message);
  }
}

export type NbuPaymentState = 'success' | 'failed' | 'pending';

/** Bankdagi to'lov holati — callback tanasidan yoki `/payment/status` javobidan. */
export interface NbuPaymentInfo {
  orderId: string | null;
  state: NbuPaymentState;
  /** tiyinda */
  amount: number | null;
  transactionId: string | null;
}

const TIMEOUT_MS = 20_000;
/** bank tokeni 2 soat yashaydi — undan oldinroq yangisi olinadi */
const TOKEN_TTL_MS = 100 * 60_000;
const SUCCESS = new Set(['SUCCESS', 'PAID', 'COMPLETED', 'CONFIRMED']);
const FAILED = new Set(['FAILED', 'FAIL', 'DECLINED', 'REJECTED', 'ERROR', 'CANCELLED', 'CANCELED', 'EXPIRED', 'TIMEOUT']);

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Callback tanasi yoki holat javobi (`data`) → to'lov holati. Bank shakli hali haqiqiy to'lovda ko'rilmagan — shuning
 * uchun bag'rikeng o'qiladi: `{ data: {...} }` ichida bo'lsa ham, ro'yxat bo'lsa — shu `orderId` li element.
 */
export function readNbuPayment(value: unknown, orderId?: string): NbuPaymentInfo {
  let record: unknown = value;
  if (Array.isArray(record)) {
    record = record.find((item) => (item as { orderId?: unknown })?.orderId === orderId) ?? record[0];
  }
  const outer = (record ?? {}) as Record<string, unknown>;
  const inner = outer.orderId === undefined && outer.data && typeof outer.data === 'object' ? outer.data : outer;
  const data = inner as Record<string, unknown>;
  const status = (text(data.status) ?? text(data.transactionStatus) ?? text(data.state) ?? '').toUpperCase();
  const rawAmount = data.amount;
  const amount =
    typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string' && rawAmount.trim() && Number.isFinite(Number(rawAmount))
        ? Number(rawAmount)
        : null;
  return {
    orderId: text(data.orderId),
    state: SUCCESS.has(status) ? 'success' : FAILED.has(status) ? 'failed' : 'pending',
    amount,
    transactionId: text(data.transactionId),
  };
}

/** Kartani bog'lash natijasi (callback, `purpose: CARD_BINDING`). */
export interface NbuCardBinding {
  orderId: string | null;
  state: NbuPaymentState;
  cardToken: string | null;
  /** `9860********4764` */
  maskedPan: string | null;
}

/**
 * Haqiqiy callback (2026-11-19): `{ transactionId, orderId, status, amount: 0, purpose: "CARD_BINDING", clientId,
 * maskedPan, cardToken, … }` — hujjatdagi ro'yxatda `cardToken` va `maskedPan` yo'q, lekin keladi.
 */
export function readNbuCardBinding(value: unknown): NbuCardBinding {
  const outer = (value ?? {}) as Record<string, unknown>;
  const data = (outer.orderId === undefined && outer.data && typeof outer.data === 'object' ? outer.data : outer) as Record<
    string,
    unknown
  >;
  const info = readNbuPayment(data);
  return {
    orderId: info.orderId,
    state: info.state,
    cardToken: text(data.cardToken) ?? text(data.token),
    maskedPan: text(data.maskedPan) ?? text(data.card) ?? text(data.pan),
  };
}

/** Bank sahifasi havolasi bo'lishi mumkin bo'lgan maydonlar (avval aniq nomlar, keyin "url" / "link" so'zi borlari). */
const URL_KEYS = ['paymenturl', 'payment_url', 'paymentlink', 'checkouturl', 'redirecturl', 'formurl', 'url', 'link', 'href'];
/** Biz yuborgan qaytish manzillari javobda qaytarilishi mumkin — ular bank sahifasi emas. */
const NOT_PAYMENT_URL = /^(success|failure|fail|callback|return|cancel|notify)/i;
const isHttp = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());

/**
 * `payment/init` javobidagi bank sahifasi havolasi. Hujjatda — `data.paymentUrl`, haqiqatda — `data.url` (2026-11-18);
 * shakl yana o'zgarsa ham topilsin — javob ichidan qidiriladi: avval aniq nomli maydonlar, keyin nomida "url" / "link"
 * bori, keyin ichkari (`data`, `result` …). Qaytish manzillarimiz (`successUrl`, `failureUrl`) olinmaydi.
 */
export function findPaymentUrl(value: unknown, depth = 0): string | null {
  if (isHttp(value)) return depth > 0 ? value.trim() : null;
  if (depth > 5 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPaymentUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !NOT_PAYMENT_URL.test(key));
  for (const name of URL_KEYS) {
    const hit = entries.find(([key, item]) => key.toLowerCase() === name && isHttp(item));
    if (hit) return (hit[1] as string).trim();
  }
  const named = entries.find(([key, item]) => /url|link|href/i.test(key) && isHttp(item));
  if (named) return (named[1] as string).trim();
  for (const [key, item] of entries) {
    // `data: "https://…"` kabi — havolaning o'zi
    if (isHttp(item) && /^(data|result|payload)$/i.test(key)) return item.trim();
    if (item && typeof item === 'object') {
      const found = findPaymentUrl(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Javob ichidan nomi bo'yicha birinchi matn qiymati (`transactionId`). */
function findText(value: unknown, name: string, depth = 0): string | null {
  if (depth > 5 || !value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === name && (typeof item === 'string' || typeof item === 'number')) return String(item);
    const found = findText(item, name, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Logga — javob qisqartirib (2000 belgi). */
function preview(json: unknown): string {
  const raw = typeof json === 'string' ? json : JSON.stringify(json);
  return (raw ?? 'null').slice(0, 2000);
}

interface NbuConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  username: string;
  password: string;
  signatureEncoding: 'hex' | 'base64';
}

@Injectable()
export class NbuClient {
  private readonly logger = new Logger('NbuClient');
  private token: { value: string; at: number } | null = null;
  private login: Promise<string> | null = null;

  /** Bir bosqichli to'lov (`REDIRECT`): javobdagi `paymentUrl` — bankning karta sahifasi. `amount` — tiyinda, UZS. */
  async initPayment(input: {
    orderId: string;
    amount: number;
    successUrl: string;
    failureUrl: string;
    sessionTimeout: number;
  }): Promise<{ paymentUrl: string; transactionId: string | null }> {
    const { data, json } = await this.authorized('payment/init', '/payment/init', {
      amount: input.amount,
      currency: 860,
      orderId: input.orderId,
      paymentType: 'REDIRECT',
      sessionTimeout: input.sessionTimeout,
      successUrl: input.successUrl,
      failureUrl: input.failureUrl,
    });
    // haqiqiy javob (2026-11-18, test sahifasi): `{ status, data: { transactionId, url }, meta }` — hujjatdagi
    // `paymentUrl` emas; boshqa shakl kelsa — javob ichidan qidiriladi
    const paymentUrl = (isHttp(data.url) ? data.url.trim() : null) ?? findPaymentUrl(json);
    if (!paymentUrl) throw new NbuError(`payment/init: javobda to'lov havolasi yo'q — javob: ${preview(json)}`);
    // bank javobi shakli hali aniqlanmoqda — logda ko'rinib tursin (maxfiy narsa yo'q: havola, tranzaksiya, holat)
    this.logger.log(`payment/init javobi: ${preview(json)}`);
    return { paymentUrl, transactionId: text(data.transactionId) ?? findText(json, 'transactionId') };
  }

  /**
   * Kartani bog'lash (`REDIRECT`, pul yechilmaydi): javobda bank sahifasi havolasi; karta tokeni keyin callback'da
   * (`purpose: CARD_BINDING`, `cardToken`, `maskedPan`) keladi. [clientId] — mijozning bizdagi id'si.
   */
  async bind(input: {
    orderId: string;
    clientId: string;
    successUrl: string;
    failureUrl: string;
    sessionTimeout: number;
  }): Promise<{ paymentUrl: string; transactionId: string | null }> {
    const { data, json } = await this.authorized('payment/bind', '/payment/bind', {
      currency: 860,
      orderId: input.orderId,
      clientId: input.clientId,
      paymentType: 'REDIRECT',
      sessionTimeout: input.sessionTimeout,
      successUrl: input.successUrl,
      failureUrl: input.failureUrl,
    });
    const paymentUrl = (isHttp(data.url) ? data.url.trim() : null) ?? findPaymentUrl(json);
    if (!paymentUrl) throw new NbuError(`payment/bind: javobda havola yo'q — javob: ${preview(json)}`);
    return { paymentUrl, transactionId: text(data.transactionId) };
  }

  /**
   * Bog'langan kartadan yechish — bank sahifasisiz, natija darhol (`data.status`: `SUCCESS` / `FAILED`). Bank xato
   * qaytarsa — `NbuError` (pul yechilmagan); tarmoq xatosi — natija noma'lum (holat keyin so'raladi).
   */
  async charge(input: { orderId: string; cardToken: string; amount: number }): Promise<NbuPaymentInfo> {
    const { data } = await this.authorized('payment/charge', '/payment/charge', {
      orderId: input.orderId,
      cardToken: input.cardToken,
      amount: input.amount,
      currency: 860,
    });
    return readNbuPayment(data, input.orderId);
  }

  /** Bog'langan kartani uzish. */
  async unbind(input: { clientId: string; cardToken: string }): Promise<void> {
    await this.authorized('payment/unbind', '/payment/unbind', { clientId: input.clientId, cardToken: input.cardToken });
  }

  /** To'lov holati `orderId` bo'yicha. */
  async status(orderId: string): Promise<NbuPaymentInfo> {
    const { data } = await this.authorized('payment/status', '/payment/status', { orderId });
    return readNbuPayment(data, orderId);
  }

  // ───────────────────────── ichki ─────────────────────────

  private config(): NbuConfig {
    const env = (name: string) => process.env[name]?.trim() ?? '';
    return {
      baseUrl: (env('NBU_BASE_URL') || 'https://ecom.nbu.uz/epgate/api/v1').replace(/\/+$/, ''),
      apiKey: env('NBU_API_KEY'),
      secretKey: env('NBU_SECRET_KEY'),
      username: env('NBU_USERNAME'),
      password: env('NBU_PASSWORD'),
      signatureEncoding: env('NBU_SIGNATURE_ENCODING') === 'base64' ? 'base64' : 'hex',
    };
  }

  /**
   * Token bilan so'rov; bank tokenni rad etsa — yangi token bilan bir marta qayta. `data` — javobdagi `data` obyekti,
   * `json` — butun javob (shakli kutilganidan farq qilsa qidirish uchun).
   */
  private async authorized(
    op: string,
    path: string,
    body: unknown,
  ): Promise<{ data: Record<string, unknown>; json: unknown }> {
    let result = await this.send('POST', path, body, await this.accessToken());
    if (result.http === 401 || result.http === 403 || /token/i.test(result.message)) {
      this.logger.warn(`${op}: token rad etildi (HTTP ${result.http}) — qayta login`);
      result = await this.send('POST', path, body, await this.accessToken(true));
    }
    return { data: this.unwrap(op, result), json: result.json };
  }

  private accessToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() - this.token.at < TOKEN_TTL_MS) return Promise.resolve(this.token.value);
    this.login ??= this.freshToken().finally(() => {
      this.login = null;
    });
    return this.login;
  }

  /** Ochiq kalit va identityToken → login / parol RSA PKCS#1 bilan shifrlanib `token/init`. */
  private async freshToken(): Promise<string> {
    const config = this.config();
    const keys = this.unwrap('public-key', await this.send('GET', '/auth/token/public-key', undefined, null));
    const pubKey = text(keys.pubKey);
    const identityToken = text(keys.identityToken);
    if (!pubKey || !identityToken) throw new NbuError("public-key: pubKey yoki identityToken yo'q");
    const key = publicKeyFrom(pubKey);
    const data = this.unwrap(
      'token/init',
      await this.send(
        'POST',
        '/auth/token/init',
        { username: rsaPkcs1(key, config.username), password: rsaPkcs1(key, config.password), identityToken },
        null,
      ),
    );
    const accessToken = text(data.accessToken);
    if (!accessToken) throw new NbuError("token/init: accessToken yo'q");
    this.token = { value: accessToken, at: Date.now() };
    this.logger.log('Bank tokeni olindi');
    return accessToken;
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    token: string | null,
  ): Promise<{ http: number; json: unknown; message: string }> {
    const config = this.config();
    if (!config.apiKey || !config.secretKey) throw new NbuError('NBU_API_KEY / NBU_SECRET_KEY sozlanmagan');
    const payload = body === undefined ? '' : JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-KEY': config.apiKey,
      'X-SIGNATURE': signBody(config.secretKey, timestamp, payload, config.signatureEncoding),
      'X-TIMESTAMP': timestamp,
      'X-REQUEST-ID': uuidv7(),
    };
    if (token) headers['X-Auth-Token'] = token;
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await response.text();
    let json: unknown = raw;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      // HTML / matn — xato xabarida ko'rinadi
    }
    const status = (json as { status?: { message?: unknown } } | null)?.status;
    return { http: response.status, json, message: typeof status?.message === 'string' ? status.message : '' };
  }

  /** `{ status: { code: 0 }, data }` → `data`; boshqasi — `NbuError`. */
  private unwrap(op: string, result: { http: number; json: unknown; message: string }): Record<string, unknown> {
    const envelope = result.json as { status?: { code?: unknown }; data?: unknown } | null;
    const code = envelope?.status?.code;
    if (result.http < 200 || result.http >= 300 || code !== 0) {
      const detail = typeof result.json === 'string' ? result.json.slice(0, 200) : result.message;
      throw new NbuError(`${op}: HTTP ${result.http}, code=${String(code)} ${detail}`.trim(), result.http);
    }
    const data = envelope?.data;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  }
}
