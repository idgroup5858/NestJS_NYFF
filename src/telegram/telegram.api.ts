import { Injectable } from '@nestjs/common';

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** Ovozli xabar (OGG/Opus). */
export interface TgVoice {
  file_id: string;
  /** soniya */
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  from?: TgUser;
  text?: string;
  voice?: TgVoice;
}

export interface TgUpload {
  /** forma maydoni (`document`) */
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/** Telegram javobidagi xato: `status` — `error_code` (401 — token yaroqsiz, 409 — boshqa getUpdates / webhook). */
export class TelegramApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Telegram Bot API (`https://api.telegram.org/bot<token>/<method>`) — kutubxonasiz, faqat kerakli metodlar. Token
 * URL'da bo'lgani uchun xato matnlariga URL qo'shilmaydi. Testlarda soxtasi bilan almashtiriladi.
 */
@Injectable()
export class TelegramApi {
  async call<T>(token: string, method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });
    return this.result<T>(response);
  }

  /** Fayl bilan (multipart) — masalan `sendDocument`. */
  async upload<T>(token: string, method: string, fields: Record<string, string>, file: TgUpload): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(file.field, new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.filename);
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form });
    return this.result<T>(response);
  }

  /** Foydalanuvchi yuborgan fayl (ovozli xabar): `getFile` → `/file/bot<token>/<path>` (Bot API — 20 MB gacha). */
  async download(token: string, fileId: string): Promise<Buffer> {
    const file = await this.call<{ file_path?: string }>(token, 'getFile', { file_id: fileId });
    if (!file.file_path) throw new TelegramApiError(404, "file_path yo'q");
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new TelegramApiError(response.status, response.statusText);
    return Buffer.from(await response.arrayBuffer());
  }

  private async result<T>(response: Response): Promise<T> {
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    } | null;
    if (!body?.ok) throw new TelegramApiError(body?.error_code ?? response.status, body?.description ?? response.statusText);
    return body.result as T;
  }
}

/** Telegram xabari 4096 belgigacha — uzun javob qatorlar chegarasida bo'linadi. */
export function splitMessage(text: string, max = 4000): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    for (let rest = line; ; ) {
      const room = max - (current ? current.length + 1 : 0);
      if (rest.length <= room) {
        current = current ? `${current}\n${rest}` : rest;
        break;
      }
      if (current) {
        chunks.push(current);
        current = '';
        continue;
      }
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}
