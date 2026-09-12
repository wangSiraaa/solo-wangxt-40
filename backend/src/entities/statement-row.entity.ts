import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BillImport } from './bill-import.entity';
import { Allocation } from './allocation.entity';

export type RowStatus = 'ready' | 'pending_match' | 'pending_rate' | 'pending_contract';

/**
 * 平台账单原始行。一行在任何时刻都保留：平台名 + 平台行号，
 * 创作者的每一条收益明细都能反向追溯回这里。
 *
 * 金额双列保存：
 * - gross* 列：平台原币原值（原样留档，不动）
 * - *CnyCents 列：按归属期汇率换算后的 CNY 分整数（核算口径）
 */
@Entity('statement_rows')
@Unique('uq_platform_line', ['platform', 'platformLineId'])
export class StatementRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  billImportId: string;

  @ManyToOne(() => BillImport, (b) => b.rows, { onDelete: 'CASCADE' })
  billImport: BillImport;

  @Column({ length: 100 })
  platform: string;

  /** 平台账单中的行号/行 ID，幂等键 */
  @Column({ length: 100 })
  platformLineId: string;

  /** 平台给出的 ISRC；可能在作品库中不存在 -> pending_match */
  @Index()
  @Column({ length: 12 })
  isrc: string;

  @Column({ length: 200, default: '' })
  trackTitle: string;

  @Column({ length: 3 })
  currency: string;

  /** 原币金额（元，字符串原样留档，负向冲销即负数） */
  @Column('numeric', { precision: 18, scale: 4 })
  grossMajor: string;

  /** 收入归属期间（不是导入日期！份额/汇率均按此期间确定） */
  @Column({ type: 'date' })
  periodStart: string;

  @Column({ type: 'date' })
  periodEnd: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending_rate',
  })
  status: RowStatus;

  /** 解析出的作品；未匹配时为 null */
  @Column('uuid', { nullable: true })
  workId: string | null;

  /** 换算用汇率快照（8 位小数字符串），CNY 本币为 '1' */
  @Column('numeric', { precision: 18, scale: 8, nullable: true })
  rateSnapshot: string | null;

  /** 换算后 CNY 元，4 位小数中间颗粒 */
  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  grossCnyMajor: string | null;

  /** 核算口径：CNY 分整数（字符串） */
  @Column('bigint', { nullable: true })
  cnyCents: string | null;

  @Column({ length: 255, default: '' })
  statusNote: string;

  @CreateDateColumn()
  importedAt: Date;

  @OneToMany(() => Allocation, (a) => a.statementRow)
  allocations: Allocation[];
}
