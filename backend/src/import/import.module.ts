import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillImport } from '../entities/bill-import.entity';
import { StatementRow } from '../entities/statement-row.entity';
import { Work } from '../entities/work.entity';
import { Contract } from '../entities/contract.entity';
import { CurrencyRate } from '../entities/currency-rate.entity';
import { ImportService } from './import.service';
import { ImportController } from './import.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillImport, StatementRow, Work, Contract, CurrencyRate]),
  ],
  providers: [ImportService],
  controllers: [ImportController],
  exports: [ImportService, TypeOrmModule],
})
export class ImportModule {}
