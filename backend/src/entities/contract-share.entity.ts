import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Contract } from './contract.entity';
import { Creator } from './creator.entity';

/**
 * 合同份额。basisPoints 为基点（万分之一），同一合同所有份额之和必须 = 10000。
 * 用整数基点 + decimal.js 运算，杜绝浮点误差。
 */
@Entity('contract_shares')
@Unique('uq_share_contract_creator', ['contractId', 'creatorId'])
export class ContractShare {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  contractId: string;

  @ManyToOne(() => Contract, (c) => c.shares, { onDelete: 'CASCADE' })
  contract: Contract;

  @Column('uuid')
  creatorId: string;

  @ManyToOne(() => Creator, (c) => c.shares, { eager: true })
  creator: Creator;

  /** 基点份额，如 6000 = 60% */
  @Column('integer')
  basisPoints: number;
}
