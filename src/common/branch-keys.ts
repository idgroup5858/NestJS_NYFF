import { createHash, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { Setting } from '../database/setting.entity';
import { fail } from './errors';
import { newSecret } from './ids';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Filialning tashqi dasturi uchun kalit: `br_….<maxfiy qism>` — filial id'si va tasodifiy qism. Markaz o'zi yaratadi va
 * bazada saqlaydi (`settings`, `<prefix>:<filial>` → maxfiy qism; `.env` da emas); admin "Filiallar" da ko'radi,
 * nusxalaydi va kerak bo'lsa yangilaydi (eskisi darhol ishlamay qoladi). Filial id'sining o'zi kalit bo'la olmaydi —
 * u ochiq (TV, kiosk, mobil ilova, kirish ekrani). Turlari: offline kassa (`offline_key`), HR tizimi (`hr_key`) —
 * har biri alohida, birini yangilash boshqasiga tegmaydi.
 */
export abstract class BranchKeys {
  protected abstract readonly prefix: string;

  constructor(protected readonly dataSource: DataSource) {}

  /** `settings` jadvalidagi kalit. */
  setting(branchId: string): string {
    return `${this.prefix}:${branchId}`;
  }

  /** Filial kaliti; hali yo'q bo'lsa — yaratiladi. */
  async get(branchId: string): Promise<string> {
    await this.assertBranch(branchId);
    const stored = await this.dataSource.manager.findOneBy(Setting, { key: this.setting(branchId) });
    return stored ? `${branchId}.${stored.value}` : this.regenerate(branchId);
  }

  /** Yangi kalit — eskisi bilan dastur endi ulana olmaydi. */
  async regenerate(branchId: string): Promise<string> {
    await this.assertBranch(branchId);
    const secret = newSecret(24);
    await this.dataSource.manager.upsert(Setting, { key: this.setting(branchId), value: secret }, ['key']);
    return `${branchId}.${secret}`;
  }

  /** Kalit to'g'ri bo'lsa — uning filiali, aks holda `null` (taqqoslash vaqti kalitga bog'liq emas). */
  async verify(key: string): Promise<string | null> {
    const dot = key.indexOf('.');
    if (dot <= 0) return null;
    const branchId = key.slice(0, dot);
    const stored = await this.dataSource.manager.findOneBy(Setting, { key: this.setting(branchId) });
    if (!stored) return null;
    return timingSafeEqual(digest(stored.value), digest(key.slice(dot + 1))) ? branchId : null;
  }

  private async assertBranch(branchId: string): Promise<void> {
    if (!(await this.dataSource.manager.existsBy(Branch, { id: branchId }))) fail('not_found', `branch ${branchId}`);
  }
}
