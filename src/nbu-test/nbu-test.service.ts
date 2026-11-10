import { Injectable, Logger } from '@nestjs/common';
import { publicKeyFrom, rsaOaep, rsaPkcs1, signBody, uuidv7 } from './nbu-crypto';

/**
 * Milliy Ecom (NBU ekvayring, API v1) — sinov uchun mijoz. Asosiy tizimga (buyurtma, kassa, baza) va ishlab turgan
 * `/api/callback` ga (`nbu-callback`) umuman tegmaydi: kalitlar `.env` dan (yoki test sahifasidan vaqtincha), tokenlar
 * va jurnal — faqat xotirada (restartda tozalanadi). Bank faqat ro'yxatdan o'tgan IP'dan qabul qiladi — shuning uchun
 * so'rovni brauzer emas, shu server yuboradi.
 */

type BankOp =
  | 'publicKey'
  | 'tokenInit'
  | 'tokenRefresh'
  | 'paymentInit'
  | 'recurring'
  | 'bind'
  | 'unbind'
  | 'charge'
  | 'credits'
  | 'refund'
  | 'status'
  | 'account'
  | 'invoice';

const BANK_OPS: Record<BankOp, { method: 'GET' | 'POST'; path: string; auth: boolean }> = {
  publicKey: { method: 'GET', path: '/auth/token/public-key', auth: false },
  tokenInit: { method: 'POST', path: '/auth/token/init', auth: false },
  tokenRefresh: { method: 'POST', path: '/auth/token/refresh', auth: false },
  paymentInit: { method: 'POST', path: '/payment/init', auth: true },
  recurring: { method: 'POST', path: '/payment/recurring', auth: true },
  bind: { method: 'POST', path: '/payment/bind', auth: true },
  unbind: { method: 'POST', path: '/payment/unbind', auth: true },
  charge: { method: 'POST', path: '/payment/charge', auth: true },
  credits: { method: 'POST', path: '/payment/credits', auth: true },
  refund: { method: 'POST', path: '/payment/refund', auth: true },
  status: { method: 'POST', path: '/payment/status', auth: true },
  account: { method: 'POST', path: '/payment/account', auth: true },
  invoice: { method: 'POST', path: '/payment/invoice', auth: true },
};

export const NBU_OPS = Object.keys(BANK_OPS) as BankOp[];
export type NbuOp = BankOp;

export type SignatureEncoding = 'hex' | 'base64';
export type OaepHash = 'sha1' | 'sha256';

interface NbuConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  username: string;
  password: string;
  signatureEncoding: SignatureEncoding;
  oaepHash: OaepHash;
  bankPublicKey: string;
}

export type NbuConfigPatch = Partial<Record<keyof NbuConfig, string>> & { clear?: boolean };

export interface NbuCallResult {
  op: NbuOp;
  at: string;
  ok: boolean;
  ms: number;
  /** so'rov bankka yetib bormagan (sozlama yo'q, tarmoq xatosi, vaqt tugadi) */
  error?: string;
  request?: { method: string; url: string; headers: Record<string, string>; body?: unknown };
  response?: { httpStatus: number; body: unknown };
}

interface Session {
  pubKey: string | null;
  identityToken: string | null;
  accessToken: string | null;
  accessTokenAt: string | null;
  refreshToken: string | null;
  lastOrderId: string | null;
  lastTransactionId: string | null;
  paymentUrl: string | null;
  /** bog'langan karta tokeni — bank uni callback'da yuboradi (purpose=CARD_BINDING); test sahifasida qo'lda kiritiladi */
  cardToken: string | null;
}

export type NbuSessionPatch = Partial<Record<'cardToken' | 'lastOrderId' | 'lastTransactionId', string>>;

const emptySession = (): Session => ({
  pubKey: null,
  identityToken: null,
  accessToken: null,
  accessTokenAt: null,
  refreshToken: null,
  lastOrderId: null,
  lastTransactionId: null,
  paymentUrl: null,
  cardToken: null,
});

/** So'rovni bankka yubormasdan to'xtatadigan xato (sabab — test sahifasida ko'rinadi). */
class LocalError extends Error {}

const HISTORY_MAX = 30;
const TIMEOUT_MS = 30_000;
const SECRET_KEYS = new Set(['accessToken', 'refreshToken']);

function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 10 ? '•'.repeat(value.length) : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Jurnal va javobda tokenlar to'liq ko'rinmasin. */
function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.has(key) && typeof item === 'string' ? mask(item) : maskSecrets(item)]),
    );
  }
  return value;
}

function describeError(error: unknown): string {
  if (error instanceof LocalError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `Bank ${TIMEOUT_MS / 1000} soniyada javob bermadi — server IP bankda ro'yxatdan o'tmagan bo'lishi mumkin`;
    }
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message;
    return detail ? `${error.message} (${detail})` : error.message;
  }
  return String(error);
}

@Injectable()
export class NbuTestService {
  private readonly logger = new Logger('NbuTest');
  private overrides: Partial<NbuConfig> = {};
  private session: Session = emptySession();
  private history: NbuCallResult[] = [];

