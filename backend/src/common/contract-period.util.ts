import { Contract } from '../entities/contract.entity';
import { ContractShare } from '../entities/contract-share.entity';
import { D, addUtcDays, dateStr, inclusiveDays, utcDay } from './money.util';

export interface PeriodSlice {
  contractId: string;
  contract: Contract;
  shares: ContractShare[];
  start: string;
  end: string;
  days: number;
  index: number;
}

/**
 * 把收入归属期间 [periodStart, periodEnd]（含端点）按合同生效边界切片。
 *
 * 规则：
 * - 收入归属期间可能横跨多份合同（如 2025 年合同 2025-07-01 换签），
 *   按天切成多段，每段适用当时有效的合同，绝不使用导入当天份额。
 * - 某一天没有任何合同覆盖 -> 抛错（pending_contract 由调用方预先判定，
 *   这里属于防御性校验，宁可不算也不许算错）。
 * - 同一天有两份合同重叠覆盖 -> 抛错（合同数据非法）。
 */
export function slicePeriodByContracts(
  periodStart: string,
  periodEnd: string,
  contracts: Contract[],
): PeriodSlice[] {
  const startDay = utcDay(periodStart);
  const endDay = utcDay(periodEnd);
  if (endDay < startDay) {
    throw new Error(`归属期间非法: ${periodStart} ~ ${periodEnd}`);
  }

  // 区间内的合同边界点（含端点），UTC day 毫秒
  const points = new Set<number>([startDay, addUtcDays(endDay, 1).getTime()]);
  for (const c of contracts) {
    const from = utcDay(c.effectiveFrom);
    if (from > startDay && from <= endDay) points.add(from);
    if (c.effectiveTo) {
      const after = addUtcDays(c.effectiveTo, 1).getTime();
      if (after > startDay && after <= endDay) points.add(after);
    }
  }
  const cuts = [...points].sort((a, b) => a - b);

  const slices: PeriodSlice[] = [];
  let index = 0;
  for (let k = 0; k < cuts.length - 1; k++) {
    const segStart = cuts[k];
    const segEnd = cuts[k + 1]; // 半开 [segStart, segEnd)
    if (segEnd <= segStart) continue;
    const probe = new Date(segStart);
    const probeStr = dateStr(probe);

    const covering = contracts.filter(
      (c) =>
        utcDay(c.effectiveFrom) <= utcDay(probeStr) &&
        (c.effectiveTo === null || utcDay(c.effectiveTo) >= utcDay(probeStr)),
    );

    if (covering.length === 0) {
      throw new Error(
        `归属期间 ${dateStr(new Date(segStart))} 没有适用合同（份额按收入归属期间确定）`,
      );
    }
    if (covering.length > 1) {
      throw new Error(
        `归属期间 ${dateStr(new Date(segStart))} 存在重叠合同: ${covering
          .map((c) => c.id)
          .join(', ')}`,
      );
    }

    const contract = covering[0];
    const sharesSum = contract.shares.reduce(
      (acc, s) => acc.plus(D(s.basisPoints)),
      D(0),
    );
    if (!sharesSum.equals(10000)) {
      throw new Error(
        `合同 ${contract.id}（${contract.label || ''}）份额基点之和为 ${sharesSum.toFixed()}，应为 10000`,
      );
    }

    const segEndInclusive = new Date(segEnd - 1);
    slices.push({
      contractId: contract.id,
      contract,
      shares: [...contract.shares].sort((a, b) =>
        a.creatorId < b.creatorId ? -1 : a.creatorId > b.creatorId ? 1 : 0,
      ),
      start: dateStr(new Date(segStart)),
      end: dateStr(segEndInclusive),
      days: inclusiveDays(new Date(segStart), segEndInclusive),
      index: index++,
    });
  }

  const totalDays = slices.reduce((acc, s) => acc + s.days, 0);
  const expected = inclusiveDays(new Date(startDay), new Date(endDay));
  if (totalDays !== expected) {
    throw new Error(
      `合同切片天数不守恒: 切片合计 ${totalDays} 天，归属期间 ${expected} 天`,
    );
  }
  return slices;
}

/** 判断整个归属期间是否每天都有且仅有一份合同覆盖 */
export function periodHasFullContractCoverage(
  periodStart: string,
  periodEnd: string,
  contracts: Contract[],
): boolean {
  try {
    slicePeriodByContracts(periodStart, periodEnd, contracts);
    return true;
  } catch {
    return false;
  }
}

/** 找到 periodEnd 当天适用的汇率（与份额口径一致：按收入归属期间） */
export function rateForDate(
  rates: { currency: string; effectiveFrom: string; effectiveTo: string | null; rateToCny: string }[],
  currency: string,
  periodEnd: string,
): string | null {
  if (currency === 'CNY') return '1';
  const day = utcDay(periodEnd);
  const hit = rates.find(
    (r) =>
      r.currency === currency &&
      utcDay(r.effectiveFrom) <= day &&
      (r.effectiveTo === null || utcDay(r.effectiveTo) >= day),
  );
  return hit ? hit.rateToCny : null;
}
