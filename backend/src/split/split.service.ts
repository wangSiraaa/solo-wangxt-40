import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SplitBatch } from '../entities/split-batch.entity';
import { StatementRow } from '../entities/statement-row.entity';
import { Allocation } from '../entities/allocation.entity';
import { Contract } from '../entities/contract.entity';
import { Payment } from '../entities/payment.entity';
import { Creator } from '../entities/creator.entity';
import {
  D,
  allocateByWeights,
  formatCny,
} from '../common/money.util';
import { slicePeriodByContracts } from '../common/contract-period.util';

export interface PrecomputeResult {
  batch: SplitBatch;
  includedRows: number;
  excludedPendingRows: number;
  totalCnyCents: string;
  allocations: number;
  /** 守恒校验明细，全部相等才算通过 */
  conservation: {
    sumOfRows: string;
    sumOfAllocations: string;
    batchTotal: string;
    ok: boolean;
  };
}

/**
 * 一行的金额分配（两级尾差，规则固定、可复现）：
 * 第 1 级（跨合同切片）：行总额(分) 按「切片天数」用最大余数法分到各合同段；
 * 第 2 级（创作者份额）：每一切片金额(分) 按「合同基点份额」用最大余数法分到人。
 * 两层都守恒 => 一行所有创作者明细之和恒等于该行换算后 CNY 分。
 */
