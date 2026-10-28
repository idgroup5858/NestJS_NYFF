import { Injectable } from '@nestjs/common';

/**
 * Kassa uzilgandan keyin filial shuncha vaqt "kassa ulangan" hisoblanadi — Wi-Fi bir lahza uzilsa online qabul
 * to'xtab qolmasin. Server qayta ishga tushganda ham shuncha kutiladi (kassalar o'zi qayta ulanadi).
 */
export const KASSA_GRACE_MS = 60_000;

/**
 * Qaysi filialda kassa ekrani hozir Socket.IO'ga ulangan (ROADMAP 2-bo'lim: filial online buyurtma olishi uchun
 * smena ochiq bo'lishi yetarli emas — kassa ekrani ham ochiq bo'lsin). Xotirada; bir nechta server bo'lsa — Redis.
 */
@Injectable()
export class PresenceService {
  private readonly startedAt = Date.now();
  private readonly sockets = new Map<string, Set<string>>();
  private readonly lastLeftAt = new Map<string, number>();

  kassaConnected(branchId: string, socketId: string): void {
    const set = this.sockets.get(branchId) ?? new Set<string>();
    set.add(socketId);
    this.sockets.set(branchId, set);
  }

  kassaDisconnected(branchId: string, socketId: string, now = Date.now()): void {
    const set = this.sockets.get(branchId);
    if (!set?.delete(socketId)) return;
    if (set.size === 0) this.lastLeftAt.set(branchId, now);
  }

  /** `.env` da `ONLINE_REQUIRE_KASSA=0` bo'lsa — tekshirilmaydi (frontend hali socket'ga ulanmagan paytda). */
  isKassaOnline(branchId: string, now = Date.now()): boolean {
    if (process.env.ONLINE_REQUIRE_KASSA === '0') return true;
    if ((this.sockets.get(branchId)?.size ?? 0) > 0) return true;
    if (now - this.startedAt < KASSA_GRACE_MS) return true;
    const left = this.lastLeftAt.get(branchId);
    return left !== undefined && now - left < KASSA_GRACE_MS;
  }
}
