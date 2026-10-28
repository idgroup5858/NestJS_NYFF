import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { Branch } from '../branches/branch.entity';
import { sha256 } from '../common/ids';
import { Revocations } from '../common/revocations';
import { showsOnTv } from '../domain/orders';
import { Order } from '../orders/order.entity';
import { courierOrderView, courierSignal, customerOrderView, orderView, tvOrderView } from '../orders/order.views';
import { PresenceService } from './presence.service';

/** Xonalar filial bo'yicha — bir filial voqeasi boshqasiga bormaydi. */
export const branchRoom = (branchId: string) => `branch:${branchId}`;
export const tvRoom = (branchId: string) => `tv:${branchId}`;
export const orderRoom = (orderId: string) => `order:${orderId}`;
/** Hamma kuryerlar (filialga bog'lanmagan) — yangi / olingan dostavka haqida belgi. */
export const COURIERS_ROOM = 'couriers';
export const courierRoom = (userId: string) => `courier:${userId}`;

/**
 * Socket.IO — faqat serverdan ekranlarga "o'zgardi" xabari (buyruqlar REST orqali). Ulanishda `auth` bilan:
 *  - `{ token }` — kassir / oshpaz yordamchisi → `branch:<id>` (kassir ulanganda filial "kassa ulangan" bo'ladi);
 *    kuryer → `couriers` (mobil dostavka o'zgardi — belgi) va `courier:<userId>` (o'z buyurtmalari to'liq);
 *  - `{ tvBranchId }` — TV (ochiq, kalitsiz) → `tv:<id>` (faqat raqam, tur va holat);
 *  - `{ orderId, orderToken }` — mobil ilova → `order:<id>` (o'z buyurtmasi).
 * Qayta ulanganda mijoz ro'yxatni REST'dan qaytadan oladi (uzilish paytidagi xabarlar yo'qolgan bo'lishi mumkin).
 */
@WebSocketGateway({ cors: { origin: true }, pingInterval: 10_000, pingTimeout: 10_000 })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('Realtime');

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly presence: PresenceService,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    revocations: Revocations,
  ) {
    revocations.onUser((userId) => this.disconnectWhere((socket) => socket.data.user?.id === userId));
  }

  async handleConnection(client: Socket) {
    const rooms = await this.authorize(client).catch(() => null);
    if (!rooms) {
      client.emit('auth_error', { code: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    await client.join(rooms);
    client.emit('ready', { rooms });
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user as AuthUser | undefined;
    if (user?.role === 'cashier' && user.branchId) this.presence.kassaDisconnected(user.branchId, client.id);
  }

  /** Buyurtma o'zgardi — tranzaksiya muvaffaqiyatli tugagandan keyin chaqiriladi. */
  orderChanged(order: Order, previousBranchId?: string | null) {
    const server = this.server;
    // seed / testlarda (HTTP server yo'q) socket ham yo'q
    if (!server) return;
    const staffRooms = [branchRoom(order.branchId)];
    if (previousBranchId && previousBranchId !== order.branchId) staffRooms.push(branchRoom(previousBranchId));
    server.to(staffRooms).emit('order', orderView(order));
    if (showsOnTv(order)) server.to(tvRoom(order.branchId)).emit('order', tvOrderView(order));
    if (order.source === 'mobile') server.to(orderRoom(order.id)).emit('order', customerOrderView(order));
    if (order.source === 'mobile' && order.type === 'delivery') {
      server.to(COURIERS_ROOM).emit('order', courierSignal(order));
      if (order.courierId) server.to(courierRoom(order.courierId)).emit('order', courierOrderView(order));
    }
  }

  /** Huquqi bekor bo'lgan ulanishlar: `auth_error` va uzish (kassir bo'lsa — "kassa ulangan" ham tushadi). */
  private disconnectWhere(match: (socket: Socket) => boolean) {
    for (const socket of this.server?.sockets.sockets.values() ?? []) {
      if (!match(socket)) continue;
      socket.emit('auth_error', { code: 'unauthorized' });
      socket.disconnect(true);
    }
  }

  private async authorize(client: Socket): Promise<string[] | null> {
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;

    if (typeof auth.token === 'string') {
      const user = await this.auth.verify(auth.token);
      if (user?.role === 'courier') {
        client.data.user = user;
        return [COURIERS_ROOM, courierRoom(user.id)];
      }
      if (!user?.branchId || (user.role !== 'cashier' && user.role !== 'kitchen')) return null;
      client.data.user = user;
      if (user.role === 'cashier') this.presence.kassaConnected(user.branchId, client.id);
      return [branchRoom(user.branchId)];
    }

    if (typeof auth.tvBranchId === 'string') {
      const branch = await this.branches.findOneBy({ id: auth.tvBranchId });
      return branch?.active ? [tvRoom(branch.id)] : null;
    }

    if (typeof auth.orderId === 'string' && typeof auth.orderToken === 'string') {
      const order = await this.orders
        .createQueryBuilder('o')
        .addSelect('o.trackingTokenHash')
        .where('o.id = :id', { id: auth.orderId })
        .getOne();
      return order?.trackingTokenHash && order.trackingTokenHash === sha256(auth.orderToken)
        ? [orderRoom(order.id)]
        : null;
    }

    this.logger.debug(`Kirish ma'lumotisiz ulanish: ${client.id}`);
    return null;
  }
}
