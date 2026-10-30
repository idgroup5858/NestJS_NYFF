import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';
import { User } from '../users/user.entity';

/** Start link orqali ulangan Telegram chati — shu xodim nomidan AI'dan foydalanadi. */
@Entity('telegram_chats')
export class TelegramChat {
  /** Telegram chat id (shaxsiy chatda — foydalanuvchining Telegram id'si) */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  chatId: string;

  @Index()
  @Column({ type: 'varchar', length: ID_LENGTH })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** Telegram'dagi `@username` (bo'lmasligi mumkin) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  /** Telegram'dagi ism-familiya */
  @Column({ type: 'varchar', length: 128, default: '' })
  name: string;

  @Column({ type: 'timestamptz' })
  linkedAt: Date;
}
