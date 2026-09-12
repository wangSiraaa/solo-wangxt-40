import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Creator } from '../entities/creator.entity';
import { Work } from '../entities/work.entity';
import { Contract } from '../entities/contract.entity';
import { ContractShare } from '../entities/contract-share.entity';
import { CurrencyRate } from '../entities/currency-rate.entity';
import { StatementRow } from '../entities/statement-row.entity';
import { D, utcDay } from '../common/money.util';
import { ImportService } from '../import/import.service';

export interface ContractInput {
  workId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  label?: string;
  shares: { creatorId: string; basisPoints: number }[];
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Creator)
    private readonly creatorRepo: Repository<Creator>,
    @InjectRepository(Work)
    private readonly workRepo: Repository<Work>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(CurrencyRate)
    private readonly rateRepo: Repository<CurrencyRate>,
    @InjectRepository(StatementRow)
    private readonly rowRepo: Repository<StatementRow>,
    private readonly importService: ImportService,
  ) {}

  // ---------- 创作者 ----------
  listCreators() {
    return this.creatorRepo.find({ order: { name: 'ASC' } });
  }

  createCreator(input: { name: string; payoutAccount?: string }) {
    if (!input.name?.trim()) throw new BadRequestException('创作者名称必填');
    return this.creatorRepo.save(
      this.creatorRepo.create({
        name: input.name.trim(),
        payoutAccount: input.payoutAccount?.trim() ?? '',
      }),
    );
  }

  // ---------- 作品 ----------
  listWorks() {
    return this.workRepo.find({ order: { title: 'ASC' } });
  }

  async createWork(input: { title: string; isrc: string; artist?: string }) {
    const isrc = input.isrc?.trim().toUpperCase();
    if (!isrc) throw new BadRequestException('ISRC 必填');
    const dup = await this.workRepo.findOne({ where: { isrc } });
    if (dup) throw new BadRequestException(`ISRC ${isrc} 已存在`);
    return this.workRepo.save(
      this.workRepo.create({
        title: input.title?.trim() ?? isrc,
        isrc,
        artist: input.artist?.trim() ?? '',
      }),
    );
  }

  // ---------- 合同 ----------
  async listContracts(workId?: string) {
    const contracts = await this.contractRepo.find({
      where: workId ? { workId } : {},
      relations: { shares: { creator: true } },
      order: { effectiveFrom: 'ASC' },
    });
    return contracts;
  }

  async createContract(input: ContractInput): Promise<Contract> {
    const work = await this.workRepo.findOne({ where: { id: input.workId } });
    if (!work) throw new NotFoundException('作品不存在');
    if (!input.effectiveFrom) throw new BadRequestException('生效日必填');

    const sum = (input.shares ?? []).reduce(
      (acc, s) => acc.plus(D(s.basisPoints)),
      D(0),
    );
    if (!sum.equals(10000)) {
      throw new BadRequestException(
        `合同份额基点之和必须为 10000（当前 ${sum.toFixed()}）`,
      );
    }
    const creators = await this.creatorRepo.find();
    const creatorIds = new Set(creators.map((c) => c.id));
    if (input.shares.some((s) => !creatorIds.has(s.creatorId))) {
      throw new BadRequestException('存在未知创作者');
    }

    // 区间重叠校验（同一作品）
    const existing = await this.contractRepo.find({ where: { workId: input.workId } });
    const nFrom = utcDay(input.effectiveFrom);
    const nTo = input.effectiveTo ? utcDay(input.effectiveTo) : null;
    if (nTo !== null && nTo < nFrom) {
      throw new BadRequestException('合同失效日早于生效日');
    }
    for (const e of existing) {
      const eFrom = utcDay(e.effectiveFrom);
      const eTo = e.effectiveTo ? utcDay(e.effectiveTo) : null;
      const overlap = nFrom <= (eTo ?? Number.MAX_SAFE_INTEGER) &&
        (eFrom) <= (nTo ?? Number.MAX_SAFE_INTEGER);
      if (overlap) {
        throw new BadRequestException(
          `与既有合同 ${e.label || e.id}（${e.effectiveFrom}~${e.effectiveTo ?? '至今'}）区间重叠`,
        );
      }
    }

    const contract = this.contractRepo.create({
      workId: input.workId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      label: input.label?.trim() ?? '',
      shares: input.shares.map((s) =>
        // 需要真正的 repository 来 create share 实体
        this.contractRepo.manager.create(ContractShare, {
          creatorId: s.creatorId,
          basisPoints: Number(s.basisPoints),
        }),
      ),
    });
    const saved = await this.contractRepo.save(contract);
    await this.importService.reprocessPending();
    return saved;
  }

  // ---------- 汇率 ----------
  listRates() {
    return this.rateRepo.find({ order: { currency: 'ASC', effectiveFrom: 'ASC' } });
  }

  async createRate(input: {
    currency: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    rateToCny: string;
  }) {
    const currency = input.currency?.trim().toUpperCase();
    if (!currency || currency === 'CNY')
      throw new BadRequestException('外币代码必填且不能为 CNY（本币恒为 1）');

    // 显式校验：空值/无法解析/NaN/Infinity 一律拒绝，避免 D() 抛 500
    const raw = String(input.rateToCny ?? '').trim();
    let rate: ReturnType<typeof D>;
    if (!raw) throw new BadRequestException('汇率必填');
    try {
      rate = D(raw);
    } catch {
      throw new BadRequestException(`汇率无法解析: ${raw}`);
    }
    if (!rate.isFinite()) {
      throw new BadRequestException('汇率必须是有限数值');
    }
    // 不能只依赖 isPositive()：decimal.js 在 ROUND_HALF_UP 配置下对 0 也返回 true。
    // 显式拒绝 0 与一切非正值——0 汇率会把收入静默换算成 0 分，属于核算事故。
    if (rate.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        `汇率必须严格大于 0（收到 ${raw}）；0 或负汇率不得用于换算`,
      );
    }

    const saved = await this.rateRepo.save(
      this.rateRepo.create({
        currency,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        rateToCny: rate.toFixed(8),
      }),
    );
    await this.importService.reprocessPending();
    return saved;
  }

  // ---------- 待处理区 ----------
  /**
   * 待处理区：列出所有非 ready 的账单行（未知作品 / 缺汇率 / 缺合同）。
   * 这些行绝不参与试算，问题解决后由 reprocess 自动重新评估。
   */
  async pendingRows() {
    const rows = await this.rowRepo.find({
      relations: { billImport: true },
      order: { status: 'ASC', importedAt: 'ASC' },
    });
    return rows.filter((r) => r.status !== 'ready');
  }

  /** 为未知 ISRC 建立作品映射（新建作品或指定已有作品），随后重新评估 */
  async resolveIsrc(
    rowId: string,
    payload: { isrc?: string; title?: string; artist?: string; workId?: string },
  ) {
    const row = await this.rowRepo.findOne({ where: { id: rowId } });
    if (!row) throw new NotFoundException('账单行不存在');

    let workId = payload.workId;
    if (!workId) {
      const isrc = (payload.isrc ?? row.isrc).trim().toUpperCase();
      const existing = await this.workRepo.findOne({ where: { isrc } });
      if (existing) {
        workId = existing.id;
      } else {
        const work = await this.createWork({
          isrc,
          title: payload.title ?? row.trackTitle ?? isrc,
          artist: payload.artist ?? '',
        });
        workId = work.id;
      }
    }
    row.isrc = (await this.workRepo.findOneBy({ id: workId }))!.isrc;
    row.workId = workId;
    await this.rowRepo.save(row);
    await this.importService.reprocessPending();
    return this.rowRepo.findOne({ where: { id: rowId } });
  }

  reprocess() {
    return this.importService.reprocessPending();
  }
}
