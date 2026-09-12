import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SplitBatch } from './split-batch.entity';
import { StatementRow } from './statement-row.entity';
import { Creator } from './creator.entity';

/**
 * 创作者收益明细（最小可复核颗粒）。
 * 一条 Allocation = 一张平台原始行 × 收入期间切片（按生效合同切出的天数段）
 *                  × 一位创作者。
 * 任意创作者明细都能沿 statementRowId 追到平台原始行。
 */
@Entity('allocations')
@Unique('uq_allocation', ['batchId', 'statementRowId', 'contractId', 'creatorId', 'sliceIndex'])
export class Allocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  batchId: string;

  @ManyToOne(() => SplitBatch, (b) => b.allocations, { onDelete: 'CASCADE' })
  batch: SplitBatch;

  @Index()
  @Column('uuid')
  statementRowId: string;

  @ManyToOne(() => StatementRow, (r) => r.allocations)
  statementRow: StatementRow;

  @Column('uuid')
  contractId: string;

  @Index()
  @Column('uuid')
  creatorId: string;

  @ManyToOne(() => Creator)
  creator: Creator;

  /** 一行跨多份合同时的切片序号（从 0 开始） */
  @Column('integer')
  sliceIndex: number;

  /** 切片归属期间 */
  @Column({ type: 'date' })
  sliceStart: string;

  @Column({ type: 'date' })
  sliceEnd: string;

  @Column('integer')
  sliceDays: number;

  /** 切片占整行期间的天数权重（整行一天时为 1/1） */
  @Column('integer')
  periodTotalDays: number;

  /** 该创作者在此合同中的基点份额快照 */
  @Column('integer')
  basisPoints: number;

  /** 创作者实得 CNY 分（整数） */
  @Column('bigint')
  amountCnyCents: string;

  /** 切片总额 CNY 分（同一切片所有创作者之和） */
  @Column('bigint')
  sliceCnyCents: string;

  /** 切片天数尾差：切片阶段最大余数法落在此切片上的分数 */
  @Column('bigint')
  sliceRemainderCents: string;

  /** 合同标签与作品快照，便于复核时不依赖联表 */
  @Column({ length: 100, default: '' })
  contractLabel: string;
}
