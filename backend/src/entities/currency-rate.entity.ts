import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * 汇率：1 单位外币 = rate CNY。
 * 按「收入归属期间结束日」取当时有效的汇率（periodEnd 落在 [effectiveFrom, effectiveTo]），
 * 绝不使用账单导入当天的汇率——和份额规则一致：一切以收入归属期间为准。
 */
@Entity('currency_rates')
@Unique('uq_currency_rate_period', ['currency', 'effectiveFrom'])
export class CurrencyRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 3 })
  currency: string;

  @Column({ type: 'date' })
  effectiveFrom: string;

  @Column({ type: 'date', nullable: true })
  effectiveTo: string | null;

  /** 1 外币折合多少 CNY，8 位小数 */
  @Column('numeric', { precision: 18, scale: 8 })
  rateToCny: string;
}
