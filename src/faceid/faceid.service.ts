import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThan } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { faceIdAllows, isFaceIdStatus, parseEmployeeNo, type FaceIdNeed } from '../domain/faceid';
import { FaceIdEvent } from './faceid-event.entity';
import { FaceIdRequest, type FaceIdRequestMessage } from './faceid-request.entity';
import type { HrEventDto } from './faceid.dto';

/** Telegram'dagi so'rovga shuncha vaqt ichida javob berilmasa — muddati o'tadi. */
export const FACEID_REQUEST_TTL_MS = 10 * 60_000;
/** Admin bergan ruxsat shuncha vaqt amal qiladi (shu kassirga, shu filialda). */
export const FACEID_GRANT_MS = 10 * 60_000;
/** `branches.hrSeenAt` har so'rovda yozilmasin. */
const HR_SEEN_WRITE_MS = 30_000;

/** Kassa ko'radigan so'rov holati. */
export interface FaceIdRequestView {
  id: string;
  action: FaceIdNeed;
  /** `expired` — javob berilmadi yoki ruxsat muddati tugadi */
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** `pending` — javob kutish muddati, `approved` — ruxsat tugash vaqti */
  until: Date | null;
}

export type FaceIdDecision = 'decided' | 'already' | 'expired';

/**
 * FaceID (2026-11-04): filial HR tizimi yuborgan «Kirish» / «Chiqish» lar va kassa tekshiruvi. Filialda tekshiruv
 * yoqilgan bo'lsa (`branches.faceIdRequired`) kassir smenani terminaldan o'tib ochadi / topshiradi (`domain/faceid.ts`).
 * Terminal yoki HR ishlamasa — admin kartochkada o'chiradi yoki Telegram orqali bir martalik ruxsat beradi.
 */
