import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SplitBatch } from '../entities/split-batch.entity';
import { StatementRow } from '../entities/statement-row.entity';
import { Allocation } from '../entities/allocation.entity';
import { Contract } from '../entities/contract.entity';
import { Payment } from '../entities/payment.entity';
import { Creator } from '../entities/creator.entity';
import { SplitService } from './split.service';
import { SplitController } from './split.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SplitBatch,
      StatementRow,
      Allocation,
      Contract,
      Payment,
      Creator,
    ]),
  ],
  providers: [SplitService],
  controllers: [SplitController],
})
export class SplitModule {}
