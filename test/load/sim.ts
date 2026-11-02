/**
 * Yuk simulyatsiyasi: haqiqiy HTTP va Socket.IO mijozlari. Buyurtmalar ochiq oqimda (javobni kutmasdan, berilgan
 * tezlikda) keladi; har biri o'z hayot yo'lini o'taydi — kassa / kiosk / mobil → qabul → oshxonada "Tayyor" → kuryer.
 * Ekranlar (kassa, oshxona, TV, kuryer ilovasi) web ilovadagidek: `order` xabaridan 150 ms keyin ro'yxatni qayta so'raydi.
 */
import { io, type Socket } from 'socket.io-client';
import { EXTRA_COURIERS } from './history';

// ───────────────────────── o'lchov ─────────────────────────

export interface LabelStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** kutilmagan xatolar (tarmoq, 5xx, kutilmagan 4xx) — kod bo'yicha */
  errors: Record<string, number>;
  /** kutilgan xatolar (poyga: ikki kuryer bitta buyurtmani oladi va h.k.) */
  expected: Record<string, number>;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export class Metrics {
  private times = new Map<string, number[]>();
  private errors = new Map<string, Record<string, number>>();
  private expected = new Map<string, Record<string, number>>();

  record(label: string, ms: number, error?: { code: string; expected: boolean }) {
    if (!error || error.expected) (this.times.get(label) ?? this.times.set(label, []).get(label)!).push(ms);
    if (!error) return;
    const bucket = error.expected ? this.expected : this.errors;
    const codes = bucket.get(label) ?? bucket.set(label, {}).get(label)!;
    codes[error.code] = (codes[error.code] ?? 0) + 1;
  }

  /** Hozirgacha yig'ilgani va tozalash (bosqich oxirida). */
  take(): Record<string, LabelStats> {
    const labels = new Set([...this.times.keys(), ...this.errors.keys(), ...this.expected.keys()]);
    const result: Record<string, LabelStats> = {};
    for (const label of [...labels].sort()) {
      const sorted = [...(this.times.get(label) ?? [])].sort((a, b) => a - b);
      result[label] = {
        count: sorted.length + Object.values(this.errors.get(label) ?? {}).reduce((s, n) => s + n, 0),
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        p99: Math.round(percentile(sorted, 99)),
        max: Math.round(sorted.at(-1) ?? 0),
        errors: this.errors.get(label) ?? {},
        expected: this.expected.get(label) ?? {},
      };
    }
    this.times.clear();
    this.errors.clear();
    this.expected.clear();
    return result;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export class Api {
  constructor(
    readonly base: string,
    private readonly metrics: Metrics,
  ) {}

  /** [label] — o'lchov guruhi (`POST /orders/:id/ready`); [expected] — xato hisoblanmaydigan kodlar. */
  async request<T>(
    label: string,
    method: string,
    path: string,
    options: { token?: string; body?: unknown; expected?: string[] } = {},
  ): Promise<T> {
    const started = performance.now();
    let status = 0;
    let body: unknown = null;
    try {
      const response = await fetch(this.base + path, {
        method,
        headers: {
          ...(options.body !== undefined && { 'content-type': 'application/json' }),
          ...(options.token && { authorization: `Bearer ${options.token}` }),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      status = response.status;
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch (error) {
      this.metrics.record(label, performance.now() - started, { code: 'network', expected: false });
      throw new ApiError(0, (error as Error).message);
    }
    const ms = performance.now() - started;
    if (status >= 200 && status < 300) {
      this.metrics.record(label, ms);
      return body as T;
    }
    const code = (body as { code?: string } | null)?.code ?? `http_${status}`;
    this.metrics.record(label, ms, { code: `${status} ${code}`, expected: options.expected?.includes(code) ?? false });
    throw new ApiError(status, code);
  }
}

// ───────────────────────── yordamchilar ─────────────────────────

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const between = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/**
 * Ekran: Socket.IO ga ulanadi, `ready` / `order` xabaridan 150 ms keyin (web `useRealtime` dagidek) ro'yxatlarni
 * qayta so'raydi; so'rov ketayotganda yana xabar kelsa — tugagach yana bir marta (kesh kabi, ustma-ust emas).
 */
class Screen {
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private dirty = false;
  readonly socket: Socket;

  constructor(url: string, auth: Record<string, string>, private readonly refetch: () => Promise<unknown>[]) {
    this.socket = io(url, { auth, transports: ['websocket'], forceNew: true, reconnection: true });
    const refresh = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.run(), 150);
    };
    this.socket.on('ready', refresh);
    this.socket.on('order', refresh);
  }

  private async run(): Promise<void> {
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    this.inFlight = true;
    try {
      await Promise.allSettled(this.refetch());
    } finally {
      this.inFlight = false;
      if (this.dirty) {
        this.dirty = false;
        void this.run();
      }
    }
  }

  close() {
    clearTimeout(this.timer);
    this.socket.close();
  }
}

// ───────────────────────── simulyatsiya ─────────────────────────

interface Product {
  id: string;
  price: number;
  unavailableBranchIds: string[];
}

interface Staff {
  id: string;
  token: string;
}

interface BranchActors {
  id: string;
  zone: { lat: number; lng: number };
  cashiers: Staff[];
  kitchen: Staff;
}

/** Simulyatsiya bilgan narsa — keyin bazadagi bilan solishtiriladi. */
export interface Expectation {
  id: string;
  branchId: string;
  source: 'cashier' | 'kiosk' | 'mobile';
  total: number;
  /** pulini olgan kassir (smenasiga yoziladi); kartali kiosk — `null` */
  cashierId: string | null;
  status: 'ready' | 'cancelled';
  delivery: boolean;
  delivered: boolean;
  /** hayot yo'li tugadi (tayyor / bekor) */
  done: boolean;
}

export interface SimSetup {
  base: string;
  products: Product[];
  branches: { id: string; zone: { lat: number; lng: number } }[];
  staff: { cashiers: Record<string, { id: string; pin: string }[]>; kitchens: Record<string, { id: string; pin: string }> };
  couriers: { id: string; login: string; password: string }[];
  admin: { id: string; pin: string };
}

/** Demo xodimlari (PIN'lari `demo-data.ts` da) va yuk testi kuryerlari. */
export const DEMO_STAFF: Pick<SimSetup, 'staff' | 'couriers' | 'admin'> = {
  staff: {
    cashiers: {
      br_chilonzor: [
        { id: 'usr_cashier_c1', pin: '1234' },
        { id: 'usr_cashier_c2', pin: '4321' },
      ],
      br_yunusobod: [
        { id: 'usr_cashier_y1', pin: '1234' },
        { id: 'usr_cashier_y2', pin: '4321' },
      ],
    },
    kitchens: { br_chilonzor: { id: 'usr_kitchen_c1', pin: '1111' }, br_yunusobod: { id: 'usr_kitchen_y1', pin: '1111' } },
  },
  couriers: [
    { id: 'usr_courier_1', login: 'bobur', password: '222222' },
    { id: 'usr_courier_2', login: 'otabek', password: '333333' },
    ...EXTRA_COURIERS.map(({ id, login, password }) => ({ id, login, password })),
  ],
  admin: { id: 'usr_admin', pin: '0000' },
};

/** Kuryer: "Ishdaman", bir filialdan 3 tagacha oladi, hammasi tayyor bo'lsa yo'lga chiqadi va navbat bilan yetkazadi. */
class CourierActor {
  private stopped = false;
  private screen: Screen | null = null;
  private wake: (() => void) | null = null;
  done: Promise<void> = Promise.resolve();

  constructor(
    private readonly sim: Simulation,
    readonly id: string,
    readonly token: string,
  ) {}

  start(url: string) {
    // kuryer ilovasi: dostavka o'zgardi (belgi) — "Yangi" ro'yxatini qayta so'raydi
    this.screen = new Screen(url, { token: this.token }, () => [this.available().then(() => this.wake?.())]);
    this.done = this.loop();
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  close() {
    this.screen?.close();
  }

  private available() {
    return this.sim.api.request<{ id: string; blocked: string | null; status: string; branchId: string }[]>(
      'GET /courier/orders/available',
      'GET',
      '/courier/orders/available',
      { token: this.token },
    );
  }

  private async loop(): Promise<void> {
    const expected = ['already_taken', 'other_branch', 'courier_busy', 'invalid_status', 'not_ready', 'empty_order'];
    let firstTakenAt = 0;
    while (true) {
      try {
        const mine = await this.sim.api.request<{ active: { id: string; status: string; departedAt: string | null; courierSeq: number | null }[] }>(
          'GET /courier/orders',
          'GET',
          '/courier/orders',
          { token: this.token },
        );
        const active = mine.active;
        if (this.stopped && active.length === 0 && !this.sim.hasUndelivered()) return;
        const allReady = active.length > 0 && active.every((o) => o.status === 'ready');
        // 3 ta yig'ildi yoki birinchisini olganiga 8 s o'tdi — yo'lga
        if (allReady && (active.length >= 3 || Date.now() - firstTakenAt > 8_000 || this.stopped)) {
          const route = await this.sim.api.request<{ active: { id: string; courierSeq: number | null }[] }>(
            'POST /courier/depart',
            'POST',
            '/courier/depart',
            { token: this.token, expected },
          );
          const stops = [...route.active].sort((a, b) => (a.courierSeq ?? 0) - (b.courierSeq ?? 0));
          for (const stop of stops) {
            await sleep(between(2_000, 5_000));
            await this.sim.api.request('POST /courier/orders/:id/deliver', 'POST', `/courier/orders/${stop.id}/deliver`, {
              token: this.token,
              expected,
            });
            this.sim.markDelivered(stop.id);
          }
          firstTakenAt = 0;
          continue;
        }
        if (active.length < 3) {
          const free = (await this.available()).filter((o) => o.blocked === null);
          for (const order of free.slice(0, 3 - active.length)) {
            try {
              await this.sim.api.request('POST /courier/orders/:id/take', 'POST', `/courier/orders/${order.id}/take`, {
                token: this.token,
                expected,
              });
              if (!firstTakenAt) firstTakenAt = Date.now();
            } catch {
              // boshqa kuryer oldin oldi — keyingisi
            }
          }
        }
      } catch {
        // kutilmagan xato o'lchovda — kuryer davom etadi
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, between(2_000, 4_000));
        this.wake = () => (clearTimeout(timer), resolve());
      });
      this.wake = null;
    }
  }
}

export class Simulation {
  readonly metrics = new Metrics();
  readonly api: Api;
  readonly expectations = new Map<string, Expectation>();
  private branches: BranchActors[] = [];
  private couriers: CourierActor[] = [];
  private screens: Screen[] = [];
  private admin: Staff = { id: '', token: '' };
  private running = new Set<Promise<void>>();
  private adminTimers: NodeJS.Timeout[] = [];
  /** to'liq hayot yo'li xatoga uchragan buyurtmalar (masalan yaratilmadi) */
  failures = 0;

  constructor(private readonly setup: SimSetup) {
    this.api = new Api(`${setup.base}/api`, this.metrics);
  }

  /** Kirish (smenalar ochiladi), "Ishdaman", ekranlar socket'ga ulanadi. */
  async start(): Promise<void> {
    const login = async (id: string, pin: string) =>
      (await this.api.request<{ token: string }>('POST /auth/login', 'POST', '/auth/login', { body: { userId: id, pin } })).token;
    this.admin = { id: this.setup.admin.id, token: await login(this.setup.admin.id, this.setup.admin.pin) };
    for (const branch of this.setup.branches) {
      const cashiers: Staff[] = [];
      for (const c of this.setup.staff.cashiers[branch.id]) cashiers.push({ id: c.id, token: await login(c.id, c.pin) });
      const k = this.setup.staff.kitchens[branch.id];
      this.branches.push({ id: branch.id, zone: branch.zone, cashiers, kitchen: { id: k.id, token: await login(k.id, k.pin) } });
    }
    for (const c of this.setup.couriers) {
      const { token } = await this.api.request<{ token: string }>('POST /auth/courier-login', 'POST', '/auth/courier-login', {
        body: { login: c.login, password: c.password },
      });
      await this.api.request('PUT /courier/duty', 'PUT', '/courier/duty', { token, body: { onDuty: true } });
      this.couriers.push(new CourierActor(this, c.id, token));
    }

    const url = this.setup.base;
    const get = (label: string, path: string, token?: string) => this.api.request(label, 'GET', path, { token });
    for (const b of this.branches) {
      // kassa: ishdagi buyurtmalar, "Dostavka" va smena (KassaPage); oshxona: ishdagilar; TV: navbat
      for (const c of b.cashiers) {
        this.screens.push(
          new Screen(url, { token: c.token }, () => [
            get('GET /orders/active', '/orders/active', c.token),
            get('GET /orders/delivery', '/orders/delivery', c.token),
            get('GET /shifts/current', '/shifts/current', c.token),
          ]),
        );
      }
      this.screens.push(new Screen(url, { token: b.kitchen.token }, () => [get('GET /orders/active', '/orders/active', b.kitchen.token)]));
      this.screens.push(new Screen(url, { tvBranchId: b.id }, () => [get('GET /tv/queue', `/tv/queue?branchId=${b.id}`)]));
    }
    for (const courier of this.couriers) courier.start(url);
    await sleep(1_000);
  }

  /** Admin paneli ochiq: bosh sahifa, bugungi buyurtmalar, ochiq smenalar, oylik hisobot. */
  startAdmin() {
    const token = this.admin.token;
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const every = (ms: number, work: () => Promise<unknown>) => {
      const run = () => void work().catch(() => undefined);
      run();
      this.adminTimers.push(setInterval(run, ms));
    };
    every(15_000, () => this.api.request('GET /reports/overview', 'GET', '/reports/overview', { token }));
    every(15_000, () => this.api.request('GET /orders (admin)', 'GET', `/orders?from=${encodeURIComponent(dayStart)}&limit=50`, { token }));
    every(30_000, () => this.api.request('GET /shifts?open=true', 'GET', '/shifts?open=true', { token }));
    every(60_000, () => this.api.request('GET /reports/sales (oy)', 'GET', `/reports/sales?from=${monthStart}&to=${today}`, { token }));
  }

  stopAdmin() {
    for (const timer of this.adminTimers) clearInterval(timer);
    this.adminTimers = [];
  }

  /** [rate] buyurtma / soniya tezlikda (Puasson oqimi) [ms] davomida; natija — boshlangan buyurtmalar soni. */
  async arrivals(rate: number, ms: number): Promise<number> {
    const end = Date.now() + ms;
    let started = 0;
    while (Date.now() < end) {
      const wait = -Math.log(1 - Math.random()) * (1000 / rate);
      await sleep(Math.min(wait, Math.max(0, end - Date.now())));
      if (Date.now() >= end) break;
      started++;
      const task = this.lifecycle().catch(() => {
        this.failures++;
      });
      this.running.add(task);
      void task.finally(() => this.running.delete(task));
    }
    return started;
  }

  /** Yangi buyurtmalar to'xtagach: boshlanganlari va dostavkalar tugashini kutadi. */
  async drain(timeoutMs: number): Promise<void> {
    const end = Date.now() + timeoutMs;
    while ((this.running.size > 0 || this.hasUndelivered()) && Date.now() < end) await sleep(500);
    for (const courier of this.couriers) courier.stop();
    await Promise.race([Promise.all(this.couriers.map((c) => c.done)), sleep(Math.max(1_000, end - Date.now()))]);
  }

  /** Kassirlar smenani topshiradi — `summary` (soni, tushum) simulyatsiya bilgani bilan solishtiriladi. */
  async closeShifts(): Promise<{ cashierId: string; orderCount: number; total: number }[]> {
    const result = [];
    for (const b of this.branches) {
      for (const c of b.cashiers) {
        const closed = await this.api.request<{ summary: { orderCount: number; total: number } }>(
          'POST /shifts/current/close',
          'POST',
          '/shifts/current/close',
          { token: c.token },
        );
        result.push({ cashierId: c.id, ...closed.summary });
      }
    }
    return result;
  }

  close() {
    this.stopAdmin();
    for (const screen of this.screens) screen.close();
    for (const courier of this.couriers) {
      courier.stop();
      courier.close();
    }
  }

  hasUndelivered(): boolean {
    for (const e of this.expectations.values()) if (e.delivery && e.status === 'ready' && !e.delivered) return true;
    return false;
  }

  markDelivered(id: string) {
    const e = this.expectations.get(id);
    if (e) e.delivered = true;
  }

  get inFlight(): number {
    return this.running.size;
  }

  /** Tarixga bog'liq o'qishlar — indeks "oldin / keyin" taqqoslash uchun (birinchi filial, birinchi kuryer). */
  probes(): { label: string; path: string; token?: string }[] {
    const b = this.branches[0];
    const courier = this.couriers[0];
    return [
      { label: 'GET /tv/queue', path: `/tv/queue?branchId=${b.id}` },
      { label: 'GET /orders/ready', path: '/orders/ready', token: b.kitchen.token },
      { label: 'GET /orders/active', path: '/orders/active', token: b.cashiers[0].token },
      { label: 'GET /orders/delivery', path: '/orders/delivery', token: b.cashiers[0].token },
      { label: 'GET /courier/orders', path: '/courier/orders', token: courier.token },
      { label: 'GET /courier/orders/available', path: '/courier/orders/available', token: courier.token },
      { label: 'GET /reports/overview', path: '/reports/overview', token: this.admin.token },
    ];
  }

  // ───────────────────────── buyurtma hayot yo'li ─────────────────────────

  private items(branchId: string) {
    const sold = this.setup.products.filter((p) => !p.unavailableBranchIds.includes(branchId) && p.price > 0);
    const lines = new Map<string, number>();
    for (let i = 0, n = 1 + Math.floor(Math.random() * 4); i < n; i++) {
      const product = pick(sold);
      lines.set(product.id, (lines.get(product.id) ?? 0) + (Math.random() < 0.8 ? 1 : 2));
    }
    const items = [...lines].map(([productId, qty]) => ({ productId, qty }));
    const total = items.reduce((sum, line) => sum + sold.find((p) => p.id === line.productId)!.price * line.qty, 0);
    return { items, total };
  }

  private branch(): BranchActors {
    return Math.random() < 0.55 ? this.branches[0] : this.branches[this.branches.length - 1];
  }

  private track(order: { id: string; total: number; branchId: string }, e: Omit<Expectation, 'id' | 'branchId' | 'done' | 'delivered'>, total: number) {
    if (order.total !== total) throw new Error(`summa ${order.id}: ${order.total} ≠ ${total}`);
    const expectation: Expectation = { ...e, id: order.id, branchId: order.branchId, done: false, delivered: false };
    this.expectations.set(order.id, expectation);
    return expectation;
  }

  private async lifecycle(): Promise<void> {
    const roll = Math.random();
    if (roll < 0.6) return this.cashierOrder();
    if (roll < 0.8) return this.kioskOrder();
    return this.mobileOrder();
  }

  private async cashierOrder() {
    const b = this.branch();
    const cashier = pick(b.cashiers);
    const { items, total } = this.items(b.id);
    const order = await this.api.request<{ id: string; total: number; branchId: string }>('POST /orders', 'POST', '/orders', {
      token: cashier.token,
      body: { type: pick(['dine_in', 'takeaway']), items, payment: pick(['cash', 'cash', 'cash', 'card', 'card', 'click']) },
    });
    const e = this.track(order, { source: 'cashier', total, cashierId: cashier.id, status: 'ready', delivery: false }, total);
    if (Math.random() < 0.02) {
      await sleep(between(2_000, 5_000));
      await this.api.request('POST /orders/:id/cancel', 'POST', `/orders/${order.id}/cancel`, { token: cashier.token });
      e.status = 'cancelled';
      e.done = true;
      return;
    }
    await this.kitchenReady(b, e);
  }

  private async kioskOrder() {
    const b = this.branch();
    const { items, total } = this.items(b.id);
    const paid = Math.random() < 0.5;
    const order = await this.api.request<{ id: string; total: number; branchId: string }>('POST /kiosk/orders', 'POST', '/kiosk/orders', {
      body: { branchId: b.id, type: pick(['dine_in', 'takeaway']), items, payment: paid ? pick(['card', 'click']) : null },
    });
    const e = this.track(order, { source: 'kiosk', total, cashierId: null, status: 'ready', delivery: false }, total);
    if (!paid) {
      // mijoz kassaga borib to'laydi
      await sleep(between(2_000, 6_000));
      const cashier = pick(b.cashiers);
      await this.api.request('POST /orders/:id/confirm', 'POST', `/orders/${order.id}/confirm`, {
        token: cashier.token,
        body: { payment: 'cash' },
      });
      e.cashierId = cashier.id;
    }
    await this.kitchenReady(b, e);
  }

  private async mobileOrder() {
    const b = this.branch();
    const { items, total } = this.items(b.id);
    const delivery = Math.random() < 0.75;
    const online = {
      platform: pick(['android', 'ios']),
      name: 'Yuk testi',
      phone: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
      address: delivery ? "Toshkent, 7-uy, 3-xonadon" : undefined,
      payment: pick(['cash', 'click']),
      location: delivery ? { lat: b.zone.lat + between(-0.001, 0.001), lng: b.zone.lng + between(-0.001, 0.001) } : undefined,
    };
    const placed = await this.api.request<{ order: { id: string; total: number; branchId: string }; trackingToken: string }>(
      'POST /mobile/orders',
      'POST',
      '/mobile/orders',
      { body: delivery ? { type: 'delivery', items, online } : { type: 'takeaway', branchId: b.id, items, online } },
    );
    const { order, trackingToken } = placed;
    const e = this.track(order, { source: 'mobile', total, cashierId: null, status: 'ready', delivery }, total);
    const routed = this.branches.find((x) => x.id === order.branchId)!;
    const trackOrder = () =>
      this.api.request('GET /mobile/orders/:id', 'GET', `/mobile/orders/${order.id}?token=${encodeURIComponent(trackingToken)}`);
    await sleep(1_000);
    await trackOrder();
    // kassir "Qabul qilish"
    await sleep(between(1_000, 7_000));
    const cashier = pick(routed.cashiers);
    await this.api.request('POST /orders/:id/confirm', 'POST', `/orders/${order.id}/confirm`, { token: cashier.token, body: {} });
    e.cashierId = cashier.id;
    await this.kitchenReady(routed, e);
    await trackOrder();
  }

  /** Oshxona: 8–25 s da "Tayyor" (haqiqatda 5–15 daqiqa — yuk vaqtida qisqartirilgan). */
  private async kitchenReady(b: BranchActors, e: Expectation) {
    await sleep(between(8_000, 25_000));
    await this.api.request('POST /orders/:id/ready', 'POST', `/orders/${e.id}/ready`, { token: b.kitchen.token });
    e.done = true;
  }
}
