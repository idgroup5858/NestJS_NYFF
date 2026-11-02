import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { newSecret } from '../common/ids';
import { dbConnectionFromEnv } from '../database/db-config';
import { Setting } from '../database/setting.entity';
import { dateTime } from '../telegram/format';
import { TelegramService } from '../telegram/telegram.service';

const run = promisify(execFile);

/** `settings`: nusxasi yuborilgan oxirgi oy (`YYYY-MM`). */
const SENT_KEY = 'backup_sent_month';
/** Bot API 50 MB gacha fayl qabul qiladi — kattasi shu o'lchamdagi bo'laklarga. */
export const PART_BYTES = 45 * 1024 * 1024;
/** Oyning oxirgi kuni shu soatdan (mahalliy vaqt) keyin nusxa olinadi. */
export const DUE_HOUR = 23;
/** Olinmasa yoki yuborilmasa — shuncha vaqtdan keyin qayta. */
export const RETRY_MS = 60 * 60_000;

const MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentyabr',
  'Oktyabr',
  'Noyabr',
  'Dekabr',
];

const pad = (value: number) => String(value).padStart(2, '0');

/** Nusxasi kerak bo'lgan oxirgi oy: shu oyning oxirgi kuni 23:00 o'tgan bo'lsa — shu oy, aks holda o'tgan oy. */
export function dueMonth(now: Date): string {
  const due = new Date(now.getFullYear(), now.getMonth() + 1, 0, DUE_HOUR);
  const month = now >= due ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
}