@Injectable()
export class SplitService {
  constructor(
    @InjectRepository(SplitBatch)
    private readonly batchRepo: Repository<SplitBatch>,
    @InjectRepository(StatementRow)
    private readonly rowRepo: Repository<StatementRow>,
    @InjectRepository(Allocation)
    private readonly allocRepo: Repository<Allocation>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Creator)
    private readonly creatorRepo: Repository<Creator>,
    private readonly dataSource: DataSource,
  ) {}

  /** 列出尚未进入任何非作废批次的可核算行 */
  async availableRows(): Promise<StatementRow[]> {
    const used = await this.allocRepo
      .createQueryBuilder('a')
      .innerJoin('a.batch', 'b')
      .where('b.status != :voided', { voided: 'voided' })
      .select('DISTINCT a.statementRowId', 'id')
      .getRawMany<{ id: string }>();
    const usedIds = new Set(used.map((u) => u.id));
    const rows = await this.rowRepo.find({
      order: { periodEnd: 'ASC', platform: 'ASC', platformLineId: 'ASC' },
    });
    return rows.filter((r) => !usedIds.has(r.id));
  }

  /**
   * 试算（不落付款）。rowIds 为空时自动选取所有 ready 且未被占用的行。
   * 非 ready 行一律拒绝进入批次——待处理行必须先解决。
   */
  async precompute(label: string, rowIds?: string[]): Promise<PrecomputeResult> {
    return this.dataSource.transaction(async (manager) => {
      const available = await this.availableRows();
      const availMap = new Map(available.map((r) => [r.id, r]));

      let picked: StatementRow[];
      if (!rowIds || rowIds.length === 0) {
        picked = available.filter((r) => r.status === 'ready');
      } else {
        picked = [];
        for (const id of rowIds) {
          const row = availMap.get(id);
          if (!row) {
            throw new BadRequestException(
              `账单行 ${id} 不可用：不存在、未就绪或已进入其他批次`,
            );
          }
          if (row.status !== 'ready') {
            throw new BadRequestException(
              `账单行 ${row.platform}/${row.platformLineId} 状态为 ${row.status}，须先在待处理区解决`,
            );
          }
          picked.push(row);
        }
      }

      if (picked.length === 0) {
        throw new BadRequestException('没有可核算的就绪行');
      }

      const batch = manager.create(SplitBatch, {
        label: label || `分账批次 ${new Date().toISOString().slice(0, 10)}`,
        status: 'precomputed',
        confirmedAt: null,
        voidedAt: null,
      });
      await manager.save(batch);

      const sumOfRows = picked.reduce(
        (acc, r) => acc.plus(D(r.cnyCents)),
        D(0),
      );
      let allocCount = 0;

      for (const row of picked) {
        const contracts = await manager.find(Contract, {
          where: { workId: row.workId! },
          relations: { shares: { creator: true } },
        });
        const slices = slicePeriodByContracts(
          row.periodStart,
          row.periodEnd,
          contracts,
        );
        const totalDays = slices.reduce((acc, s) => acc + s.days, 0);

        // 第 1 级：行总额(分) -> 切片（权重=天数，slice.index 升序即稳定 tie-break）
        const sliceWeighted = slices.map((s) => ({
          key: String(s.index),
          weight: s.days,
        }));
        const sliceCents = allocateByWeights(row.cnyCents!, sliceWeighted);

        for (const s of slices) {
          const sliceTotal = D(sliceCents[String(s.index)]);
          // 记录该切片相对「按天精确值」的尾差，复核可见
          const exactSlice = D(row.cnyCents!).mul(s.days).div(totalDays);
          const sliceRemainder = sliceTotal.minus(exactSlice.round());

          // 第 2 级：切片金额(分) -> 创作者（权重=基点；按 creatorId 升序稳定 tie-break）
          const creatorWeighted = s.shares.map((sh) => ({
            key: sh.creatorId,
            weight: sh.basisPoints,
          }));
          const perCreator = allocateByWeights(
            sliceTotal.toFixed(0),
            creatorWeighted,
          );

          for (const sh of s.shares) {
            const alloc = manager.create(Allocation, {
              batchId: batch.id,
              statementRowId: row.id,
              contractId: s.contractId,
              creatorId: sh.creatorId,
              sliceIndex: s.index,
              sliceStart: s.start,
              sliceEnd: s.end,
              sliceDays: s.days,
              periodTotalDays: totalDays,
              basisPoints: sh.basisPoints,
              amountCnyCents: perCreator[sh.creatorId],
              sliceCnyCents: sliceTotal.toFixed(0),
              sliceRemainderCents: sliceRemainder.toFixed(0),
              contractLabel: s.contract.label,
            });
            await manager.save(alloc);
            allocCount++;
          }
        }
      }

      const sumRow = await manager
        .createQueryBuilder(Allocation, 'a')
        .select('COALESCE(SUM(a.amountCnyCents), 0)', 'sum')
        .where('a.batchId = :id', { id: batch.id })
        .getRawOne<{ sum: string }>();
      const sumOfAllocations = D(sumRow.sum);

      // 总额守恒：平台行换算总额 == 创作者明细之和（批次总额随后写成同一值）
      const conservationOk = sumOfAllocations.equals(sumOfRows);

      batch.totalCnyCents = sumOfRows.toFixed(0);
      batch.rowCount = picked.length;
      batch.conservationVerified = conservationOk;
      batch.note =
        `尾差规则：①行→合同段按天数最大余数法；②段→创作者按基点最大余数法；` +
        `余数并列时权重大者优先，再并列按创作者ID升序。`;
      await manager.save(batch);

      if (!conservationOk) {
        // 数据库层断言，理论上 decimal.js + 整数分配不可能走到
        throw new BadRequestException(
          `守恒校验失败：行合计 ${formatCny(sumOfRows)}，明细合计 ${formatCny(
            sumOfAllocations,
          )}`,
        );
      }

      return {
        batch,
        includedRows: picked.length,
        excludedPendingRows: available.filter((r) => r.status !== 'ready').length,
        totalCnyCents: sumOfRows.toFixed(0),
        allocations: allocCount,
        conservation: {
          sumOfRows: sumOfRows.toFixed(0),
          sumOfAllocations: sumOfAllocations.toFixed(0),
          batchTotal: sumOfRows.toFixed(0),
          ok: conservationOk,
        },
      };
    });
  }

  async listBatches() {
    const batches = await this.batchRepo.find({ order: { createdAt: 'DESC' } });
    const counts = await this.allocRepo
      .createQueryBuilder('a')
      .select('a.batchId', 'batchId')
      .addSelect('COUNT(DISTINCT a.statementRowId)', 'rows')
      .addSelect('COUNT(*)', 'lines')
      .groupBy('a.batchId')
      .getRawMany();
    const map = new Map(counts.map((c) => [c.batchId, c]));
    return batches.map((b) => ({
      ...b,
      rowCount: Number(map.get(b.id)?.rows ?? b.rowCount),
      allocationCount: Number(map.get(b.id)?.lines ?? 0),
    }));
  }

  async batchDetail(batchId: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('批次不存在');

    const allocations = await this.allocRepo.find({
      where: { batchId },
      relations: { creator: true, statementRow: true },
      order: { statementRowId: 'ASC', sliceIndex: 'ASC', creatorId: 'ASC' },
    });

    // 按创作者汇总（付款清单的依据，但只在确认后才能生成）
    const byCreator = new Map<
      string,
      { creatorId: string; creatorName: string; amountCnyCents: string; lines: number }
    >();
    for (const a of allocations) {
      const cur =
        byCreator.get(a.creatorId) ??
        {
          creatorId: a.creatorId,
          creatorName: a.creator.name,
          amountCnyCents: '0',
          lines: 0,
        };
      cur.amountCnyCents = D(cur.amountCnyCents).plus(a.amountCnyCents).toFixed(0);
      cur.lines++;
      byCreator.set(a.creatorId, cur);
    }

    const payments = await this.paymentRepo.find({
      where: { batchId },
      relations: { creator: true },
    });

    const sumAlloc = allocations.reduce(
      (acc, a) => acc.plus(D(a.amountCnyCents)),
      D(0),
    );

    return {
      batch,
      allocations,
      creatorTotals: [...byCreator.values()].sort((a, b) =>
        a.creatorName.localeCompare(b.creatorName),
      ),
      payments,
      conservation: {
        sumOfAllocations: sumAlloc.toFixed(0),
        batchTotal: batch.totalCnyCents,
        ok: sumAlloc.equals(batch.totalCnyCents) && batch.conservationVerified,
      },
    };
  }

  /** 确认批次：冻结快照，之后才可生成付款清单 */
  async confirm(batchId: string): Promise<SplitBatch> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(SplitBatch, { where: { id: batchId } });
      if (!batch) throw new NotFoundException('批次不存在');
      if (batch.status === 'voided')
        throw new BadRequestException('已作废批次不能确认');
      if (batch.status === 'confirmed') return batch;

      const sumRow = await manager
        .createQueryBuilder(Allocation, 'a')
        .select('COALESCE(SUM(a.amountCnyCents), 0)', 'sum')
        .where('a.batchId = :id', { id: batchId })
        .getRawOne<{ sum: string }>();
      if (!D(sumRow.sum).equals(batch.totalCnyCents)) {
        throw new BadRequestException('确认前守恒复核失败，批次保持试算状态');
      }
      batch.status = 'confirmed';
      batch.confirmedAt = new Date();
      return manager.save(batch);
    });
  }

  /** 作废试算批次（释放账单行，可重新试算）；已确认批次不可作废 */
  async void(batchId: string): Promise<SplitBatch> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(SplitBatch, { where: { id: batchId } });
      if (!batch) throw new NotFoundException('批次不存在');
      if (batch.status === 'confirmed')
        throw new BadRequestException('已确认批次不能作废（付款清单已具备依据）');
      if (batch.status === 'voided') return batch;
      batch.status = 'voided';
      batch.voidedAt = new Date();
      return manager.save(batch);
    });
  }

  /**
   * 由「已确认」批次生成付款清单（与预计算分离的独立动作）。
   * 同一批次幂等：已生成则直接返回。仅模拟，不接真实支付。
   */
  async generatePayments(batchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(SplitBatch, { where: { id: batchId } });
      if (!batch) throw new NotFoundException('批次不存在');
      if (batch.status !== 'confirmed')
        throw new BadRequestException('只有已确认批次才能生成付款清单');

      const existing = await manager.find(Payment, {
        where: { batchId },
        relations: { creator: true },
      });
      if (existing.length > 0) return existing;

      const allocations = await manager.find(Allocation, { where: { batchId } });
      const totals = new Map<string, string>();
      for (const a of allocations) {
        const prev = D(totals.get(a.creatorId) ?? '0');
        totals.set(a.creatorId, prev.plus(a.amountCnyCents).toFixed(0));
      }
      const creators = await manager.find(Creator, {
        where: { id: In([...totals.keys()]) },
      });
      const payments: Payment[] = [];
      for (const c of creators) {
        const p = manager.create(Payment, {
          batchId,
          creatorId: c.id,
          creator: c,
          amountCnyCents: totals.get(c.id),
          status: 'pending_payout',
          payoutAccount: c.payoutAccount,
        });
        await manager.save(p);
        payments.push(p);
      }
      return payments;
    });
  }

  /** 模拟结算：把某条付款清单标记为已付（不发生真实资金动作） */
  async markPaid(paymentId: string): Promise<Payment> {
    const p = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!p) throw new NotFoundException('付款清单不存在');
    if (p.status !== 'paid') {
      p.status = 'paid';
      p.paidAt = new Date();
      await this.paymentRepo.save(p);
    }
    return p;
  }

  /** 创作者收益台账：每条明细都带平台原始行引用，可逐笔追溯 */
  async creatorLedger(creatorId: string) {
    const creator = await this.creatorRepo.findOne({ where: { id: creatorId } });
    if (!creator) throw new NotFoundException('创作者不存在');
    const allocations = await this.allocRepo.find({
      where: { creatorId },
      relations: { batch: true, statementRow: { billImport: true } },
      order: { statementRow: { periodEnd: 'ASC' } },
    });
    const total = allocations.reduce(
      (acc, a) => acc.plus(D(a.amountCnyCents)),
      D(0),
    );
    return {
      creator,
      totalCnyCents: total.toFixed(0),
      lines: allocations.map((a) => ({
        allocationId: a.id,
        batchId: a.batchId,
        batchStatus: a.batch.status,
        platform: a.statementRow.platform,
        platformLineId: a.statementRow.platformLineId,
        billImportId: a.statementRow.billImportId,
        statementRowId: a.statementRowId,
        isrc: a.statementRow.isrc,
        trackTitle: a.statementRow.trackTitle,
        currency: a.statementRow.currency,
        grossMajor: a.statementRow.grossMajor,
        rateSnapshot: a.statementRow.rateSnapshot,
        grossCnyMajor: a.statementRow.grossCnyMajor,
        rowCnyCents: a.statementRow.cnyCents,
        periodStart: a.statementRow.periodStart,
        periodEnd: a.statementRow.periodEnd,
        sliceStart: a.sliceStart,
        sliceEnd: a.sliceEnd,
        sliceDays: a.sliceDays,
        periodTotalDays: a.periodTotalDays,
        basisPoints: a.basisPoints,
        contractLabel: a.contractLabel,
        amountCnyCents: a.amountCnyCents,
        sliceCnyCents: a.sliceCnyCents,
        sliceRemainderCents: a.sliceRemainderCents,
      })),
    };
  }
}
