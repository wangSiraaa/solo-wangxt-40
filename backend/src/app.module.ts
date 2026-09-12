import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Creator } from './entities/creator.entity';
import { Work } from './entities/work.entity';
import { Contract } from './entities/contract.entity';
import { ContractShare } from './entities/contract-share.entity';
import { CurrencyRate } from './entities/currency-rate.entity';
import { BillImport } from './entities/bill-import.entity';
import { StatementRow } from './entities/statement-row.entity';
import { SplitBatch } from './entities/split-batch.entity';
import { Allocation } from './entities/allocation.entity';
import { Payment } from './entities/payment.entity';
import { ImportModule } from './import/import.module';
import { CatalogModule } from './catalog/catalog.module';
import { SplitModule } from './split/split.module';

export const entities = [
  Creator,
  Work,
  Contract,
  ContractShare,
  CurrencyRate,
  BillImport,
  StatementRow,
  SplitBatch,
  Allocation,
  Payment,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 55444),
        username: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'royalty',
        entities,
        // 演示用：实体变更自动建表；生产环境应改为迁移
        synchronize: true,
      }),
    }),
    ImportModule,
    CatalogModule,
    SplitModule,
  ],
})
export class AppModule {}
