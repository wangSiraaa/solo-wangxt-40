#!/usr/bin/env node
/* 一键开发环境：确保依赖已装 → 启动嵌入式 PG（未运行则启动）→ 种子 → API → 前端 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname;
const run = (cmd, args, opts = {}) =>
  spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    ...opts,
  });

async function portOpen(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }).catch(() => null);
    return !!res;
  } catch {
    return false;
  }
}

async function waitPort(port, label) {
  for (let i = 0; i < 60; i++) {
    if (await portOpen(port)) {
      console.log(`[dev-all] ${label} 已就绪 (${port})`);
      return;
    }
    await sleep(1000);
  }
  throw new Error(`等待 ${label}(${port}) 超时`);
}

const procs = [];
function keep(p) {
  procs.push(p);
  p.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[dev-all] 子进程退出码 ${code}`);
  });
}

async function main() {
  if (!existsSync(`${root}backend/node_modules`) || !existsSync(`${root}frontend/node_modules`)) {
    console.log('[dev-all] 安装依赖…');
    await new Promise((res, rej) => run('npm run install:all').on('exit', (c) => (c ? rej(c) : res())));
  }

  // 1) PG（若端口没开）
  if (!(await portOpen(55444))) {
    console.log('[dev-all] 启动嵌入式 PostgreSQL…');
    keep(run('npm run db:start', [], { cwd: root }));
    await sleep(4000);
  }

  // 2) 种子（幂等）
  await new Promise((res) => run('npm run seed', []).on('exit', res));

  // 3) API
  keep(run('npm run api', []));
  await waitPort(3001, 'NestJS API');

  // 4) 前端
  keep(run('npm run web', []));

  const shutdown = () => procs.forEach((p) => p.kill('SIGTERM'));
  process.on('SIGINT', () => { shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });
  console.log('\n[dev-all] 全部就绪：前端 http://127.0.0.1:3000  API http://127.0.0.1:3001\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