  private config(): NbuConfig {
    const env = (name: string) => process.env[name]?.trim() ?? '';
    const encoding = this.overrides.signatureEncoding ?? env('NBU_SIGNATURE_ENCODING');
    const oaep = this.overrides.oaepHash ?? env('NBU_OAEP_HASH');
    return {
      baseUrl: this.overrides.baseUrl ?? (env('NBU_BASE_URL') || 'https://ecom.nbu.uz/epgate'),
      apiKey: this.overrides.apiKey ?? env('NBU_API_KEY'),
      secretKey: this.overrides.secretKey ?? env('NBU_SECRET_KEY'),
      username: this.overrides.username ?? env('NBU_USERNAME'),
      password: this.overrides.password ?? env('NBU_PASSWORD'),
      signatureEncoding: encoding === 'base64' ? 'base64' : 'hex',
      oaepHash: oaep === 'sha256' ? 'sha256' : 'sha1',
      // PEM ichidagi qator ko'chishlari .env da `\n` bo'lib yozilishi mumkin
      bankPublicKey: (this.overrides.bankPublicKey ?? env('NBU_BANK_PUBLIC_KEY')).replace(/\\n/g, '\n'),
    };
  }

  state() {
    const config = this.config();
    return {
      config: {
        baseUrl: config.baseUrl,
        apiKey: mask(config.apiKey),
        secretKey: !!config.secretKey,
        username: mask(config.username),
        password: !!config.password,
        signatureEncoding: config.signatureEncoding,
        oaepHash: config.oaepHash,
        bankPublicKey: !!config.bankPublicKey,
        overridden: Object.keys(this.overrides),
      },
      session: {
        pubKey: !!this.session.pubKey,
        identityToken: !!this.session.identityToken,
        accessToken: mask(this.session.accessToken),
        accessTokenAt: this.session.accessTokenAt,
        refreshToken: !!this.session.refreshToken,
        lastOrderId: this.session.lastOrderId,
        lastTransactionId: this.session.lastTransactionId,
        paymentUrl: this.session.paymentUrl,
        cardToken: this.session.cardToken,
      },
      history: this.history,
    };
  }

  /** Qo'lda: karta tokeni (callback'dan), boshqa order / tranzaksiya. Bo'sh qator — tozalaydi. */
  setSession(patch: NbuSessionPatch) {
    for (const key of ['cardToken', 'lastOrderId', 'lastTransactionId'] as const) {
      const value = patch[key];
      if (value !== undefined) this.session[key] = value.trim() || null;
    }
    return this.state();
  }

  /** Bo'sh bo'lmagan qiymat — vaqtincha almashtiradi; bo'sh qator — `.env` dagisiga qaytaradi; `clear` — hammasini. */
  setConfig(patch: NbuConfigPatch) {
    if (patch.clear) this.overrides = {};
    for (const key of ['baseUrl', 'apiKey', 'secretKey', 'username', 'password', 'signatureEncoding', 'oaepHash', 'bankPublicKey'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value.trim()) (this.overrides as Record<string, string>)[key] = value.trim();
      else delete this.overrides[key];
    }
    return this.state();
  }

  /** Tokenlar, oxirgi order / tranzaksiya, karta tokeni va jurnal — tozalanadi (sozlamalar qoladi). */
  reset() {
    this.session = emptySession();
    this.history = [];
    return this.state();
  }

