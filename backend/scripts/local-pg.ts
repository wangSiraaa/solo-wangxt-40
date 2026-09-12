/* eslint-disable no-console */
/**
 * 本地嵌入式 PostgreSQL（无需系统安装 / Docker）：
 *   ts-node scripts/local-pg.ts start   初始化并在后台保持运行
 *   ts-node scripts/local-pg.ts stop    停止
 * 数据目录：backend/.pgdata，端口 55444。
 */
import { existsSync } from 'fs';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _Embedded = require('embedded-postgres');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EmbeddedPostgres: any = _Embedded.default ?? _Embedded;

const PORT = Number(process.env.PGPORT || 55444);
const DATA_DIR = join(__dirname, '..', '.pgdata');

function makePg() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    port: PORT,
    persistent: true,
    // 国内网络若下载二进制失败，可设置 npm_config_https_proxy 等
  });
}

async function start() {
  const pg = makePg();
  const initialized = existsSync(join(DATA_DIR, 'PG_VERSION'));
  if (!initialized) {
    console.log('[local-pg] 首次运行，初始化数据目录 ...');
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(process.env.PGDATABASE || 'royalty');
    console.log('[local-pg] 已创建数据库 royalty');
  } catch (e: any) {
    if (!/already exists/i.test(String(e.message))) throw e;
  }
  console.log(`[local-pg] PostgreSQL 运行中: 127.0.0.1:${PORT}/royalty`);

  const shutdown = async () => {
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {}, 1 << 30);
}

async function stop() {
  const pg = makePg();
  try {
    await pg.stop();
    console.log('[local-pg] 已停止');
  } catch (e) {
    console.log('[local-pg] 停止时（可能本就未运行）:', (e as Error).message);
  }
}

const cmd = process.argv[2] || 'start';
if (cmd === 'stop') stop();
else start();
