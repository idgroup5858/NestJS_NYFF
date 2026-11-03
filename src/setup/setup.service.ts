import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hashPin } from '../auth/pin';
import { Warehouse } from '../branches/warehouse.entity';
import { newId } from '../common/ids';
import { User } from '../users/user.entity';

/** Yangi bazadagi birinchi admin — kirgach "Profil" da almashtiriladi (2026-11-02 qarori). */
export const FIRST_ADMIN = {
  name: 'Admin',
  surname: 'Adminov',
  email: 'admin@gmail.com',
  password: '123456789',
} as const;

export const CENTRAL_WAREHOUSE_NAME = 'Markaziy ombor';

/**
 * Yangi (bo'sh) baza: server ishga tushganda xodim bo'lmasa — bitta admin ([FIRST_ADMIN]), markaziy ombor bo'lmasa —
 * u ham. Qolgani (filiallar — o'z ombori bilan, menyu, xodimlar) admin panelda qo'lda kiritiladi. Ma'lumoti bor
 * bazaga tegilmaydi.
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Setup');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureBasics();
  }

  async ensureBasics(now = new Date()): Promise<void> {
    const created = await this.dataSource.transaction(async (em) => {
      // ikki jarayon bir vaqtda ishga tushsa ham bitta admin / bitta ombor
      await em.query(`LOCK TABLE users, warehouses IN SHARE ROW EXCLUSIVE MODE`);
      const result = { admin: false, warehouse: false };
      if ((await em.count(User)) === 0) {
        const { name, surname, email } = FIRST_ADMIN;
        await em.insert(User, {
          id: newId('usr'),
          name,
          surname,
          role: 'admin',
          branchId: null,
          email,
          pinHash: await hashPin(FIRST_ADMIN.password),
          active: true,
          createdAt: now,
        });
        result.admin = true;
      }
      if (!(await em.existsBy(Warehouse, { kind: 'central' }))) {
        await em.insert(Warehouse, { id: newId('wh'), name: CENTRAL_WAREHOUSE_NAME, kind: 'central', branchId: null });
        result.warehouse = true;
      }
      return result;
    });
    if (created.admin) {
      this.logger.log(
        `Yangi baza: admin yaratildi — ${FIRST_ADMIN.email} / ${FIRST_ADMIN.password} (kirgach «Profil» da almashtiring)`,
      );
    }
    if (created.warehouse) this.logger.log(`«${CENTRAL_WAREHOUSE_NAME}» yaratildi`);
  }
}
