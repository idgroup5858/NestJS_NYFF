/**
 * Yuk testi — `npm run load` (`-- --quick`, `-- --keep`, `-- --days=365`, `-- --per-day=1500`).
 *
 *  1. Vaqtinchalik `nyff_load` bazasi: demo ma'lumotnomalari + bir yillik tarix (kuniga ~1500 buyurtma).
 *  2. Server alohida jarayonda (`dist/main.js`) shu bazada: fon ishlari yoqiq; Telegram, AI va IP chegarasi o'chiq.
 *  3. "Yaqinda tayyor bo'lganlar" indeksi (`ReadyAtIndex`) — indekssiz va indeks bilan o'qish tezligi.
 *  4. Bosqichlar: oddiy cho'qqi (daqiqasiga ~6 buyurtma) → ×10 → … — sekinlashgan / xato bergan joyda to'xtaydi.
 *  5. To'g'rilik: raqamlar takrorlanmagani, ombor = harakatlar, retsept bo'yicha ayrilgani, smena summalari, holatlar.
 *  6. Hisobot — `test/load/results/<vaqt>.md` (+ `.json`, server logi), keyin baza o'chiriladi (`--keep` — qoladi).
 */
import './env';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { dbConnectionFromEnv } from '../../src/database/db-config';
import { ZONE_POINTS } from '../../src/demo/demo-data';
import { prepareDatabase } from './history';
import { DEMO_STAFF, Simulation, sleep, type LabelStats } from './sim';

const ROOT = resolve(__dirname, '..', '..');
const READY_INDEX = 'IDX_29a703c426fa520b773a9af928';
const WRITE_LABELS = [
  'POST /orders',
  'POST /kiosk/orders',
  'POST /mobile/orders',
  'POST /orders/:id/confirm',
  'POST /orders/:id/ready',
  'POST /orders/:id/cancel',
  'POST /courier/orders/:id/take',
  'POST /courier/depart',
  'POST /courier/orders/:id/deliver',
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};
const QUICK = flag('quick');
const DAYS = option('days', QUICK ? 10 : 365);
const PER_DAY = option('per-day', 1500);
const PORT = option('port', 3100);
const SCALE = QUICK ? 0.25 : 1;

/** Bosqichlar: tezlik — buyurtma / soniya (kuniga 1500 da tushlik cho'qqisi ≈ 0,1 / s). */
const PHASES = [
  { name: "Oddiy cho'qqi", rate: 0.1, seconds: 120 },
  { name: '×10', rate: 1, seconds: 90 },
  { name: '×30', rate: 3, seconds: 90 },
  { name: '×60', rate: 6, seconds: 90 },
  { name: '×100', rate: 10, seconds: 90 },
  { name: '×150', rate: 15, seconds: 90 },
].map((p) => ({ ...p, seconds: Math.max(20, Math.round(p.seconds * SCALE)) }));

/** Shu bosqichdan keyin to'xtash: kutilmagan xatolar > 2% yoki kassa buyurtmasi p95 > 3 s. */
const LIMIT_ERROR_SHARE = 0.02;
const LIMIT_WRITE_P95_MS = 3000;

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const resultsDir = join(__dirname, 'results');
mkdirSync(resultsDir, { recursive: true });
const log = (line: string) => console.log(line);

interface PhaseResult {
  name: string;
  rate: number;
  seconds: number;
  started: number;
  perMinute: number;
  requests: number;
  rps: number;
  unexpected: number;
  stats: Record<string, LabelStats>;
}

function db(database = dbConnectionFromEnv().database): Client {
  const c = dbConnectionFromEnv();
  return new Client({ host: c.host, port: c.port, user: c.user, password: c.password, database });
}

function totals(stats: Record<string, LabelStats>) {
  let requests = 0;
  let unexpected = 0;
  for (const s of Object.values(stats)) {
    requests += s.count + Object.values(s.expected).reduce((a, b) => a + b, 0);
    unexpected += Object.values(s.errors).reduce((a, b) => a + b, 0);
  }
  return { requests, unexpected };
}

