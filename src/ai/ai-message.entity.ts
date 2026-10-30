import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';
import { User } from '../users/user.entity';

export type AiRole = 'user' | 'model';

/** AI suhbati xabari: savol (`user`) va javob (`model`) juft-juft yoziladi; tool chaqiruvlari saqlanmaydi. */
@Entity('ai_messages')
@Index(['userId', 'chat', 'createdAt'])
export class AiMessage {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** suhbat: `web` — admin paneldagi chat, `tg:<chatId>` — Telegram chati */
  @Column({ type: 'varchar', length: 48 })
  chat: string;

  @Column({ type: 'varchar', length: 8 })
  role: AiRole;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
