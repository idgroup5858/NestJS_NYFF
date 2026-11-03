import type { EntityManager } from 'typeorm';
import { fail } from './errors';

/**
 * O'chirishdan oldin: yozuv hech qayerda ishlatilmaganmi. [checks] — `joy → SQL` (`$1` — id, `SELECT 1 … LIMIT 1`);
 * birinchi topilgan joy bilan `in_use` (tafsilotda — qayerda), hech biri bo'lmasa — o'tadi. Tekshiruvlar ketma-ket:
 * odatda birinchisidayoq topiladi.
 */
export async function assertUnused(em: EntityManager, id: string, checks: Record<string, string>): Promise<void> {
  for (const [place, sql] of Object.entries(checks)) {
    const rows: unknown[] = await em.query(sql, [id]);
    if (rows.length > 0) fail('in_use', place);
  }
}
