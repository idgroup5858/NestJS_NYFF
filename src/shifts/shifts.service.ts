import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { Branch } from '../branches/branch.entity';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { pageParams, type Page } from '../common/pagination';
import { FaceIdService } from '../faceid/faceid.service';
import { Order } from '../orders/order.entity';
import { orderView } from '../orders/order.views';
import { Shift } from './shift.entity';
import { ShiftListQuery } from './shift.dto';
import { ShiftEvents } from './shift-events';
import { shiftSummaries, type ShiftSummary } from './shift-summary';

export type ShiftWithSummary = Shift & { summary: ShiftSummary };

/** Smenalar ro'yxatining jami (filtrlangan hammasi bo'yicha). */
export interface ShiftsSummary {
  count: number;
  /** hozir ochiq smenalar */
  open: number;
  revenue: number;
  cash: number;
}

@Injectable()
export class ShiftsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: ShiftEvents,
    private readonly faceId: FaceIdService,
  ) {}

  /**
   * Kassir kirganda: shu filialda ochiq smenasi bo'lsa davom etadi, bo'lmasa yangisi ochiladi. Kassirda bir vaqtda
   * bitta ochiq smena — boshqa filialda ochiq qolgan bo'lsa `shift_open_elsewhere` (`detail` — o'sha filial nomi):
   * avval o'sha yerda topshiradi (yoki admin yopadi), naqd pul hisobi aralashmasin. Filialda FaceID yoqilgan bo'lsa
   * (2026-11-04): yangi smena — terminalda «Kirish» (10 daqiqa ichida); ochiq smenani PIN bilan davom ettirish
   * ([pinLogin]) — kassir shu filialda (`faceid_checkin_required`). Ochiq kassaning o'zi (`POST /shifts/current` — har
   * sotuvdan oldin) tekshirilmaydi: kassir tushlikka «Chiqish» bosib ketsa ham sotuv to'xtamaydi, kassani PIN bilan
   * ochishda tekshiriladi.
   */
  async openOrResume(cashierId: string, branchId: string, now = new Date(), pinLogin = true): Promise<Shift> {
    const em = this.dataSource.manager;
    const open = await em.findOneBy(Shift, { cashierId, closedAt: IsNull() });
    if (open) {
      const shift = await this.inBranch(em, open, branchId);
      if (pinLogin) await this.faceId.assert('resume', cashierId, branchId, now);
      return shift;
    }
    await this.faceId.assert('open', cashierId, branchId, now);
    const shift: Shift = { id: newId('shf'), branchId, cashierId, openedAt: now, closedAt: null };
    try {
      await em.insert(Shift, shift);
      return shift;
    } catch (error) {
      // ikki tabdan (yoki ikki filialdan) bir vaqtda kirdi — boshqasi allaqachon ochgan (unique index)
      if ((error as { code?: string }).code !== '23505') throw error;
      const opened = (await em.findOneBy(Shift, { cashierId, closedAt: IsNull() })) ?? fail('shift_not_open');
      return this.inBranch(em, opened, branchId);
    }
  }

  /** Kassirning shu filialdagi ochiq smenasi (bo'lmasa `null`). */
  current(user: AuthUser): Promise<Shift | null> {
    if (!user.branchId) return Promise.resolve(null);
    return this.dataSource.manager.findOneBy(Shift, { cashierId: user.id, branchId: user.branchId, closedAt: IsNull() });
  }

  /**
   * "Smenani topshirish" — kassir o'z smenasini yopadi; hisobot uchun jami bilan qaytadi. Filialda FaceID yoqilgan
   * bo'lsa — terminalda «Chiqish» (10 daqiqa ichida, `faceid_checkout_required`). Admin yopishi (`close`) — tekshiruvsiz.
   */
  async closeOwn(user: AuthUser, now = new Date()): Promise<ShiftWithSummary> {
    const shift = (await this.current(user)) ?? fail('shift_not_open');
    await this.faceId.assert('close', user.id, shift.branchId, now);
    return this.close(shift.id, now, user);
  }

  /** Smenani yopish (admin — kassir yopmay ketgan smenani ham). Yopilgach — Telegram botga hisobot (`ShiftEvents`). */
  async close(shiftId: string, now = new Date(), closedBy: AuthUser | null = null): Promise<ShiftWithSummary> {
    const closed = await this.dataSource.transaction(async (em) => {
      const shift =
        (await em.findOne(Shift, { where: { id: shiftId }, lock: { mode: 'pessimistic_write' } })) ??
        fail('not_found', `shift ${shiftId}`);
      if (shift.closedAt !== null) fail('shift_not_open');
      shift.closedAt = now;
      await em.update(Shift, shift.id, { closedAt: now });
      return this.withSummary(em, shift);
    });
    this.events.closed({ shiftId: closed.id, closedBy });
    return closed;
  }

  /**
   * Smenalar: oraliq bilan **kesishganlari** (ochiq smena — hozirgacha davom etayotgan), ochiqlari tepada, keyin
   * eng yangisi; filtrlangan hammasi bo'yicha jami — soni, hozir ochiq, tushum va naqd.
   */
  async findAll(query: ShiftListQuery): Promise<Page<ShiftWithSummary> & { summary: ShiftsSummary }> {
    const { page, limit, skip } = pageParams(query);
    const em = this.dataSource.manager;
    const qb = em.createQueryBuilder(Shift, 's');
    if (query.branchId) qb.andWhere('s.branchId = :branchId', { branchId: query.branchId });
    if (query.cashierId) qb.andWhere('s.cashierId = :cashierId', { cashierId: query.cashierId });
    if (query.open !== undefined) qb.andWhere(query.open ? 's.closedAt IS NULL' : 's.closedAt IS NOT NULL');
    if (query.to) qb.andWhere('s.openedAt < :to', { to: query.to });
    if (query.from) qb.andWhere('(s.closedAt IS NULL OR s.closedAt >= :from)', { from: query.from });

    const [ids, shifts] = await Promise.all([
      qb.clone().select('s.id', 'id').addSelect('s.closedAt IS NULL', 'open').getRawMany<{ id: string; open: boolean }>(),
      qb
        .clone()
        .orderBy('CASE WHEN s.closedAt IS NULL THEN 0 ELSE 1 END', 'ASC')
        .addOrderBy('s.openedAt', 'DESC')
        .offset(skip)
        .limit(limit)
        .getMany(),
    ]);
    const all = ids.map((row) => row.id);
    const open = ids.filter((row) => row.open).length;
    const summaries = await shiftSummaries(em, all);
    let revenue = 0;
    let cash = 0;
    for (const summary of summaries.values()) {
      revenue += summary.total;
      cash += summary.byPayment.cash;
    }
    return {
      items: shifts.map((s) => ({ ...s, summary: summaries.get(s.id)! })),
      total: all.length,
      page,
      limit,
      summary: { count: all.length, open, revenue, cash },
    };
  }

  /** Smena, jami va buyurtmalari. Kassir faqat o'z smenasini ko'radi. */
  async findOne(id: string, user: AuthUser) {
    const em = this.dataSource.manager;
    const shift = (await em.findOneBy(Shift, { id })) ?? fail('not_found', `shift ${id}`);
    if (user.role !== 'admin' && shift.cashierId !== user.id) fail('forbidden');
    const orders = await em.find(Order, { where: { shiftId: id }, order: { createdAt: 'ASC' } });
    return { ...(await this.withSummary(em, shift)), orders: orders.map(orderView) };
  }

  /** Kassirning ochiq smenasi so'ralgan filialdami — boshqa filialda bo'lsa xato (shu filial nomi bilan). */
  private async inBranch(em: EntityManager, shift: Shift, branchId: string): Promise<Shift> {
    if (shift.branchId === branchId) return shift;
    const branch = await em.findOneBy(Branch, { id: shift.branchId });
    return fail('shift_open_elsewhere', branch?.name ?? shift.branchId);
  }

  private async withSummary(em: EntityManager, shift: Shift): Promise<ShiftWithSummary> {
    const summaries = await shiftSummaries(em, [shift.id]);
    return { ...shift, summary: summaries.get(shift.id)! };
  }
}
