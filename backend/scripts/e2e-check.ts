/* eslint-disable no-console */
/**
 * 端到端核验脚本（不依赖测试框架，断言失败即退出码 1）：
 *   ts-node scripts/e2e-check.ts
 * 前置：数据库已启动并已执行 seed（可用 npm run demo 重置后再跑）。
 *
 * 核验点：
 *  1. 重复导入：文件级 SHA-256 拦截
 *  2. 未知作品 / 缺汇率进入待处理区，且被试算排除
 *  3. 汇率按归属期结束日取（USD 6 月 7.12 / 7 月 7.18），不按导入当天
 *  4. 跨合同生效日切片：APP-2001 31 天切成 16/15
 *  5. 负向冲销 EUR -12.50 → -97.50 CNY
 *  6. 最大余数法 + 总额守恒（行合计＝批次额＝创作者明细合计）
 *  7. 预计算 / 确认 / 付款清单三阶段权限
 *  8. 创作者台账可追溯平台原始行号
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}
async function api(path: string, init?: any): Promise<any> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}
async function upload(file: string) {
  const buf = readFileSync(join(__dirname, '..', 'samples', file));
  const fd = new FormData();
  fd.append('file', new Blob([buf]), file);
  const res = await fetch(BASE + '/api/imports', { method: 'POST', body: fd });
  return res.json();
}

async function main() {
  console.log('1) 重复导入检测');
  const dup = await upload('spotify_h1_2025_rerun.csv');
  check('相同文件再次上传被整体跳过', dup.fileSkippedAsDuplicate === true);

  console.log('2) 待处理区（未知作品 / 缺汇率）');
  const pending = (await api('/api/catalog/pending')).body as any[];
  const pMatch = pending.find((r) => r.status === 'pending_match');
  const pRate = pending.find((r) => r.status === 'pending_rate');
  check('存在未知 ISRC 待匹配行', !!pMatch);
  check('存在 JPY 缺汇率行', !!pRate && pRate.currency === 'JPY');

  console.log('3) 汇率按归属期间（不按导入日）');
  const rowsResp = (await api('/api/imports/rows')).body;
  const byLine = Object.fromEntries(rowsResp.rows.map((r: any) => [r.platformLineId, r]));
  check('SPF-001（periodEnd 2025-06-30）用 7.12', byLine['SPF-001'].rateSnapshot === '7.12000000');
  check('SPF-003（periodEnd 2025-07-31）用 7.18', byLine['SPF-003'].rateSnapshot === '7.18000000');
  check('APP-2001（periodEnd 2025-07-15）用 7.18', byLine['APP-2001'].rateSnapshot === '7.18000000');

  console.log('4/5) 跨合同切片与负向冲销（通过只含新行的临时批次验证）');
  const availBefore = (await api('/api/splits/available-rows')).body as any[];
  const readyRows = availBefore.filter((r) => r.status === 'ready');
  const pendingRow = availBefore.find((r) => r.status !== 'ready');
  check('当前存在未就绪行（待处理区隔离中）', !!pendingRow);
  // 门槛在试算：显式把未就绪行纳入批次必须被拒绝
  if (pendingRow) {
    const reject = await api('/api/splits/batches', {
      method: 'POST',
      body: JSON.stringify({ label: '应被拒绝', rowIds: [pendingRow.id] }),
    });
    check('未就绪行不能进入试算批次', reject.status === 400);
  }
  const negRow = readyRows.find((r) => r.platformLineId === 'SPF-005');
  check('负向冲销 EUR -12.50 换算为 -9750 分', negRow && negRow.cnyCents === '-9750', negRow?.cnyCents);
  check('JPY 缺汇率行不是就绪行', availBefore.find((r) => r.platformLineId === 'SPF-006')?.status === 'pending_rate');

  console.log('4b) 0 / 负 / 非法汇率必须拒绝（回归：isPositive() 对 0 返回 true）');
  for (const bad of ['0', '-0.01', 'abc', '']) {
    const rr = await api('/api/catalog/rates', {
      method: 'POST',
      body: JSON.stringify({ currency: 'JPY', effectiveFrom: '2024-01-01', effectiveTo: null, rateToCny: bad }),
    });
    check(`rateToCny=${JSON.stringify(bad)} 返回 4xx`, rr.status >= 400 && rr.status < 500, `got ${rr.status}`);
  }
  const pendingAfterZero = (await api('/api/catalog/pending')).body as any[];
  const spf6 = pendingAfterZero.find((r) => r.platformLineId === 'SPF-006');
  check('被拒后 SPF-006 仍为 pending_rate 且金额为空', !!spf6 && spf6.cnyCents === null);
  const okRate = await api('/api/catalog/rates', {
    method: 'POST',
    body: JSON.stringify({ currency: 'JPY', effectiveFrom: '2024-01-01', effectiveTo: null, rateToCny: '0.0475' }),
  });
  check('JPY=0.0475 接受', okRate.status < 300);
  await new Promise((r) => setTimeout(r, 300)); // reprocessPending 在同事务后异步可见
  const rowsAgain = (await api('/api/imports/rows')).body;
  const spf6b = rowsAgain.rows.find((r: any) => r.platformLineId === 'SPF-006');
  check('补入正确汇率后 SPF-006 ready 且为 57000 分', spf6b.status === 'ready' && spf6b.cnyCents === '57000', JSON.stringify(spf6b && [spf6b.status, spf6b.cnyCents]));

  console.log('6) 批次守恒（自建试算批次）');
  let r0 = await api('/api/splits/batches', {
    method: 'POST',
    body: JSON.stringify({ label: 'E2E 核验批次' }),
  });
  if (r0.status !== 201 && r0.status !== 200) {
    // 就绪行可能已被既有批次占用：直接核验最近批次
    console.log('  · 无可用就绪行，改用既有批次核验');
  }
  const batches = (await api('/api/splits/batches')).body as any[];
  const target = r0.body?.batch ?? batches.find((b) => b.status !== 'voided') ?? batches[0];
  if (target) {
    const detail = (await api(`/api/splits/batches/${target.id}`)).body;
    check(
      '明细合计 = 批次总额',
      detail.conservation.sumOfAllocations === target.totalCnyCents,
      `${detail.conservation.sumOfAllocations} vs ${target.totalCnyCents}`,
    );
    const app = detail.allocations.filter((a: any) => a.statementRow.platformLineId === 'APP-2001');
    if (app.length) {
      const sliceDays = [...new Set(app.map((a: any) => a.sliceDays))].sort();
      check('APP-2001 跨生效日切成 15/16 天', JSON.stringify(sliceDays) === '[15,16]');
      const sliceSum = app
        .filter((a: any, _i: number, arr: any[]) => a.sliceIndex === arr[0].sliceIndex)
        .reduce((s: bigint, a: any) => s + BigInt(a.amountCnyCents), 0n);
      check('APP-2001 第 1 切片两人合计 = 18529 分', sliceSum === 18529n, String(sliceSum));
    }
    const eurNeg = detail.allocations.find((a: any) => a.statementRow.platformLineId === 'SPF-005');
    if (eurNeg) check('负向冲销 EUR -12.50 对应明细为负', BigInt(eurNeg.amountCnyCents) < 0n);

    console.log('7) 三阶段权限');
    let r = await api(`/api/splits/batches/${target.id}/payments`, { method: 'POST' });
    if (target.status === 'precomputed') check('试算批次不能生成付款清单', r.status === 400);
    r = await api(`/api/splits/batches/${target.id}/confirm`, { method: 'POST' });
    check('确认成功', r.status < 300 && r.body.status === 'confirmed');
    r = await api(`/api/splits/batches/${target.id}/void`, { method: 'POST' });
    check('已确认批次不能作废', r.status === 400);
    r = await api(`/api/splits/batches/${target.id}/payments`, { method: 'POST' });
    check('确认后可生成付款清单', r.status < 300 && Array.isArray(r.body));
    const paySum = r.body.reduce((s: bigint, p: any) => s + BigInt(p.amountCnyCents), 0n);
    check('付款清单合计 = 批次总额', paySum === BigInt(target.totalCnyCents));
  }

  console.log('8) 创作者台账可追溯');
  const creators = (await api('/api/catalog/creators')).body as any[];
  const led = (await api(`/api/splits/creators/${creators[0].id}/ledger`)).body;
  check('台账每条都带平台行号与原始行 UUID', led.lines.every((l: any) => l.platformLineId && l.statementRowId));
  const ledSum = led.lines.reduce((s: bigint, l: any) => s + BigInt(l.amountCnyCents), 0n);
  check('台账明细合计与总额字段一致', ledSum === BigInt(led.totalCnyCents));

  console.log(failures === 0 ? '\n全部核验通过 ✅' : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
