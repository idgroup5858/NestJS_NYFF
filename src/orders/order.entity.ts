import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type {
  CancelReason,
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  ReturnReason,
} from '../common/enums';
import type { OnlineInfo, OrderItem, PaymentSplit } from '../common/types';

@Entity('orders')
@Index(['branchId', 'status'])
@Index(['branchId', 'createdAt'])
// "yaqinda tayyor bo'lganlar" (TV, oshxona, kassa): yakunlangan buyurtma `ready` da qoladi — `(branchId, status)`
// filialning butun tarixini qaytarardi
@Index(['branchId', 'readyAt'])
// kuryerning qo'lidagilari (`deliveredAt IS NULL`) va bugun yetkazgan / qaytarganlari — kuryer tarixi o'sgani sari
// sekinlashmasin (faqat `courierId` indeksida butun tarixi o'qilardi); admin `?courierId=` ham shu indeksdan
@Index(['courierId', 'deliveredAt'])
@Index(['courierId', 'returnedAt'])
@Index(['createdAt'])
export class Order {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  /** filialda har kuni 1 dan boshlanadigan raqam — TV va chekda shu ko'rinadi */
  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: 10 })
  type: OrderType;

  @Column({ type: 'varchar', length: 10 })
  source: OrderSource;

  /** sotilgan paytdagi nom va narx (o'zgarmas surat) — doim buyurtma bilan birga o'qiladi */
  @Column({ type: 'jsonb' })
  items: OrderItem[];

  /** butun buyurtmaga izoh */
  @Column({ type: 'text', default: '' })
  note: string;

  @Column('bigint', { transformer: bigintNumber })
  total: number;

  /** to'lov turi; aralashda — eng katta qism. Kassada to'lanmagan kiosk va qabul qilinmagan mobil buyurtmada `null` */
  @Column({ type: 'varchar', length: 10, nullable: true })
  payment: PaymentMethod | null;

  /** faqat aralash to'lovda: tur bo'yicha summalar */
  @Column({ type: 'jsonb', nullable: true })
  split: PaymentSplit | null;

  /** faqat mobil ilovadan kelganda */
  @Column({ type: 'jsonb', nullable: true })
  online: OnlineInfo | null;

  @Column({ type: 'varchar', length: 10 })
  status: OrderStatus;

  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  cashierId: string | null;

  @Index()
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  shiftId: string | null;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  /** to'langan / qabul qilingan va oshxonaga ketgan vaqt */
  @Column({ type: 'timestamptz', nullable: true })
  preparingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  /** bekor qilgan xodim; server o'zi bekor qilganda `null` va [cancelReason] bor */
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  cancelledBy: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  cancelReason: CancelReason | null;

  // ── mobil buyurtma: qabul muddati va boshqa filialga o'tkazish (ROADMAP 2-bo'lim) ──

  /** shu filialga tushgan vaqt (yaratilgan yoki o'tkazilgan) — 5 daqiqalik qabul muddati shundan hisoblanadi */
  @Column({ type: 'timestamptz' })
  routedAt: Date;

  /** necha marta boshqa filialga o'tkazilgan (ko'pi bilan 1) */
  @Column({ type: 'int', default: 0 })
  transferCount: number;

  /** o'tkazilgan bo'lsa — oldingi filial */
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  fromBranchId: string | null;

  /** mobil ilova holatni shu token bilan kuzatadi; bazada tokenning o'zi emas, sha256 xeshi */
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  trackingTokenHash: string | null;

  /**
   * Mobil dostavka: buyurtma berilgandagi hudud narxi (mijozga ko'rsatilgani; summaga kirmaydi, kuryerga naqd).
   * `null` — hududdan tashqarida (narxni kuryer aytadi) yoki dostavka emas.
   */
  @Column('bigint', { nullable: true, transformer: bigintNumber })
  deliveryFee: number | null;

  /**
   * Internet yo'q paytda offline kassada yaratilib, keyin yuborilgan buyurtma — markazga yetib kelgan vaqti
   * (`/sync/orders`). Oddiy buyurtmada `null`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  syncedAt: Date | null;

  // ── kuryer (mobil dostavka). `status` o'zgarmaydi (oxirgisi `ready`) — kuryer bosqichlari alohida maydonlarda ──

  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  courierId: string | null;

  /** kuryer "Olaman" bosdi */
  @Column({ type: 'timestamptz', nullable: true })
  takenAt: Date | null;

  /** "Yo'lga chiqdim" — mijozga "Kuryer yo'lda" */
  @Column({ type: 'timestamptz', nullable: true })
  departedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  /** "Yetkazib bo'lmadi" — buyurtma filialga qaytadi */
  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  returnReason: ReturnReason | null;

  @Column({ type: 'text', default: '' })
  returnNote: string;

  /** kuryer yo'lidagi navbati (1, 2, …) — server taklif qilgan tartib; yo'lga chiqqanda va har yetkazishda qayta */
  @Column({ type: 'int', nullable: true })
  courierSeq: number | null;

  /** oldingi nuqtadan (filial yoki oldingi mijoz) shu manzilgacha, km — to'g'ri chiziq bo'yicha */
  @Column({ type: 'double precision', nullable: true })
  courierLegKm: number | null;
}

/** Yangi buyurtmada dostavka narxi va kuryer maydonlari (kuryer hali yo'q). */
export const NO_COURIER = {
  deliveryFee: null,
  courierId: null,
  takenAt: null,
  departedAt: null,
  deliveredAt: null,
  returnedAt: null,
  returnReason: null,
  returnNote: '',
  courierSeq: null,
  courierLegKm: null,
} satisfies Partial<Order>;
