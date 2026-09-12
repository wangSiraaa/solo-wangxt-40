# 独立音乐分账核算台（Royalty Splitter）

把平台收入按**作品**和**收益权份额**分给创作者的可复核分账应用。

- **前端**：React + Vite —— 平台账单、作品映射、待处理区、分账批次、创作者台账
- **后端**：NestJS —— 导入解析、币种换算、跨合同切片、守恒分账核算
- **存储**：PostgreSQL —— 合同有效期、汇率有效期、账单原始行、分账批次、收益明细、付款清单
- **金额**：[decimal.js](https://mikemcl.github.io/decimal.js/) 高精度中间运算，落库为 **CNY 分整数**
- **支付**：仅本地文件 + **模拟结算**，不接任何真实支付通道
- **数据库**：内置 `embedded-postgres`，无需系统安装 Postgres / Docker

---

## 一、核心业务规则（与实现一一对应）

| 规则 | 实现位置 |
|---|---|
| **份额按收入归属期间适用的合同确定**，不采用导入当天份额 | `backend/src/common/contract-period.util.ts` `slicePeriodByContracts()` |
| 归属期间横跨多份合同（换签生效日）时**按天切片**，各段用各段合同 | 同上；`SplitService.precompute()` 第 1 级分配 |
| 合同同一天无覆盖/重叠覆盖 → 拒绝核算（行进入 `pending_contract`） | 同上（防御性抛错）+ `ImportService.resolveRow()` |
| 合同份额以**基点**保存，合计必须 = 10000 | `CatalogService.createContract()` |
| **外币未按明确汇率换算前不能相加**：汇率按**归属期结束日**取（不是导入日），无汇率进 `pending_rate` | `rateForDate()`、`ImportService.resolveRow()` |
| 未知 ISRC → `pending_match` 待处理区，不参与核算 | 同上；前端「② 待处理区」建映射 |
| 负向冲销原样保留（gross 负数），换算与分账均支持负数 | `money.util.ts`（绝对值分配后取负） |
| **总额守恒**：平台行换算合计 = 批次总额 = 创作者明细合计 | `SplitService` 三处断言，批次上 `conservationVerified` |
| **尾差稳定规则**：最大余数法（Hare quota），余数并列→权重大者优先→再并列按创作者 ID 升序 | `money.util.ts` `allocateByWeights()` |
| 两级尾差：①行总额按**切片天数**分到合同段；②切片额按**基点**分到创作者 | `SplitService.precompute()` |
| **预计算与确认/付款清单分开**：试算可作废 → 确认冻结 → 才能生成付款清单 → 模拟付款 | `SplitBatch.status` 状态机，见下 |
| 任一创作者明细可追到**平台原始行**（平台、行号、导入批次、原币原值、汇率快照、切片） | `GET /api/splits/creators/:id/ledger`，前端「⑤ 创作者台账」 |
| 重复导入：文件级 SHA-256 拦截 + 行级 `(platform, platform_line_id)` 幂等 | `ImportService.importCsv()` |

### 批次状态机

```
        试算 precomputed ──作废──> voided（账单行释放，可重新试算）
            │确认（再次守恒复核，冻结快照）
            ▼
        confirmed ──生成付款清单──> payments(pending_payout) ──模拟结算──> paid
```

已确认批次不可作废、不可重复生成付款清单；未确认批次不能生成付款清单。

---

## 二、快速开始

环境：Node.js ≥ 20（无需本机 PostgreSQL / Docker，首次启动 embedded-postgres 会自动拉取 PG17 二进制）。

需要 **3 个终端**（或用 `npm run dev:all` 一体化脚本，见下）：

```bash
# 终端 1：数据库
cd backend
npm install
npm run db:start          # 嵌入式 PG：127.0.0.1:55444，库名 royalty

# 终端 2：种子数据 + 样例账单导入 + API
cd backend
npm run seed              # 或 npm run demo（--reset 清库重建）
npm run start:dev         # http://127.0.0.1:3001

# 终端 3：前端
cd frontend
npm install
npm run dev               # http://127.0.0.1:3000
```

一体化（先装两边依赖，然后一条命令起库+种子+API+前端）：

```bash
cd backend && npm install
cd ../frontend && npm install
cd .. && npm run dev:all   # 见根目录 package.json
```

停止数据库：`cd backend && npm run db:stop`；重置演示数据：`npm run demo`。

### 一键核验

API 已启动时，运行 20 项端到端断言（重复导入、待处理隔离、汇率按期间、跨生效日切片、冲销、守恒、三阶段权限、台账追溯）：

```bash
cd backend && npm run e2e
```

---

## 三、样例数据导览（建议的演示动线）

种子脚本 `backend/scripts/seed.ts` 建立：

- **创作者**：林野、白晓、阿岛、厂牌·独立浪
- **作品**：《夜航 Night Crossing》(CNM012500001)、《回声峡谷 Echo Canyon》(CNM012500002)
  - 《潮汐 Tides》(CNM012599999) **故意不在作品库**，由账单触发待匹配
- **合同**：
  - 夜航 v1：2024-01-01 ~ **2025-06-30**，林野 70% / 厂牌 30%
  - 夜航 v2：**2025-07-01** ~ 至今，林野 50% / 白晓 40% / 厂牌 10%
  - 回声峡谷：2024-01-01 ~ 至今，阿岛 80% / 厂牌 20%
- **汇率**（按期间生效）：USD 7.12（至 2025-06-30）/ 7.18（7 月起）；EUR 7.80；**JPY 故意缺失**

样例账单 `backend/samples/`：

| 文件 | 覆盖的情形 |
|---|---|
| `spotify_h1_2025.csv` | 正常行（USD）、7 月新汇率行、**EUR 负向冲销 -12.50**、**JPY 缺汇率**、**未知 ISRC**、文件末行与首行重复（行级幂等） |
| `apple_cross_contract.csv` | `APP-2001` 归属期 **2025-06-15 ~ 2025-07-15 横跨 7/1 换签日**（切 16/15 天两段）；含一行行级重复 |
| `spotify_h1_2025_rerun.csv` | 与首文件内容完全相同（仅文件名不同），演示 **SHA-256 文件级拦截** |

### 手工核算锚点（可与界面对照）

- SPF-001：USD 120.50 × 7.12 = CNY 857.96（85,796 分）→ 70/30 = 60,057 / 25,739
- SPF-005：EUR -12.50 × 7.80 = **-97.50**（-9,750 分），80/20 = -7,800 / -1,950
- APP-2001：USD 50 × 7.18 = 359.00（35,900 分）；31 天按天切：
  - 6/15–6/30（16 天）= 18,529 分 → v1 合同 70/30 = **12,970 / 5,559**
  - 7/1–7/15（15 天）= 17,371 分 → v2 合同 50/40/10 = **8,686 / 6,948 / 1,737**（10% 档吃到 1 分尾差）
  - 18,529 + 17,371 = 35,900，分毫不差
- 首批就绪 7 行合计 **201,152 分（¥2,011.52）**，试算明细合计与之严格相等

### 建议演示步骤

1. 打开「① 平台账单」：查看 9 行原始账单、状态、原币/换算双金额；重复行计数为 0 入账
2. 「② 待处理区」：看到 JPY 缺汇率、未知 ISRC 两行；先**不处理**
3. 「④ 分账批次」：试算全部就绪行 → 显示三方守恒相等、18 条明细；APP-2001 可见 15/16 天跨合同切片
4. 打开批次：试算状态下付款被拒；确认后不可作废；生成付款清单并模拟付款
5. 回到「② 待处理区」：新建《潮汐》作品 → 在「③」补合同（70/30）；补 JPY 汇率 0.0475
6. 「④」再试算第二批（2 行，80,496 分）
7. 「⑤ 创作者台账」：任选创作者，逐笔看到平台行号、原币金额、适用汇率与合同切片——完成闭环追溯

---

## 四、HTTP API 摘要

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/imports` | 上传账单 CSV（multipart 字段 `file`） |
| GET | `/api/imports` / `/api/imports/rows?status=` | 导入批次 / 原始行 |
| GET | `/api/catalog/pending` | 待处理区 |
| POST | `/api/catalog/pending/:rowId/resolve-isrc` | 未知 ISRC 建作品映射 |
| POST | `/api/catalog/pending/reprocess` | 重新评估全部待处理行 |
| GET/POST | `/api/catalog/creators` `/works` `/contracts` `/rates` | 目录数据维护 |
| GET | `/api/splits/available-rows` | 未进入非作废批次的行 |
| POST | `/api/splits/batches` | 试算（body: `{label?, rowIds?}`），含守恒报告 |
| POST | `/api/splits/batches/:id/confirm` `/void` | 确认 / 作废 |
| POST | `/api/splits/batches/:id/payments` | 确认后生成付款清单 |
| POST | `/api/splits/payments/:id/mark-paid` | 模拟结算 |
| GET | `/api/splits/creators/:id/ledger` | 创作者收益台账（可追溯原始行） |

### CSV 格式

```csv
platform,platform_line_id,isrc,track_title,currency,gross,period_start,period_end
Spotify,SPF-001,CNM012500001,夜航 Night Crossing,USD,120.50,2025-01-01,2025-06-30
```

`gross` 支持负数（冲销）；`period_start/end` 为收入归属期间（UTC 日期，含端点）。

---

## 五、金额与尾差规则（为什么永远守恒）

1. 平台原币金额以 `numeric(18,4)` **原样留档**；
2. 换算：`decimal.js` 40 位精度 × 期间汇率 → CNY 保留 4 位小数（0.0001 元颗粒）→ 四舍五入为**整数分**；
3. 行内跨合同：整数分按切片天数做**最大余数法**（先按比例向下取整，剩余的每 1 分按余数从大到小补发，余数并列时天数多者优先、再并列按切片顺序）；
4. 切片内分人：同一算法按基点权重（余数并列→基点高者→创作者 ID 升序，确定性可复现）；
5. 冲销（负总额）：对绝对值分配后整体取负；
6. 每次分配内置 `sum(result) === total` 断言；批次确认前再做一次数据库级 SUM 复核。

---

## 六、目录结构

```
backend/
  src/
    common/money.util.ts            # decimal.js、最大余数法、日期工具（含守恒断言）
    common/contract-period.util.ts  # 归属期间×合同生效日切片、期间汇率选择
    entities/                       # TypeORM 实体（10 张表）
    import/                         # CSV 导入、幂等、状态解析（待匹配/待汇率/待合同）
    catalog/                        # 创作者/作品/合同/汇率、待处理区映射
    split/                          # 试算、确认、作废、付款清单、模拟结算、台账
  scripts/local-pg.ts               # 嵌入式 PG 启停
  scripts/seed.ts                   # 种子 + 样例导入
  scripts/e2e-check.ts              # 20 项端到端核验
  samples/*.csv                     # 跨合同/冲销/多币种/重复导入样例
frontend/
  src/pages/                        # 账单 / 待处理 / 目录 / 批次与明细 / 创作者台账
```

> 说明：演示环境用 TypeORM `synchronize` 自动建表；生产应替换为迁移文件。
> 所有支付动作均为本地状态模拟，不调用任何支付通道。
