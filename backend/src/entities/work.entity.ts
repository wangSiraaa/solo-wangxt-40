import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 作品（录音）。ISRC 是平台账单里用来匹配的国际标准录音编码。
 */
@Entity('works')
export class Work {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  title: string;

  @Index({ unique: true })
  @Column({ length: 12 })
  isrc: string;

  @Column({ length: 100, default: '' })
  artist: string;

  @CreateDateColumn()
  createdAt: Date;
}
