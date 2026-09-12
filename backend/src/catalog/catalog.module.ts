import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Creator } from '../entities/creator.entity';
import { Work } from '../entities/work.entity';
import { Contract } from '../entities/contract.entity';
import { ContractShare } from '../entities/contract-share.entity';
import { CurrencyRate } from '../entities/currency-rate.entity';
import { StatementRow } from '../entities/statement-row.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { ImportModule } from '../import/import.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Creator,
      Work,
      Contract,
      ContractShare,
      CurrencyRate,
      StatementRow,
    ]),
    ImportModule,
  ],
  providers: [CatalogService],
  controllers: [CatalogController],
})
export class CatalogModule {}