@Injectable()
export class FaceIdService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ───────────────────────── HR tizimidan ─────────────────────────

  /** HR ulanishini tekshiradi ("Sinov") — filial nomi bilan. */
  async ping(branchId: string, now = new Date()): Promise<{ branch: { id: string; name: string } }> {
    const branch = (await this.dataSource.manager.findOneBy(Branch, { id: branchId })) ?? fail('not_found', `branch ${branchId}`);
    await this.touch(branchId, now);
    return { branch: { id: branch.id, name: branch.name } };
  }

  /**
   * HR yuborgan o'tishlar: faqat «Kirish» / «Chiqish» va tabel raqami shu filialdagi faol kassirnikiga mos kelganlari
   * saqlanadi (oshpaz, farrosh… — yo'q). Takrori (HR qayta yuborsa) tashlanadi. Kelajakdagi vaqt (terminal soati
   * oldinda) — qabul qilingan vaqt bilan.
   */
  async ingest(branchId: string, events: HrEventDto[], now = new Date()): Promise<{ saved: number; ignored: number }> {
    const em = this.dataSource.manager;
    const rows: { id: string; no: string }[] = await em.query(
      `SELECT id, "employeeNos"->>$1 AS no FROM users WHERE role = 'cashier' AND active AND "employeeNos" ? $1`,
      [branchId],
    );
    const cashierByNo = new Map(rows.map((row) => [Number(row.no), row.id]));

    const values: FaceIdEvent[] = [];
    for (const event of events) {
      const employeeNo = parseEmployeeNo(event.employeeNo);
      const userId = employeeNo === null ? undefined : cashierByNo.get(employeeNo);
      if (!userId || employeeNo === null || !isFaceIdStatus(event.status)) continue;
      values.push({
        id: newId('fev'),
        branchId,
        userId,
        employeeNo,
        status: event.status,
        occurredAt: new Date(Math.min(Date.parse(event.occurredAt), now.getTime())),
        receivedAt: now,
        device: (event.device ?? '').trim().slice(0, 100),
      });
    }
    let saved = 0;
    if (values.length > 0) {
      const result = await em.createQueryBuilder().insert().into(FaceIdEvent).values(values).orIgnore().returning(['id']).execute();
      saved = (result.raw as unknown[]).length;
    }
    await this.touch(branchId, now);
    return { saved, ignored: events.length - saved };
  }

  /** HR tirikligi — admin kartochkasida ("HR: 3 daqiqa oldin"). */
  private async touch(branchId: string, now: Date): Promise<void> {
    await this.dataSource.manager.query(
      `UPDATE branches SET "hrSeenAt" = $2 WHERE id = $1 AND ("hrSeenAt" IS NULL OR "hrSeenAt" < $3)`,
      [branchId, now, new Date(now.getTime() - HR_SEEN_WRITE_MS)],
    );
  }

  // ───────────────────────── kassa tekshiruvi ─────────────────────────

  /**
   * Kassir [need] ni qila oladimi: filialda tekshiruv o'chiq — ha; aks holda oxirgi Kirish / Chiqish bo'yicha
   * (`faceIdAllows`) yoki admin bergan ruxsat. Bo'lmasa — `faceid_checkin_required` (ochish, davom ettirish) yoki
   * `faceid_checkout_required` (topshirish).
   */
  async assert(need: FaceIdNeed, cashierId: string, branchId: string, now = new Date(), em?: EntityManager): Promise<void> {
    const manager = em ?? this.dataSource.manager;
    const branch = await manager.findOne(Branch, { where: { id: branchId }, select: { id: true, faceIdRequired: true } });
    if (!branch?.faceIdRequired) return;
    const last = await manager.findOne(FaceIdEvent, {
      where: { userId: cashierId },
      order: { occurredAt: 'DESC', receivedAt: 'DESC', id: 'DESC' },
    });
    if (faceIdAllows(need, last, branchId, now)) return;
    if (await this.granted(cashierId, branchId, now, manager)) return;
    fail(need === 'close' ? 'faceid_checkout_required' : 'faceid_checkin_required');
  }

  /** Admin Telegram orqali shu kassirga, shu filialda ruxsat bergan va u hali amal qiladi. */
  private granted(cashierId: string, branchId: string, now: Date, em: EntityManager): Promise<boolean> {
    return em.existsBy(FaceIdRequest, {
      userId: cashierId,
      branchId,
      status: 'approved',
      decidedAt: MoreThan(new Date(now.getTime() - FACEID_GRANT_MS)),
    });
  }

  // ───────────────────────── Telegram orqali ruxsat ─────────────────────────

  /**
   * Kassir ruxsat so'radi. Shu kassir va filialdan javob kutayotgan so'rov bo'lsa — o'sha (`created: false`, Telegram'ga
   * qayta yuborilmaydi), aks holda yangisi.
   */
  async createRequest(
    userId: string,
    branchId: string,
    action: FaceIdNeed,
    now = new Date(),
  ): Promise<{ request: FaceIdRequest; created: boolean }> {
    const em = this.dataSource.manager;
    const pending = await em.findOne(FaceIdRequest, {
      where: { userId, branchId, status: 'pending', createdAt: MoreThan(new Date(now.getTime() - FACEID_REQUEST_TTL_MS)) },
      order: { createdAt: 'DESC' },
    });
    if (pending) return { request: pending, created: false };
    const request: FaceIdRequest = {
      id: newId('fid'),
      userId,
      branchId,
      action,
      status: 'pending',
      createdAt: now,
      decidedAt: null,
      decidedBy: null,
      messages: [],
    };
    await em.insert(FaceIdRequest, request);
    return { request, created: true };
  }

  /** Telegram'ga ketgan xabarlar — qaror qilingach tahrirlash uchun. */
  async saveMessages(id: string, messages: FaceIdRequestMessage[]): Promise<void> {
    await this.dataSource.manager.update(FaceIdRequest, id, { messages });
  }

  /** So'rov yuborilmadi (Telegram javob bermadi) — o'chiriladi, kassir qayta so'ray olsin. */
  async dropRequest(id: string): Promise<void> {
    await this.dataSource.manager.delete(FaceIdRequest, { id, status: 'pending' });
  }

  /**
   * Admin qarori (Telegram tugmasi). Birinchi qaror amal qiladi (ikki admin bir vaqtda bossa ham); muddati o'tgan
   * so'rovga — `expired`. So'rov topilmasa — `null`.
   */
  async decide(
    id: string,
    approve: boolean,
    adminId: string,
    now = new Date(),
  ): Promise<{ request: FaceIdRequest; outcome: FaceIdDecision } | null> {
    return this.dataSource.transaction(async (em) => {
      const request = await em.findOne(FaceIdRequest, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!request) return null;
      if (request.status !== 'pending') return { request, outcome: 'already' };
      if (now.getTime() - request.createdAt.getTime() > FACEID_REQUEST_TTL_MS) return { request, outcome: 'expired' };
      const patch = { status: approve ? 'approved' : 'rejected', decidedAt: now, decidedBy: adminId } as const;
      await em.update(FaceIdRequest, id, patch);
      return { request: Object.assign(request, patch), outcome: 'decided' };
    });
  }

  async findRequest(id: string): Promise<FaceIdRequest | null> {
    return this.dataSource.manager.findOneBy(FaceIdRequest, { id });
  }

  /** Kassa so'rov holatini so'raydi (javob kelguncha). */
  async requestView(id: string, now = new Date()): Promise<FaceIdRequestView> {
    const request = (await this.findRequest(id)) ?? fail('not_found', `faceid request ${id}`);
    return requestView(request, now);
  }
}

export function requestView(request: FaceIdRequest, now: Date): FaceIdRequestView {
  const base = { id: request.id, action: request.action };
  if (request.status === 'pending') {
    const until = new Date(request.createdAt.getTime() + FACEID_REQUEST_TTL_MS);
    return { ...base, status: until > now ? 'pending' : 'expired', until };
  }
  if (request.status === 'approved' && request.decidedAt) {
    const until = new Date(request.decidedAt.getTime() + FACEID_GRANT_MS);
    return { ...base, status: until > now ? 'approved' : 'expired', until };
  }
  return { ...base, status: 'rejected', until: null };
}
