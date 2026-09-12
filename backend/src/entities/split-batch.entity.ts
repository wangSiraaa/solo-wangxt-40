import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Allocation } from './allocation.entity';
import { Payment } from './payment.entity';

export type BatchStatus = 'precomputed' | 'confirmed' | 'voided';

/**
 * 分账批次：
 * 1. 创建并「试算」-> precomputed：明细已落库可复核，可作废重算，不产生任何付款；
 * 2. 「确认」-> confirmed：冻结快照，允许据此生成付款清单；
 * 3. 付款清单是独立的确认动作（Payment），与预计算分离。
 * 已确认/已作废批次的行不可再次进入新批次。
 */
@Entity('split_batches')
export class SplitBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  label: string;

  @Column({ type: 'varchar', length: 20, default: 'precomputed' })
  status: BatchStatus;

  @Column('bigint', { default: '0' })
  totalCnyCents: string;

  @Column('integer', { default: 0 })
  rowCount: number;

  /** 守恒校验：sum(每行换算 CNY 分) == totalCnyCents == sum(allocations) */
  @Column('boolean', { default: true })
  conservationVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ length: 255, default: '' })
  note: string;

  @OneToMany(() => Allocation, (a) => a.batch)
  allocations: Allocation[];

  @OneToMany(() => Payment, (p) => p.batch)
  payments: Payment[];
}