async function startServer(logFile: string): Promise<ChildProcess> {
  const out = createWriteStream(logFile);
  const server = spawn(process.execPath, [join(ROOT, 'dist', 'main.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      // fon ishlari (mobil qabul muddati, zaxira nusxa) — haqiqiy serverdagidek yoqiq
      JOBS: '',
      THROTTLE: 'off',
      TELEGRAM: 'off',
      GEMINI_API_KEY: '',
      DEMO: '0',
      ONLINE_REQUIRE_KASSA: '0',
      UI_DIST: join(tmpdir(), 'nyff-load-no-ui'),
      IMAGES_DIR: join(tmpdir(), 'nyff-load-images'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.pipe(out);
  server.stderr!.pipe(out);
  let exited = false;
  server.on('exit', () => (exited = true));
  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error(`server to'xtadi — ${logFile}`);
    try {
      if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return server;
    } catch {
      // hali ko'tarilmagan
    }
    await sleep(500);
  }
  server.kill();
  throw new Error('server 60 s da javob bermadi');
}

const table = (header: string[], rows: (string | number)[][]) =>
  [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

async function main() {
  const started = Date.now();
  log(`Yuk testi: baza ${dbConnectionFromEnv().database}, tarix ${DAYS} kun × ${PER_DAY}, port ${PORT}${QUICK ? ' (qisqa)' : ''}`);
  await prepareDatabase({ days: DAYS, perDay: PER_DAY, log });

  const pg = db();
  await pg.connect();
  const size = (
    await pg.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db,
      (SELECT COUNT(*) FROM orders)::int AS orders, (SELECT COUNT(*) FROM stock_movements)::int AS movements`)
  ).rows[0] as { db: string; orders: number; movements: number };
  const products = (await pg.query(`SELECT id, price::int AS price, "unavailableBranchIds" FROM products WHERE active`)).rows;
  const branches = (await pg.query(`SELECT id FROM branches WHERE active ORDER BY "createdAt", name`)).rows.map(
    (row: { id: string }) => ({ id: row.id, zone: ZONE_POINTS[row.id] }),
  );

  const serverLog = join(resultsDir, `${stamp}-server.log`);
  log('Server ishga tushirilmoqda…');
  const server = await startServer(serverLog);
  const sim = new Simulation({ base: `http://localhost:${PORT}`, products, branches, ...DEMO_STAFF });
  const phases: PhaseResult[] = [];
  const indexCompare: { variant: string; stats: Record<string, LabelStats> }[] = [];
  let stoppedAt: string | null = null;
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  try {
    await sim.start();

    // ── indeks: oldin / keyin (bo'sh vaqtda, ketma-ket so'rovlar) ──
    for (const variant of ['indekssiz', 'indeks bilan']) {
      if (variant === 'indekssiz') await pg.query(`DROP INDEX IF EXISTS "${READY_INDEX}"`);
      else await pg.query(`CREATE INDEX IF NOT EXISTS "${READY_INDEX}" ON "orders" ("branchId", "readyAt")`);
      await pg.query('ANALYZE orders');
      sim.metrics.take();
      for (const probe of sim.probes()) {
        for (let i = 0; i < (QUICK ? 15 : 40); i++) await sim.api.request(probe.label, 'GET', probe.path, { token: probe.token });
      }
      const stats = sim.metrics.take();
      indexCompare.push({ variant, stats });
      log(`Indeks — ${variant}: ${sim.probes().map((p) => `${p.label} p50 ${stats[p.label]?.p50} ms`).join(', ')}`);
    }

    // ── bosqichlar ──
    const stockBefore = new Map(
      (await pg.query(`SELECT "warehouseId", "ingredientId", qty FROM stock`)).rows.map((r) => [
        `${r.warehouseId}|${r.ingredientId}`,
        Number(r.qty),
      ]),
    );
    const loadStart = new Date(Date.now() - 1000);
    sim.startAdmin();
    for (const phase of PHASES) {
      sim.metrics.take();
      log(`Bosqich «${phase.name}»: ${phase.rate} buyurtma/s, ${phase.seconds} s…`);
      const count = await sim.arrivals(phase.rate, phase.seconds * 1000);
      const stats = sim.metrics.take();
      const { requests, unexpected } = totals(stats);
      const result: PhaseResult = {
        ...phase,
        started: count,
        perMinute: Math.round((count / phase.seconds) * 60),
        requests,
        rps: Math.round((requests / phase.seconds) * 10) / 10,
        unexpected,
        stats,
      };
      phases.push(result);
      const write = stats['POST /orders'];
      log(
        `  ${count} buyurtma (${result.perMinute}/daqiqa), ${requests} so'rov (${result.rps}/s), kassa buyurtmasi p95 ${write?.p95 ?? '-'} ms, ` +
          `kutilmagan xato ${unexpected}, ishda ${sim.inFlight}`,
      );
      if (unexpected > requests * LIMIT_ERROR_SHARE || (write?.p95 ?? 0) > LIMIT_WRITE_P95_MS) {
        stoppedAt = phase.name;
        log(`  Chegara: «${phase.name}» — keyingi bosqichlar o'tkazilmaydi`);
        break;
      }
    }
    sim.stopAdmin();
    log('Ishdagi buyurtmalar va dostavkalar tugashi kutilmoqda…');
    await sim.drain(180_000);
    const drainStats = sim.metrics.take();

    // ── to'g'rilik ──
    const shifts = await sim.closeShifts();
    const orders = (
      await pg.query(
        `SELECT id, "branchId", number, status, total::bigint AS total, items, "cashierId", "deliveredAt",
           ("createdAt" AT TIME ZONE 'Asia/Tashkent')::date::text AS day
         FROM orders WHERE "createdAt" >= $1`,
        [loadStart],
      )
    ).rows;
    const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

    const duplicates = (
      await pg.query(`SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM orders
        GROUP BY "branchId", ("createdAt" AT TIME ZONE 'Asia/Tashkent')::date, number HAVING COUNT(*) > 1) d`)
    ).rows[0].n as number;
    check('Buyurtma raqami takrorlanmaydi (filial + kun)', duplicates === 0, `${duplicates} ta takror (butun baza)`);

    const counters = new Map(
      (await pg.query(`SELECT key, value FROM counters WHERE key LIKE 'order:%'`)).rows.map((r) => [r.key, Number(r.value)]),
    );
    const gaps: string[] = [];
    const byKey = new Map<string, number[]>();
    for (const o of orders) {
      const key = `order:${o.branchId}:${o.day}`;
      byKey.set(key, [...(byKey.get(key) ?? []), o.number]);
    }
    for (const [key, numbers] of byKey) {
      const sorted = numbers.sort((a, b) => a - b);
      const contiguous = sorted.every((n, i) => n === i + 1);
      if (!contiguous || counters.get(key) !== sorted.length) gaps.push(`${key}: ${sorted.length} ta, hisoblagich ${counters.get(key)}`);
    }
    check('Raqamlar 1 dan ketma-ket, hisoblagich = buyurtmalar soni', gaps.length === 0, gaps.join('; ') || `${byKey.size} ta filial-kun`);

    const recipes = new Map(
      (await pg.query(`SELECT id, recipe FROM products`)).rows.map((r) => [r.id, r.recipe as { ingredientId: string; qty: number }[]]),
    );
    const moved = new Map<string, Map<string, number>>();
    for (const m of (await pg.query(`SELECT "refId", "ingredientId", qty FROM stock_movements WHERE "createdAt" >= $1`, [loadStart])).rows) {
      const perOrder = moved.get(m.refId) ?? moved.set(m.refId, new Map()).get(m.refId)!;
      perOrder.set(m.ingredientId, (perOrder.get(m.ingredientId) ?? 0) + Number(m.qty));
    }
    let recipeMismatch = 0;
    for (const o of orders) {
      const expected = new Map<string, number>();
      if (o.status === 'preparing' || o.status === 'ready') {
        for (const item of o.items) {
          for (const line of recipes.get(item.productId) ?? []) {
            expected.set(line.ingredientId, (expected.get(line.ingredientId) ?? 0) - line.qty * item.qty);
          }
        }
      }
      const actual = moved.get(o.id) ?? new Map();
      const keys = new Set([...expected.keys(), ...actual.keys()]);
      if ([...keys].some((k) => (expected.get(k) ?? 0) !== (actual.get(k) ?? 0))) recipeMismatch++;
    }
    check('Har buyurtma ombordan retsept bo\'yicha ayrilgan (bekor — qaytgan)', recipeMismatch === 0, `${recipeMismatch} ta mos emas, ${orders.length} ta buyurtma`);

    const movedSum = new Map(
      (await pg.query(`SELECT "warehouseId", "ingredientId", SUM(qty)::bigint AS qty FROM stock_movements WHERE "createdAt" >= $1 GROUP BY 1, 2`, [loadStart])).rows.map(
        (r) => [`${r.warehouseId}|${r.ingredientId}`, Number(r.qty)],
      ),
    );
    let stockMismatch = 0;
    for (const r of (await pg.query(`SELECT "warehouseId", "ingredientId", qty FROM stock`)).rows) {
      const key = `${r.warehouseId}|${r.ingredientId}`;
      if (Number(r.qty) - (stockBefore.get(key) ?? 0) !== (movedSum.get(key) ?? 0)) stockMismatch++;
    }
    check('Ombor qoldig\'i o\'zgarishi = harakatlar yig\'indisi', stockMismatch === 0, `${stockMismatch} ta qator mos emas`);

    const dbById = new Map(orders.map((o) => [o.id, o]));
    let stateMismatch = 0;
    for (const e of sim.expectations.values()) {
      const o = dbById.get(e.id);
      if (
        !o ||
        o.status !== e.status ||
        Number(o.total) !== e.total ||
        (o.cashierId ?? null) !== e.cashierId ||
        (e.delivered && !o.deliveredAt)
      ) {
        stateMismatch++;
      }
    }
    check(
      'Holat, summa, kassir, yetkazilgan — simulyatsiya bilgani bilan bir xil',
      stateMismatch === 0 && orders.length === sim.expectations.size,
      `${stateMismatch} ta farq; bazada ${orders.length}, simulyatsiyada ${sim.expectations.size}, yaratilmagan ${sim.failures}`,
    );
    const stuck = orders.filter((o) => o.status === 'pending' || o.status === 'preparing').length;
    const undelivered = [...sim.expectations.values()].filter((e) => e.delivery && e.status === 'ready' && !e.delivered).length;
    check('Osilib qolgan buyurtma yo\'q (kutmoqda / tayyorlanmoqda)', stuck === 0, `${stuck} ta; yetkazilmagan dostavka ${undelivered}`);

    const shiftMismatch: string[] = [];
    for (const s of shifts) {
      const own = [...sim.expectations.values()].filter((e) => e.cashierId === s.cashierId && e.status === 'ready');
      const total = own.reduce((sum, e) => sum + e.total, 0);
      if (own.length !== s.orderCount || total !== s.total) shiftMismatch.push(`${s.cashierId}: ${s.orderCount}/${s.total} ≠ ${own.length}/${total}`);
    }
    check('Smena topshirishdagi soni va tushum = kassir olgan buyurtmalar', shiftMismatch.length === 0, shiftMismatch.join('; ') || `${shifts.length} ta smena`);

    const serverErrors = readFileSync(serverLog, 'utf8')
      .split('\n')
      .filter((line) => /\bERROR\b/.test(line));
    check('Server logida xato yo\'q', serverErrors.length === 0, serverErrors.slice(0, 3).join(' / ') || '0 ta');

    // ── hisobot ──
    const out: string[] = [];
    out.push(`# Yuk testi — ${new Date().toLocaleString('uz-UZ')}`, '');
    out.push(
      `Baza: ${size.db}, ${size.orders.toLocaleString('ru-RU')} buyurtma, ${size.movements.toLocaleString('ru-RU')} ombor harakati ` +
        `(tarix — ${DAYS} kun × ~${PER_DAY}). Server va simulyatsiya — bitta kompyuterda. Davomiyligi: ${Math.round((Date.now() - started) / 60000)} daqiqa.`,
      '',
    );
    out.push('## "Yaqinda tayyor bo\'lganlar" indeksi — oldin / keyin', '');
    out.push(
      table(
        ['So\'rov', 'indekssiz p50 / p95, ms', 'indeks bilan p50 / p95, ms'],
        sim.probes().map((p) => {
          const [a, b] = indexCompare.map((c) => c.stats[p.label]);
          return [p.label, `${a?.p50} / ${a?.p95}`, `${b?.p50} / ${b?.p95}`];
        }),
      ),
      '',
    );
    out.push('## Bosqichlar', '');
    out.push(
      table(
        ['Bosqich', 'Buyurtma / daqiqa', 'So\'rov / s', 'Kassa buyurtmasi p95', 'Yozish p95 (eng sekini)', 'O\'qish p95 (eng sekini)', 'Kutilmagan xato'],
        phases.map((p) => {
          const writes = WRITE_LABELS.map((l) => [l, p.stats[l]?.p95 ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
          const reads = Object.entries(p.stats)
            .filter(([l]) => l.startsWith('GET'))
            .sort((a, b) => b[1].p95 - a[1].p95)[0];
          return [
            p.name,
            p.perMinute,
            p.rps,
            `${p.stats['POST /orders']?.p95 ?? '-'} ms`,
            `${writes[1]} ms (${writes[0]})`,
            reads ? `${reads[1].p95} ms (${reads[0]})` : '-',
            p.unexpected,
          ];
        }),
      ),
      '',
    );
    if (stoppedAt) out.push(`To'xtatildi: «${stoppedAt}» bosqichida chegaraga yetdi (xato > 2% yoki kassa buyurtmasi p95 > 3 s).`, '');
    out.push("## To'g'rilik", '');
    out.push(table(['Tekshiruv', 'Natija', 'Tafsilot'], checks.map((c) => [c.name, c.ok ? '✓' : '✗', c.detail])), '');
    for (const p of phases) {
      out.push(`## «${p.name}» — so'rovlar (ms)`, '');
      out.push(
        table(
          ['So\'rov', 'soni', 'p50', 'p95', 'p99', 'max', 'kutilmagan xato', 'kutilgan (poyga)'],
          Object.entries(p.stats).map(([label, s]) => [
            label,
            s.count,
            s.p50,
            s.p95,
            s.p99,
            s.max,
            Object.entries(s.errors).map(([k, v]) => `${k}: ${v}`).join(', ') || '',
            Object.entries(s.expected).map(([k, v]) => `${k}: ${v}`).join(', ') || '',
          ]),
        ),
        '',
      );
    }
    const report = out.join('\n');
    writeFileSync(join(resultsDir, `${stamp}.md`), report);
    writeFileSync(join(resultsDir, `${stamp}.json`), JSON.stringify({ size, indexCompare, phases, drainStats, checks, stoppedAt }, null, 2));
    log('');
    log(report.split('\n## «')[0]);
    log(`Hisobot: ${join(resultsDir, `${stamp}.md`)}`);
  } finally {
    sim.close();
    server.kill();
    await pg.end();
    await sleep(1_000);
    if (!flag('keep')) {
      const admin = db('postgres');
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS "${dbConnectionFromEnv().database}" WITH (FORCE)`);
      await admin.end();
      log(`Baza o'chirildi: ${dbConnectionFromEnv().database}`);
    }
  }
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
