import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import type { LatLng, WorkHours } from '../common/types';
import {
  branchOnlineState,
  routeDelivery,
  type BranchOnlineState,
  type DeliveryRoute,
} from '../domain/delivery';
import { isLatLng, roundLatLng } from '../domain/geo';
import { isValidWorkHours } from '../domain/work-hours';
import { PresenceService } from '../realtime/presence.service';
import { Branch } from './branch.entity';
import { SaveDeliveryDto, SaveBranchDto } from './branch.dto';
import { Warehouse } from './warehouse.entity';

export type BranchWithState = Branch & { onlineState: BranchOnlineState };

@Injectable()
export class BranchesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly presence: PresenceService,
  ) {}

  async findAll(now = new Date()): Promise<BranchWithState[]> {
    const branches = await this.dataSource.manager.find(Branch, { order: { createdAt: 'ASC', name: 'ASC' } });
    const states = await this.onlineStates(branches, now);
    return branches.map((branch) => ({ ...branch, onlineState: states.get(branch.id)! }));
  }

  async findOne(id: string, now = new Date()): Promise<BranchWithState> {
    const branch = await this.get(this.dataSource.manager, id);
    const states = await this.onlineStates([branch], now);
    return { ...branch, onlineState: states.get(branch.id)! };
  }

  /**
   * Yangi filial: o'z ombori ochiladi (qoldiq 0), menyudagi hamma taom darhol shu filialda ham sotuvda (narxlar
   * barcha filiallarda bir xil). Xaritadagi joyi va hududi keyin "Yetkazib berish" sahifasida chiziladi.
   */
  async create(dto: SaveBranchDto, now = new Date()): Promise<Branch> {
    const { workHours, ...fields } = this.cleanFields(dto);
    return this.dataSource.transaction(async (em) => {
      const branch: Branch = {
        id: newId('br'),
        ...fields,
        workHours: workHours ?? null,
        createdAt: now,
        location: null,
        deliveryZone: [],
        deliveryFee: 0,
        fallbackBranchId: null,
        onlineEnabled: true,
      };
      await em.insert(Branch, branch);
      await em.insert(Warehouse, { id: newId('wh'), name: fields.name, kind: 'branch', branchId: branch.id });
      return branch;
    });
  }

  /** Asosiy ma'lumotlar; `workHours` yuborilmasa — o'zgarmaydi, `null` — 24/7. */
  async update(id: string, dto: SaveBranchDto): Promise<Branch> {
    const fields = this.cleanFields(dto);
    const em = this.dataSource.manager;
    await this.get(em, id);
    await em.update(Branch, id, fields);
    return this.get(em, id);
  }

  /** Filialning yetkazib berish sozlamalari (admin xaritada saqlaydi). */
  async saveDelivery(id: string, dto: SaveDeliveryDto): Promise<Branch> {
    const em = this.dataSource.manager;
    const current = await this.get(em, id);
    if (dto.zone.length > 0 && dto.zone.length < 3) fail('zone_too_small');
    if (![...dto.zone, ...(dto.location ? [dto.location] : [])].every(isLatLng)) fail('invalid_location');
    if (!Number.isInteger(dto.fee) || dto.fee < 0) fail('invalid_amount');
    const fallback = dto.fallbackBranchId ? await this.get(em, dto.fallbackBranchId) : null;
    if (fallback?.id === current.id) fail('not_found', 'fallback branch is the branch itself');

    await em.update(Branch, id, {
      location: dto.location ? roundLatLng(dto.location) : null,
      deliveryZone: dto.zone.map(roundLatLng),
      deliveryFee: dto.fee,
      fallbackBranchId: fallback?.id ?? null,
      onlineEnabled: dto.onlineEnabled,
    });
    return this.get(em, id);
  }

  /** Online buyurtma qabul qilishni tezda to'xtatish / yoqish (masalan oshxona juda band). */
  async setOnline(id: string, enabled: boolean): Promise<Branch> {
    const em = this.dataSource.manager;
    await this.get(em, id);
    await em.update(Branch, id, { onlineEnabled: enabled });
    return this.get(em, id);
  }

  /**
   * Filiallar holati: faol, admin to'xtatmagan, ish vaqti ichida, smena ochiq va kassa ekrani ulangan
   * (`domain/delivery.ts`). Smenalar bitta so'rovda.
   */
  async onlineStates(
    branches: Branch[],
    now: Date,
    em: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, BranchOnlineState>> {
    const rows: { branchId: string }[] = await em.query(
      `SELECT DISTINCT "branchId" FROM shifts WHERE "closedAt" IS NULL AND "branchId" = ANY($1)`,
      [branches.map((b) => b.id)],
    );
    const withShift = new Set(rows.map((row) => row.branchId));
    return new Map(
      branches.map((branch) => [
        branch.id,
        branchOnlineState(
          branch,
          {
            hasOpenShift: withShift.has(branch.id),
            kassaOnline: this.presence.isKassaOnline(branch.id, now.getTime()),
          },
          now,
        ),
      ]),
    );
  }

  /** Filial hozir online buyurtma oladimi. */
  async isOpen(branch: Branch, now: Date, em?: EntityManager): Promise<boolean> {
    return (await this.onlineStates([branch], now, em)).get(branch.id) === 'open';
  }

  /**
   * Dostavka manzili bo'yicha filial (`routeDelivery`). [excludeBranchId] — yopiq deb hisoblanadi: buyurtma qabul
   * qilinmagan filialdan boshqasiga o'tkazishda.
   */
  async route(point: LatLng, now: Date, excludeBranchId?: string, em?: EntityManager): Promise<DeliveryRoute> {
    if (!isLatLng(point)) fail('invalid_location');
    const branches = await (em ?? this.dataSource.manager).find(Branch);
    const states = await this.onlineStates(branches, now, em);
    return routeDelivery(branches, (b) => b.id !== excludeBranchId && states.get(b.id) === 'open', point);
  }

  async get(em: EntityManager, id: string): Promise<Branch> {
    return (await em.findOneBy(Branch, { id })) ?? fail('not_found', `branch ${id}`);
  }

  private cleanFields(dto: SaveBranchDto): Pick<Branch, 'name' | 'address' | 'phone' | 'active'> & {
    workHours?: WorkHours | null;
  } {
    const name = dto.name.trim();
    if (!name) fail('name_required');
    const fields = { name, address: dto.address.trim(), phone: dto.phone.trim(), active: dto.active };
    if (dto.workHours === undefined) return fields;
    const workHours = dto.workHours ? { open: dto.workHours.open, close: dto.workHours.close } : null;
    if (workHours && !isValidWorkHours(workHours)) fail('invalid_input', 'workHours: open = close');
    return { ...fields, workHours };
  }
}
