import { constants, createHmac, createPublicKey, publicEncrypt, randomBytes, type KeyObject } from 'node:crypto';

/** UUID v7 (vaqt bo'yicha tartiblangan) — bank `orderId` va `X-REQUEST-ID` uchun shuni kutadi. */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `X-SIGNATURE` = HMAC_SHA256(SECRET_KEY, X-TIMESTAMP + '.' + body); GET so'rovda body — bo'sh qator. */
export function signBody(secret: string, timestamp: string, body: string, encoding: 'hex' | 'base64'): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest(encoding);
}

/** Bank kaliti PEM ko'rinishida yoki sarlavhasiz base64 (SPKI, bo'lmasa PKCS#1) bo'lib kelishi mumkin. */
export function publicKeyFrom(value: string): KeyObject {
  const text = value.trim();
  if (text.includes('BEGIN')) return createPublicKey(text);
  const der = Buffer.from(text.replace(/\s+/g, ''), 'base64');
  try {
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return createPublicKey({ key: der, format: 'der', type: 'pkcs1' });
  }
}

/** Login / parol — RSA-2048, PKCS#1 v1.5 (`/auth/token/init`), natija base64. */
export function rsaPkcs1(key: KeyObject, text: string): string {
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(text, 'utf8')).toString('base64');
}

/** Karta ma'lumoti — RSA-OAEP (`/payment/credits` → `encryptedData`), natija base64. */
export function rsaOaep(key: KeyObject, text: string, hash: 'sha1' | 'sha256'): string {
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: hash }, Buffer.from(text, 'utf8')).toString('base64');
}
