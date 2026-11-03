import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { fail, type ErrorCode } from '../common/errors';
import { Revocations } from '../common/revocations';
import { Setting } from '../database/setting.entity';

/** Kod bilan ochiladigan zal ekranlari: TV (navbat) va kiosk (buyurtma). Har filialda har biriga alohida kod. */
export const SCREEN_KINDS = ['tv', 'kiosk'] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];

/** `settings` jadvalidagi kalit: `tv_code:br_…`, `kiosk_code:br_…` → kod. */
export const screenCodeSetting = (kind: ScreenKind, branchId: string) => `${kind}_code:${branchId}`;

/** So'rov sarlavhasi (REST); TV socket'ida — `auth: { tvBranchId, tvCode }`. */
export const SCREEN_CODE_HEADER: Record<ScreenKind, string> = { tv: 'x-tv-code', kiosk: 'x-kiosk-code' };

const WRONG_CODE: Record<ScreenKind, ErrorCode> = { tv: 'wrong_tv_code', kiosk: 'wrong_kiosk_code' };

/** Kod — shuncha raqam: TV pultida / kiosk ekranida terish oson, 10⁸ variant. */
export const SCREEN_CODE_LENGTH = 8;

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Kiritilgan kod: bo'sh joy va chiziqchalarsiz (`4821 7390`, `4821-7390` → `48217390`). */
export const normalizeScreenCode = (code: string) => code.replace(/[\s-]/g, '');

/**
 * Filialning zal ekranlari kodlari — TV (navbat) va kiosk (buyurtma), har biri 8 raqam. Markaz o'zi yaratadi va bazada
 * saqlaydi (`.env` da emas); admin "Filiallar" → "TV kodi" / "Kiosk kodi" da ko'radi va kerak bo'lsa yangilaydi —
 * eski kod bilan ekran ishlamay qoladi va kod yana so'raladi (ulangan TV'lar darhol uziladi). Kodlar bir-biridan va
 * offline kassa kalitidan alohida: TV kodi faqat navbatni ochadi, kiosk kodi buyurtma beradi, offline kalit esa
 * kassirlarning PIN xeshini beradi va markazga buyurtma yozadi — birini yangilash boshqasiga tegmaydi.
 *
 * Noto'g'ri kod uchun blok yo'q (2026-11-03, foydalanuvchi: "15 daqiqa bloklanib qolmasin" — filialning hamma
 * qurilmalari bitta IP dan chiqadi, xodim adashsa ekranlar kutib qolardi): har noto'g'ri kod — faqat
 * `wrong_tv_code` / `wrong_kiosk_code`.
 */
@Injectable()
export class ScreenCodesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly revocations: Revocations,
  ) {}

  /** Filial kodi; hali yo'q bo'lsa — yaratiladi. */
  async get(kind: ScreenKind, branchId: string): Promise<string> {
    await this.assertBranch(branchId);
    const stored = await this.dataSource.manager.findOneBy(Setting, { key: screenCodeSetting(kind, branchId) });
    return stored?.value ?? this.save(kind, branchId);
  }

  /** Yangi kod — eskisi ishlamay qoladi (TV'lar darhol uziladi). */
  async regenerate(kind: ScreenKind, branchId: string): Promise<string> {
    await this.assertBranch(branchId);
    const code = await this.save(kind, branchId);
    this.revocations.screenCode(kind, branchId);
    return code;
  }

  /** Ekran so'rovi: kod shu filialning shu ekraniniki bo'lmasa (yoki berilmagan) — `wrong_tv_code` / `wrong_kiosk_code`. */
  async assert(kind: ScreenKind, branchId: string, code: string | undefined): Promise<void> {
    const given = normalizeScreenCode(code ?? '');
    if (!given) fail(WRONG_CODE[kind]);
    const stored = await this.dataSource.manager.findOneBy(Setting, { key: screenCodeSetting(kind, branchId) });
    if (stored && timingSafeEqual(digest(stored.value), digest(given))) return;
    fail(WRONG_CODE[kind]);
  }

  private async save(kind: ScreenKind, branchId: string): Promise<string> {
    const code = String(randomInt(0, 10 ** SCREEN_CODE_LENGTH)).padStart(SCREEN_CODE_LENGTH, '0');
    await this.dataSource.manager.upsert(Setting, { key: screenCodeSetting(kind, branchId), value: code }, ['key']);
    return code;
  }

  private async assertBranch(branchId: string): Promise<void> {
    if (!(await this.dataSource.manager.existsBy(Branch, { id: branchId }))) fail('not_found', `branch ${branchId}`);
  }
}