/** `2026-11` → `Noyabr 2026` */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${MONTHS[index - 1]} ${year}`;
}

/**
 * Fayl nomlari: bitta — `nyff-2026-11.dump`; bo'laklar — `nyff-2026-11.dump.001`, `.002`, … (ketma-ket birlashtirilsa
 * — o'sha bitta fayl: Windows `copy /b`, Linux `cat`, 7-Zip "Combine files").
 */
export function partNames(month: string, parts: number): string[] {
  const base = `nyff-${month}.dump`;
  if (parts === 1) return [base];
  return Array.from({ length: parts }, (_, index) => `${base}.${String(index + 1).padStart(3, '0')}`);
}

/** `34,2 MB` */
function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Fayl ostidagi izoh: oy, olingan vaqt va butun nusxa hajmi; bo'laklarda — qaysi qism. */
export function backupCaption(
  month: string,
  takenAt: Date,
  size: number,
  part: number,
  parts: number,
): string {
  const lines = [
    parts > 1
      ? `Zaxira nusxa — ${monthLabel(month)}, ${part}/${parts}-qism`
      : `Zaxira nusxa — ${monthLabel(month)}`,
    `Olingan: ${dateTime(takenAt)} · ${megabytes(size)}`,
  ];
  if (parts > 1) lines.push(`Tiklash uchun ${parts} ta qismning hammasi kerak`);
  return lines.join('\n');
}

/**
 * `pg_dump`: `.env` dagi `PG_DUMP` (to'liq yo'l) yoki PATH dagisi; Windows'da PATH da bo'lmasa — eng yangi
 * `C:\Program Files\PostgreSQL\<versiya>\bin\pg_dump.exe` (o'rnatuvchi PATH'ga qo'shmaydi).
 */
export function pgDumpPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PG_DUMP) return env.PG_DUMP;
  if (process.platform === 'win32') {
    const root = join(env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    const versions = existsSync(root)
      ? readdirSync(root)
          .filter((version) => existsSync(join(root, version, 'bin', 'pg_dump.exe')))
          .sort((a, b) => parseFloat(b) - parseFloat(a))
      : [];
    if (versions.length) return join(root, versions[0], 'bin', 'pg_dump.exe');
  }
  return 'pg_dump';
}

/** Faylning [offset] dan [length] bayti. */
async function readPart(file: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}

/**
 * Oylik zaxira nusxa (2026-11-02 qarori): oyning oxirgi kuni kechasi bazaning to'liq nusxasi (`pg_dump -Fc`) Telegram
 * botga ulangan hamma admin chatlariga yuboriladi, keyin serverdan o'chadi — serverda nusxa saqlanmaydi. 50 MB dan
 * kattasi bo'laklarga bo'linadi. Olinmasa yoki yuborilmasa — har soatda qayta (birinchi xatoda adminlarga bir marta
 * ogohlantirish); server o'sha paytda o'chiq bo'lsa — yoqilgach.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger('Backup');
  private running = false;
  private retryAt = 0;
  /** ogohlantirish yuborilgan oy — har soatda qaytarilmaydi */
  private alerted: string | null = null;
  /** bo'lak o'lchami (testlarda kichik) */
  partBytes = PART_BYTES;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Fon ishi (`BackupJobs`): oy tugagan va uning nusxasi hali yuborilmagan bo'lsa — oladi va yuboradi. Birinchi ishga
   * tushishda o'tgan oylar yuborilmaydi (birinchi nusxa — joriy oy oxirida). Natija — yuborilgan oy yoki `null`.
   */
  async tick(now = new Date()): Promise<string | null> {
    if (this.running || now.getTime() < this.retryAt) return null;
    this.running = true;
    const month = dueMonth(now);
    try {
      const sent = (await this.dataSource.manager.findOneBy(Setting, { key: SENT_KEY }))?.value ?? null;
      if (sent === null) {
        await this.markSent(month);
        return null;
      }
      if (sent >= month) return null;
      await this.send(month, now);
      await this.markSent(month);
      this.retryAt = 0;
      this.alerted = null;
      this.logger.log(`Zaxira nusxa yuborildi: ${month}`);
      return month;
    } catch (error) {
      const reason = (error as Error).message;
      this.retryAt = now.getTime() + RETRY_MS;
      this.logger.error(`Zaxira nusxa ${month}: ${reason}`);
      if (this.alerted !== month) {
        this.alerted = month;
        await this.telegram
          .notifyAdmins(
            `${monthLabel(month)} zaxira nusxasi yuborilmadi: ${reason.slice(0, 300)}\nHar soatda qayta urinib ko'riladi.`,
          )
          .catch(() => undefined);
      }
      return null;
    } finally {
      this.running = false;
    }
  }

  private async markSent(month: string): Promise<void> {
    await this.dataSource.manager.upsert(Setting, { key: SENT_KEY, value: month }, ['key']);
  }

  /** Nusxa vaqtinchalik faylga, undan Telegram'ga (kamida bitta admin chati hammasini olishi shart), fayl o'chadi. */
  private async send(month: string, takenAt: Date): Promise<void> {
    if (!(await this.telegram.hasAdminChats()))
      throw new Error("Telegram bot ulanmagan yoki admin chati yo'q");
    const file = join(tmpdir(), `nyff-${month}-${newSecret(6)}.dump`);
    try {
      await this.dump(file);
      const { size } = await stat(file);
      const parts = Math.max(1, Math.ceil(size / this.partBytes));
      const partBytes = this.partBytes;
      const delivered = await this.telegram.sendDocuments(
        partNames(month, parts).map((filename, index) => ({
          filename,
          caption: backupCaption(month, takenAt, size, index + 1, parts),
          read: () => readPart(file, index * partBytes, Math.min(partBytes, size - index * partBytes)),
        })),
      );
      if (delivered === 0) throw new Error('Telegram faylni qabul qilmadi');
    } finally {
      await rm(file, { force: true });
    }
  }

  /** `pg_dump -Fc` (siqilgan, `pg_restore` bilan tiklanadi); parol — muhitda, buyruq qatorida emas. */
  private async dump(file: string): Promise<void> {
    const db = dbConnectionFromEnv();
    const args = [
      '-h',
      db.host,
      '-p',
      String(db.port),
      '-U',
      db.user,
      '-d',
      db.database,
      '-Fc',
      '-w',
      '-f',
      file,
    ];
    try {
      await run(pgDumpPath(), args, { env: { ...process.env, PGPASSWORD: db.password }, windowsHide: true });
    } catch (error) {
      const { stderr, message } = error as { stderr?: string; message: string };
      throw new Error(`pg_dump: ${(stderr || message).trim()}`);
    }
  }
}