  /** Server internetga qaysi IP bilan chiqadi — bankda ro'yxatdan o'tgani shu bo'lishi kerak. */
  async serverIp(): Promise<{ ip: string | null; error?: string }> {
    try {
      const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10_000) });
      const data = (await response.json()) as { ip?: string };
      return { ip: data.ip ?? null };
    } catch (error) {
      return { ip: null, error: describeError(error) };
    }
  }

  async call(op: NbuOp, input?: Record<string, unknown>): Promise<NbuCallResult> {
    const at = new Date().toISOString();
    const started = Date.now();
    let request: NbuCallResult['request'];
    try {
      const spec = BANK_OPS[op];
      const config = this.config();
      if (!config.apiKey || !config.secretKey) throw new LocalError('NBU_API_KEY va NBU_SECRET_KEY sozlanmagan (.env yoki "Sozlamalar")');
      if (spec.auth && !this.session.accessToken) throw new LocalError('Avval token oling — "Token olish" (2-qadam)');

      const body = spec.method === 'GET' ? undefined : this.buildBody(op, input ?? {}, config);
      const text = body === undefined ? '' : JSON.stringify(body);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-KEY': config.apiKey,
        'X-SIGNATURE': signBody(config.secretKey, timestamp, text, config.signatureEncoding),
        'X-TIMESTAMP': timestamp,
        'X-REQUEST-ID': uuidv7(),
      };
      if (spec.auth) headers['X-Auth-Token'] = this.session.accessToken!;
      const url = `${config.baseUrl.replace(/\/+$/, '')}${spec.path}`;

      request = {
        method: spec.method,
        url,
        headers: { ...headers, 'X-API-KEY': mask(config.apiKey)!, ...(spec.auth ? { 'X-Auth-Token': mask(this.session.accessToken)! } : {}) },
        body: maskSecrets(body),
      };

      const response = await fetch(url, {
        method: spec.method,
        headers,
        body: body === undefined ? undefined : text,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const raw = await response.text();
      let json: unknown;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = undefined;
      }
      this.absorb(op, json);
      const code = (json as { status?: { code?: unknown } } | null | undefined)?.status?.code;
      this.logger.log(`${op} → HTTP ${response.status}, status.code=${String(code)}`);
      return this.remember({
        op,
        at,
        ok: response.ok && code === 0,
        ms: Date.now() - started,
        request,
        response: { httpStatus: response.status, body: json === undefined ? raw : maskSecrets(json) },
      });
    } catch (error) {
      if (!(error instanceof LocalError)) this.logger.warn(`${op}: ${describeError(error)}`);
      return this.remember({ op, at, ok: false, ms: Date.now() - started, error: describeError(error), request });
    }
  }

  private buildBody(op: BankOp, input: Record<string, unknown>, config: NbuConfig): Record<string, unknown> {
    if (op === 'tokenInit') {
      if (!this.session.pubKey || !this.session.identityToken) throw new LocalError('Avval 1-qadam: "Ochiq kalitni olish"');
      if (!config.username || !config.password) throw new LocalError('NBU_USERNAME va NBU_PASSWORD sozlanmagan (.env yoki "Sozlamalar")');
      const key = publicKeyFrom(this.session.pubKey);
      return {
        username: rsaPkcs1(key, config.username),
        password: rsaPkcs1(key, config.password),
        identityToken: this.session.identityToken,
      };
    }
    if (op === 'tokenRefresh') {
      if (!this.session.accessToken || !this.session.refreshToken) throw new LocalError('Yangilash uchun token yo\'q — avval "Token olish"');
      return { accessToken: this.session.accessToken, refreshToken: this.session.refreshToken };
    }

    const body = this.fillPlaceholders(input);
    if (typeof body.orderId === 'string' && op !== 'status') this.session.lastOrderId = body.orderId;

    // karta ochiq ko'rinishda bankka ketmaydi: {"pan","expiry"} bank bergan kalit bilan RSA-OAEP → encryptedData
    if (op === 'credits' && body.card && typeof body.card === 'object') {
      if (!config.bankPublicKey) throw new LocalError('Karta shifrlash uchun bank bergan ochiq kalit (NBU_BANK_PUBLIC_KEY) kiritilmagan');
      const card = body.card as { pan?: unknown; expiry?: unknown };
      const plain = JSON.stringify({ pan: String(card.pan ?? ''), expiry: String(card.expiry ?? '') });
      delete body.card;
      body.encryptedData = rsaOaep(publicKeyFrom(config.bankPublicKey), plain, config.oaepHash);
    }
    return body;
  }

  /**
   * `{{orderId}}` — har so'rovda yangi UUID v7 (bitta so'rov ichida hamma joyda bir xil); `{{lastOrderId}}`,
   * `{{lastTransactionId}}` — oxirgi javobdan; `{{cardToken}}` — "Sessiya"da kiritilgani.
   */
  private fillPlaceholders(input: Record<string, unknown>): Record<string, unknown> {
    let orderId: string | null = null;
    const vars: Record<string, string | null> = {
      lastOrderId: this.session.lastOrderId,
      lastTransactionId: this.session.lastTransactionId,
      cardToken: this.session.cardToken,
    };
    const fill = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
          if (name === 'orderId') return (orderId ??= uuidv7());
          if (!(name in vars)) throw new LocalError(`Noma'lum o'zgaruvchi: {{${name}}}`);
          const found = vars[name];
          if (!found) throw new LocalError(`{{${name}}} uchun qiymat hali yo'q`);
          return found;
        });
      }
      if (Array.isArray(value)) return value.map(fill);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
      return value;
    };
    return fill(input) as Record<string, unknown>;
  }

  /** Javobdan keyingi qadamlar uchun kerakli qiymatlarni eslab qoladi. */
  private absorb(op: BankOp, json: unknown) {
    const data = ((json as { data?: unknown } | null | undefined)?.data ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof data[key] === 'string' && data[key] ? (data[key] as string) : null);
    if (op === 'publicKey') {
      this.session.pubKey = text('pubKey') ?? this.session.pubKey;
      this.session.identityToken = text('identityToken') ?? this.session.identityToken;
    }
    if ((op === 'tokenInit' || op === 'tokenRefresh') && text('accessToken')) {
      this.session.accessToken = text('accessToken');
      this.session.accessTokenAt = new Date().toISOString();
      this.session.refreshToken = text('refreshToken') ?? this.session.refreshToken;
    }
    this.session.lastTransactionId = text('transactionId') ?? this.session.lastTransactionId;
    this.session.paymentUrl = text('paymentUrl') ?? this.session.paymentUrl;
  }

  private remember(result: NbuCallResult): NbuCallResult {
    this.history.unshift(result);
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    return result;
  }
}
