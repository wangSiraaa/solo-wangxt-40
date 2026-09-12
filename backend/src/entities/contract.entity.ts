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
import { Work } from './work.entity';
import { Creator } from './creator.entity';
import { ContractShare } from './contract-share.entity';

/**
 * 合同：某作品在 [effectiveFrom, effectiveTo] 归属期间内的分账规则。
 * 同一作品的合同区间不得重叠（导入核算时再做防御性校验）。
 * effectiveTo 为 null 表示开放式合同（至今有效）。
 */
@Entity('contracts')
@Unique('uq_contract_version', ['workId', 'effectiveFrom'])
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  workId: string;

  @ManyToOne(() => Work, { onDelete: 'CASCADE' })
  work: Work;

  @Column({ type: 'date' })
  effectiveFrom: string;

  @Column({ type: 'date', nullable: true })
  effectiveTo: string | null;

  @Column({ length: 100, default: '' })
  label: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => ContractShare, (s) => s.contract, { cascade: true })
  shares: ContractShare[];
}
