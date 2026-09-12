import Decimal from 'decimal.js';

// 全局金额规则：decimal.js 高精度中间运算
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * 内部金额以「货币最小单位的整数」入账（CNY 即分）。
 * DECIMAL_PLACES=4：外汇换算后的最小记账颗粒为 0.0001 元，
 * 再用四舍五入归整到整数分；分账尾差用最大余数法（largest remainder）
 * 再分配，保证所有创作者分到的分相加 == 平台行换算后的总分，恒定守恒。
 */
export const RATE_DECIMAL_PLACES = 8;
export const LEDGER_DECIMAL_PLACES = 4;
export const REPORTING_CURRENCY = 'CNY';

export function D(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** 外币金额(元, 字符串) * 汇率 -> CNY 元，保留 4 位小数中间颗粒 */
export function convertToReporting(
  amountMajor: string,
  rate: string,
): Decimal {
  return D(amountMajor)
    .mul(D(rate))
    .toDecimalPlaces(LEDGER_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
}

/** CNY 元(4 位小数) -> CNY 分整数（字符串），四舍五入 */
export function majorToMinorCents(amountCnyMajor: Decimal): string {
  return amountCnyMajor
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0);
}

export function centsToMajor(cents: Decimal.Value): Decimal {
  return D(cents).div(100);
}

export function formatCny(cents: Decimal.Value): string {
  return centsToMajor(cents).toFixed(2);
}

/**
 * 最大余数法（Hare quota 取整），把 totalMinor 按 weights 比例切成整数。
 * - floor(weight / totalWeight * total) 先保底分配
 * - 剩余的每 1 个最小单位，按「余数大小」依次发给对应方
 * - 余数相同的稳定 tie-break：权重更大者优先；仍相同则按传入下标
 *   （调用方已按 creator.id 升序排列，保证跨批次结果可复现）
 *
 * 负数（冲销）：对绝对值分配后整体取负。零：全零。
 * 守恒恒等式：sum(result) === totalMinor。
 */
export function allocateByWeights(
  totalMinor: Decimal.Value,
  weights: { key: string; weight: Decimal.Value }[],
): Record<string, string> {
  const total = D(totalMinor);
  const sign = total.greaterThan(0) ? 1 : total.lessThan(0) ? -1 : 0;
  const absTotal = total.abs();

  const weightSum = weights.reduce((acc, w) => acc.plus(D(w.weight)), D(0));
  if (weightSum.lessThanOrEqualTo(0)) {
    throw new Error('allocateByWeights: 权重之和必须为正');
  }

  const floors = weights.map((w) =>
    absTotal.mul(D(w.weight)).div(weightSum).floor(),
  );
  let allocated = floors.reduce((acc, v) => acc.plus(v), D(0));
  let remaining = absTotal.minus(allocated);

  // 余数 = 比例精确值 - floor 值，配合稳定 tie-break 排序
  const order = weights
    .map((w, i) => ({
      i,
      remainder: absTotal.mul(D(w.weight)).div(weightSum).minus(floors[i]),
      weight: D(w.weight),
    }))
    .sort((a, b) => {
      const cmp = b.remainder.comparedTo(a.remainder);
      if (cmp !== 0) return cmp;
      const wcmp = b.weight.comparedTo(a.weight);
      if (wcmp !== 0) return wcmp;
      return a.i - b.i;
    });

  const result = floors.slice();
  let cursor = 0;
  while (remaining.greaterThan(0) && order.length > 0) {
    result[order[cursor % order.length].i] =
      result[order[cursor % order.length].i].plus(1);
    remaining = remaining.minus(1);
    cursor++;
  }

  const out: Record<string, string> = {};
  weights.forEach((w, i) => {
    out[w.key] = result[i].mul(sign).toFixed(0);
  });

  // 守恒断言
  const checkSum = Object.values(out).reduce((acc, v) => acc.plus(D(v)), D(0));
  if (!checkSum.equals(total)) {
    throw new Error(
      `分账守恒校验失败: 分出 ${checkSum.toFixed()} != 总额 ${total.toFixed()}`,
    );
  }
  return out;
}

/** 含首尾的天数：[start, end] */
export function inclusiveDays(start: Date, end: Date): number {
  const ms = utcDay(end) - utcDay(start);
  return Math.round(ms / 86_400_000) + 1;
}

export function utcDay(d: Date | string): number {
  const x = typeof d === 'string' ? new Date(d + 'T00:00:00Z') : d;
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

export function addUtcDays(d: Date | string | number, days: number): Date {
  const base = typeof d === 'number' ? d : utcDay(d);
  return new Date(base + days * 86_400_000);
}

export function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
