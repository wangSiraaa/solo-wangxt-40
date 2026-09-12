import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StatementRow } from './statement-row.entity';

/**
 * 平台账单导入批次（一个上传的 CSV 文件）。
 */
@Entity('bill_imports')
export class BillImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  platform: string;

  @Column({ length: 255 })
  fileName: string;

  /** 该文件内容的 SHA-256，用于重复导入检测（同文件重复上传整体拦截） */
  @Column({ length: 64, unique: true })
  fileHash: string;

  @Column('integer', { default: 0 })
  totalRows: number;

  @Column('integer', { default: 0 })
  newRows: number;

  /** 行级幂等键 (platform,platformLineId) 命中、被跳过的行数 */
  @Column('integer', { default: 0 })
  duplicateRows: number;

  @CreateDateColumn()
  importedAt: Date;

  @OneToMany(() => StatementRow, (r) => r.billImport)
  rows: StatementRow[];
}
