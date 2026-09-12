import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SplitBatch } from './split-batch.entity';
import { Creator } from './creator.entity';

export type PaymentStatus = 'pending_payout' | 'paid';

/**
 * 付款清单：批次「确认」之后按创作者汇总生成，与预计算分开。
 * 只做模拟结算（markPaid），不接任何真实支付通道。
 */
@Entity('payments')
@Unique('uq_payment_batch_creator', ['batchId', 'creatorId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  batchId: string;

  @ManyToOne(() => SplitBatch, (b) => b.payments, { onDelete: 'CASCADE' })
  batch: SplitBatch;

  @Index()
  @Column('uuid')
  creatorId: string;

  @ManyToOne(() => Creator)
  creator: Creator;

  @Column('bigint')
  amountCnyCents: string;

  @Column({ type: 'varchar', length: 20, default: 'pending_payout' })
  status: PaymentStatus;

  @Column({ length: 100, default: '' })
  payoutAccount: string;

  /** 模拟结算时间 */
  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
