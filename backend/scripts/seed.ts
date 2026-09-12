/* eslint-disable no-console */
/**
 * 种子数据 + 样例账单导入。
 *   ts-node scripts/seed.ts            幂等写入目录数据并导入样例（重复内容自动跳过）
 *   ts-node scripts/seed.ts --reset    清空 schema 后重建
 *   ts-node scripts/seed.ts --no-import 只建目录数据
 *
 * 样例覆盖：
 *  - 跨合同生效日（2025-07-01 换签，Apple 账单期间横跨两份合同）
 *  - 负向冲销（EUR -12.50）
 *  - 多币种（USD/EUR/JPY，JPY 故意缺汇率进入待处理区）
 *  - 未知作品（ISRC 在作品库中不存在）
 *  - 重复导入（文件级 SHA-256 拦截 + 行级 (platform,lineId) 幂等）
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { Creator } from '../src/entities/creator.entity';
import { Work } from '../src/entities/work.entity';
import { Contract } from '../src/entities/contract.entity';
import { ContractShare } from '../src/entities/contract-share.entity';
import { CurrencyRate } from '../src/entities/currency-rate.entity';
import { ImportService } from '../src/import/import.service';

const C1 = '11111111-0000-4000-8000-000000000001';
const C2 = '11111111-0000-4000-8000-000000000002';
const C3 = '11111111-0000-4000-8000-000000000003';
const C4 = '11111111-0000-4000-8000-000000000004';

const W1 = '22222222-0000-4000-8000-000000000001';
const W2 = '22222222-0000-4000-8000-000000000002';

const K1A = '33333333-0000-4000-8000-000000000001';
const K1B = '33333333-0000-4000-8000-000000000002';
const K2A = '33333333-0000-4000-8000-000000000003';

const dbConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 55444),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'royalty',
};

async function resetSchema() {
  const client = new Client(dbConfig);
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  console.log('[seed] 已清空 public schema');
}

async function run() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const doImport = !args.includes('--no-import');

  if (reset) await resetSchema();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const ds = app.get(DataSource);

  // ---- 创作者（幂等）----
  const creators = [
    { id: C1, name: '林野', payoutAccount: 'SIM-BANK-1001' },
    { id: C2, name: '白晓', payoutAccount: 'SIM-BANK-1002' },
    { id: C3, name: '阿岛', payoutAccount: 'SIM-BANK-1003' },
    { id: C4, name: '厂牌·独立浪', payoutAccount: 'SIM-LABEL-2001' },
  ];
  for (const c of creators) {
    await ds.getRepository(Creator).save(c, { reload: false });
  }
  console.log('[seed] 创作者 4 位');

  // ---- 作品 ----
  await ds.getRepository(Work).save(
    [
      { id: W1, title: '夜航 Night Crossing', isrc: 'CNM012500001', artist: '林野 / 白晓' },
      { id: W2, title: '回声峡谷 Echo Canyon', isrc: 'CNM012500002', artist: '阿岛' },
      // 注意：CNM012599999《潮汐》故意不在作品库 —— 样例待匹配
    ],
    { reload: false },
  );
  console.log('[seed] 作品 2 个（另有 1 个未知 ISRC 由账单触发待匹配）');

  // ---- 合同（份额按期间生效）----
  const contracts: Contract[] = [
    {
      id: K1A,
      workId: W1,
      effectiveFrom: '2024-01-01',
      effectiveTo: '2025-06-30',
      label: '夜航-首发合同 v1（70/30）',
      shares: [
        { creatorId: C1, basisPoints: 7000 } as ContractShare,
        { creatorId: C4, basisPoints: 3000 } as ContractShare,
      ],
    } as Contract,
    {
      id: K1B,
      workId: W1,
      effectiveFrom: '2025-07-01',
      effectiveTo: null,
      label: '夜航-换签合同 v2（50/40/10）',
      shares: [
        { creatorId: C1, basisPoints: 5000 } as ContractShare,
        { creatorId: C2, basisPoints: 4000 } as ContractShare,
        { creatorId: C4, basisPoints: 1000 } as ContractShare,
      ],
    } as Contract,
    {
      id: K2A,
      workId: W2,
      effectiveFrom: '2024-01-01',
      effectiveTo: null,
      label: '回声峡谷-长期合同（80/20）',
      shares: [
        { creatorId: C3, basisPoints: 8000 } as ContractShare,
        { creatorId: C4, basisPoints: 2000 } as ContractShare,
      ],
    } as Contract,
  ];
  const contractRepo = ds.getRepository(Contract);
  const shareRepo = ds.getRepository(ContractShare);
  for (const c of contracts) {
    const { shares, ...base } = c;
    await contractRepo.save(base as any, { reload: false });
    await shareRepo.delete({ contractId: c.id });
    for (const s of shares) {
      await shareRepo.save(
        { id: randomUUID(), contractId: c.id, ...s },
        { reload: false },
      );
    }
  }
  console.log('[seed] 合同 3 份（《夜航》2025-07-01 换签，用于跨生效日切片演示）');

  // ---- 汇率（按期间生效，JPY 故意缺失）----
  await ds.getRepository(CurrencyRate).save(
    [
      { id: '44444444-0000-4000-8000-000000000001', currency: 'USD', effectiveFrom: '2024-01-01', effectiveTo: '2025-06-30', rateToCny: '7.12000000' },
      { id: '44444444-0000-4000-8000-000000000002', currency: 'USD', effectiveFrom: '2025-07-01', effectiveTo: null, rateToCny: '7.18000000' },
      { id: '44444444-0000-4000-8000-000000000003', currency: 'EUR', effectiveFrom: '2024-01-01', effectiveTo: null, rateToCny: '7.80000000' },
      // JPY 不配置：SPF-006 进入待处理区，补录后才能核算
    ],
    { reload: false },
  );
  console.log('[seed] 汇率：USD 两段、EUR 一段；JPY 故意留缺');

  // ---- 导入样例账单 ----
  if (doImport) {
    const importService = app.get(ImportService);
    const dir = join(__dirname, '..', 'samples');
    const files = [
      'spotify_h1_2025.csv',
      'apple_cross_contract.csv',
      // 与上一文件内容完全相同（仅文件名不同）：验证文件级重复导入拦截
      'spotify_h1_2025_rerun.csv',
    ];
    for (const f of files) {
      const buf = readFileSync(join(dir, f));
      const res = await importService.importCsv(f, buf);
      console.log(
        `[seed] 导入 ${f}: 总行 ${res.totalRows}，新增 ${res.newRows}，` +
          `行级重复跳过 ${res.duplicateRows}` +
          (res.fileSkippedAsDuplicate ? '（整文件因 SHA-256 命中而跳过）' : ''),
      );
    }
  }

  await app.close();
  console.log('[seed] 完成');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
