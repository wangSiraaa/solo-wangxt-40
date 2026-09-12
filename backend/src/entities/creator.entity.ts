import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ContractShare } from './contract-share.entity';

@Entity('creators')
export class Creator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  /** 结算收款账户（模拟，不接真实支付） */
  @Column({ length: 100, default: '' })
  payoutAccount: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => ContractShare, (s) => s.creator)
  shares: ContractShare[];
}
