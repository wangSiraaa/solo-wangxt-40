import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SplitService } from './split.service';

@Controller('api/splits')
export class SplitController {
  constructor(private readonly split: SplitService) {}

  /** 可进入批次的账单行（未占用） */
  @Get('available-rows')
  available() {
    return this.split.availableRows();
  }

  /** 试算（预计算，不落付款清单） */
  @Post('batches')
  precompute(@Body() body: { label?: string; rowIds?: string[] }) {
    return this.split.precompute(body.label, body.rowIds);
  }

  @Get('batches')
  batches() {
    return this.split.listBatches();
  }

  @Get('batches/:id')
  detail(@Param('id') id: string) {
    return this.split.batchDetail(id);
  }

  /** 确认批次（冻结） */
  @Post('batches/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.split.confirm(id);
  }

  /** 作废试算批次（释放行） */
  @Post('batches/:id/void')
  voidBatch(@Param('id') id: string) {
    return this.split.void(id);
  }

  /** 已确认批次 -> 生成付款清单（独立于预计算） */
  @Post('batches/:id/payments')
  payments(@Param('id') id: string) {
    return this.split.generatePayments(id);
  }

  /** 模拟结算（不接真实支付） */
  @Post('payments/:paymentId/mark-paid')
  markPaid(@Param('paymentId') paymentId: string) {
    return this.split.markPaid(paymentId);
  }

  /** 创作者收益台账：逐笔追溯平台原始行 */
  @Get('creators/:creatorId/ledger')
  ledger(@Param('creatorId') creatorId: string) {
    return this.split.creatorLedger(creatorId);
  }
}
