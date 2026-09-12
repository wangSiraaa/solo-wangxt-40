import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import { BillImport } from '../entities/bill-import.entity';
import { StatementRow } from '../entities/statement-row.entity';
import { Work } from '../entities/work.entity';
import { Contract } from '../entities/contract.entity';
import { CurrencyRate } from '../entities/currency-rate.entity';
import {
  convertToReporting,
  D,
  majorToMinorCents,
} from '../common/money.util';
import {
  periodHasFullContractCoverage,
  rateForDate,
} from '../common/contract-period.util';

export interface CsvRow {
  platform: string;
  platformLineId: string;
  isrc: string;
  trackTitle: string;
  currency: string;
  grossMajor: string;
  periodStart: string;
  periodEnd: string;
}

export interface ImportResult {
  billImportId: string;
  platform: string;
  fileName: string;
  fileHash: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  fileSkippedAsDuplicate: boolean;
}

const HEADER_MAP: Record<string, keyof CsvRow> = {
  platform: 'platform',
  platform_line_id: 'platformLineId',
  isrc: 'isrc',
  track_title: 'trackTitle',
  currency: 'currency',
  gross: 'grossMajor',
  period_start: 'periodStart',
  period_end: 'periodEnd',
};

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(BillImport)
    private readonly billRepo: Repository<BillImport>,
    @InjectRepository(StatementRow)
    private readonly rowRepo: Repository<StatementRow>,
    @InjectRepository(Work)
    private readonly workRepo: Repository<Work>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(CurrencyRate)
    private readonly rateRepo: Repository<CurrencyRate>,
    private readonly dataSource: DataSource,
  ) {}

  parseCsv(content: string | Buffer): CsvRow[] {
    const records = parse(content, {
      columns: (header: string[]) =>
        header.map((h) => HEADER_MAP[h.trim()] ?? h.trim()),
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
    });
    const required: (keyof CsvRow)[] = [
      'platform',
      'platformLineId',
      'isrc',
      'currency',
      'grossMajor',
      'periodStart',
      'periodEnd',
    ];
    return records.map((rec: any, i: number) => {
      for (const f of required) {
        if (rec[f] === undefined || rec[f] === null || rec[f] === '') {
          throw new Error(`CSV 第 ${i + 2} 行缺少必填列 ${f}`);
        }
      }
      const gross = String(rec.grossMajor).replace(/,/g, '');
      if (!D(gross).isFinite()) {
        throw new Error(`CSV 第 ${i + 2} 行金额无法解析: ${rec.grossMajor}`);
      }
      return {
        platform: String(rec.platform).trim(),
        platformLineId: String(rec.platformLineId).trim(),
        isrc: String(rec.isrc).trim().toUpperCase(),
        trackTitle: String(rec.trackTitle ?? '').trim(),
        currency: String(rec.currency).trim().toUpperCase(),
        grossMajor: gross,
        periodStart: String(rec.periodStart).trim(),
        periodEnd: String(rec.periodEnd).trim(),
      } satisfies CsvRow;
    });
  }

  async importCsv(fileName: string, content: Buffer): Promise<ImportResult> {
    const fileHash = createHash('sha256').update(content).digest('hex');
    const existing = await this.billRepo.findOne({ where: { fileHash } });
    if (existing) {
      return {
        billImportId: existing.id,
        platform: existing.platform,
        fileName: existing.fileName,
        fileHash,
        totalRows: existing.totalRows,
        newRows: 0,
        duplicateRows: existing.totalRows,
        fileSkippedAsDuplicate: true,
      };
    }

    const rows = this.parseCsv(content);
    if (rows.length === 0) throw new Error('CSV 没有任何数据行');
    const platform = rows[0].platform;

    return this.dataSource.transaction(async (manager) => {
      const bill = manager.create(BillImport, {
        platform,
        fileName,
        fileHash,
        totalRows: rows.length,
      });
      await manager.save(bill);

      let newRows = 0;
      let duplicateRows = 0;

      for (const r of rows) {
        const dup = await manager.findOne(StatementRow, {
          where: { platform: r.platform, platformLineId: r.platformLineId },
        });
        if (dup) {
          // 行级幂等：同一平台同一行号永不重复入账（重复导入样例走这里）
          duplicateRows++;
          continue;
        }

        const entity = manager.create(StatementRow, {
          billImportId: bill.id,
          platform: r.platform,
          platformLineId: r.platformLineId,
          isrc: r.isrc,
          trackTitle: r.trackTitle,
          currency: r.currency,
          grossMajor: D(r.grossMajor).toFixed(4),
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
        });
        await this.resolveRow(entity, manager);
        await manager.save(entity);
        newRows++;
      }

      bill.newRows = newRows;
      bill.duplicateRows = duplicateRows;
      await manager.save(bill);

      return {
        billImportId: bill.id,
        platform,
        fileName,
        fileHash,
        totalRows: rows.length,
        newRows,
        duplicateRows,
        fileSkippedAsDuplicate: false,
      };
    });
  }

  /**
   * 计算一行的状态与换算金额。状态优先级：
   * 未知作品(pending_match) > 缺汇率(pending_rate) > 缺合同(pending_contract) > ready。
   * 注意：汇率按「收入归属期间结束日」取，不按导入当天。
   */
  async resolveRow(
    row: StatementRow,
    manager = this.dataSource.manager,
  ): Promise<StatementRow> {
    const work = await manager.findOne(Work, { where: { isrc: row.isrc } });
    if (!work) {
      row.workId = null;
      row.rateSnapshot = null;
      row.grossCnyMajor = null;
      row.cnyCents = null;
      row.status = 'pending_match';
      row.statusNote = `作品库中不存在 ISRC ${row.isrc}，需在待处理区建立映射`;
      return row;
    }
    row.workId = work.id;

    const rate = rateForDate(
      await this.rateRepo.find(),
      row.currency,
      row.periodEnd,
    );
    if (rate === null) {
      row.rateSnapshot = null;
      row.grossCnyMajor = null;
      row.cnyCents = null;
      row.status = 'pending_rate';
      row.statusNote = `缺少 ${row.currency} 在归属期结束日 ${row.periodEnd} 适用的汇率，未明确换算前不得相加`;
      return row;
    }

    // 外币与 CNY 在「明确汇率换算前不能相加」：先快照汇率并换算
    const cnyMajor = convertToReporting(row.grossMajor, rate);
    row.rateSnapshot = rate;
    row.grossCnyMajor = cnyMajor.toFixed(4);
    row.cnyCents = majorToMinorCents(cnyMajor);

    const contracts = await manager.find(Contract, {
      where: { workId: work.id },
      relations: { shares: { creator: true } },
    });
    if (!periodHasFullContractCoverage(row.periodStart, row.periodEnd, contracts)) {
      row.status = 'pending_contract';
      row.statusNote = `归属期间 ${row.periodStart}~${row.periodEnd} 存在无合同覆盖的日期，无法按归属期确定份额`;
      return row;
    }

    row.status = 'ready';
    row.statusNote = '';
    return row;
  }

  /** 重新评估所有未就绪行（补录作品映射/汇率/合同后调用） */
  async reprocessPending(): Promise<Record<string, number>> {
    const stats = { ready: 0, pending_match: 0, pending_rate: 0, pending_contract: 0 };
    const rows = await this.rowRepo.find();
    for (const row of rows) {
      if (row.status !== 'ready') {
        await this.resolveRow(row);
        await this.rowRepo.save(row);
      }
      stats[row.status]++;
    }
    return stats;
  }
}
