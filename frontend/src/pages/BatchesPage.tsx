import { useEffect, useState } from 'react';
import { api, yuan, STATUS_LABEL, type Batch, type StatementRow } from '../api';
import { useAction } from '../toast';

export default function BatchesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');
  const [last, setLast] = useState<any>(null);
  const act = useAction();

  async function load() {
    const [r, b] = await Promise.all([api.availableRows(), api.batches()]);
    setRows(r);
    setBatches(b);
  }
  useEffect(() => { load(); }, []);

  const ready = rows.filter((r) => r.status === 'ready');
  const blocked = rows.filter((r) => r.status !== 'ready');

  function toggle(id: string) {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  }

  async function precompute() {
    await act(async () => {
      const ids = picked.size ? [...picked] : undefined;
      const res = await api.precompute(label || `批次 ${new Date().toISOString().slice(0, 10)}`, ids);
      setLast(res);
      setPicked(new Set());
      setLabel('');
      await load();
    });
  }

  const selectedTotal = ready
    .filter((r) => picked.has(r.id))
    .reduce((a, r) => a + BigInt(r.cnyCents!), 0n);

  return (
    <div>
      <h2>分账批次（预计算 → 确认 → 付款清单，三步分离）</h2>
      <p className="desc">
        ① <b>试算</b>：把就绪账单行按归属期合同切片并把金额分到创作者，结果落库可逐条复核，可作废重算，<b>不产生付款</b>；
        ② <b>确认</b>：再次守恒复核后冻结快照；③ <b>付款清单</b>：确认后按创作者汇总生成，仅做模拟结算。
        尾差规则：行→合同段按天数、段→创作者按基点，均用<b>最大余数法</b>分配整数分；
        余数并列时权重大者优先、再并列按创作者 ID 升序，跨批次结果稳定可复现。
      </p>

      <div className="panel">
        <h3>创建试算批次</h3>
        <div className="row-flex">
          <input placeholder="批次标签（可选）" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 260 }} />
          <button className="btn primary" disabled={ready.length === 0} onClick={precompute}>
            {picked.size ? `试算选中的 ${picked.size} 行（${yuan(selectedTotal.toString())}）` : `试算全部 ${ready.length} 个就绪行`}
          </button>
          {picked.size > 0 && <button className="btn" onClick={() => setPicked(new Set())}>清除选择</button>}
          {blocked.length > 0 && (
            <span className="note">另有 {blocked.length} 行未就绪，已自动排除：
              {[...new Set(blocked.map((r) => STATUS_LABEL[r.status]))].join('、')}</span>
          )}
        </div>
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th><th>平台/行号</th><th>ISRC</th><th>归属期间</th>
              <th>原币</th><th>汇率</th><th className="num">CNY(分)</th>
            </tr>
          </thead>
          <tbody>
            {ready.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td>{r.platform}<div className="muted" style={{ fontSize: 11 }}>{r.platformLineId}</div></td>
                <td><code>{r.isrc}</code></td>
                <td className="muted" style={{ fontSize: 11.5 }}>{r.periodStart}~{r.periodEnd}</td>
                <td className={BigInt(r.cnyCents!) < 0n ? 'neg' : ''}>{r.grossMajor} {r.currency}</td>
                <td>{r.rateSnapshot}</td>
                <td className={`num ${BigInt(r.cnyCents!) < 0n ? 'neg' : ''}`}>{yuan(r.cnyCents)}</td>
              </tr>
            ))}
            {ready.length === 0 && (
              <tr><td colSpan={7} className="muted">没有可核算的就绪行（可能都已进入批次，或还在待处理区）。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {last && (
        <div className="panel">
          <h3>试算结果（可复核）</h3>
          <div className="stat">
            <div className="box"><div className="k">纳入行数</div><div className="v">{last.includedRows}</div></div>
            <div className="box"><div className="k">排除的待处理行</div><div className="v">{last.excludedPendingRows}</div></div>
            <div className="box"><div className="k">收益明细条数</div><div className="v">{last.allocations}</div></div>
            <div className="box"><div className="k">批次总额(CNY)</div><div className="v">{yuan(last.totalCnyCents)}</div></div>
            <div className="box">
              <div className="k">总额守恒</div>
              <div className={`v ${last.conservation.ok ? 'check-ok' : 'check-bad'}`}>
                {last.conservation.ok ? '✓ 三方相等' : '✗ 不平'}
              </div>
            </div>
          </div>
          <div className="note">
            平台行合计 {yuan(last.conservation.sumOfRows)} ＝ 批次总额 {yuan(last.conservation.batchTotal)}
            ＝ 创作者明细合计 {yuan(last.conservation.sumOfAllocations)}
            。<button className="btn" style={{ marginLeft: 12 }} onClick={() => onOpen(last.batch.id)}>打开批次复核 →</button>
          </div>
        </div>
      )}

      <div className="panel">
        <h3>批次列表</h3>
        <table>
          <thead>
            <tr><th>批次</th><th>状态</th><th className="num">行数</th><th className="num">明细</th><th className="num">总额(CNY)</th><th>守恒</th><th>创建时间</th><th></th></tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{b.label}</td>
                <td><span className={`badge ${b.status}`}>{STATUS_LABEL[b.status]}</span></td>
                <td className="num">{b.rowCount}</td>
                <td className="num">{b.allocationCount ?? 0}</td>
                <td className="num">{yuan(b.totalCnyCents)}</td>
                <td className={b.conservationVerified ? 'check-ok' : 'check-bad'}>{b.conservationVerified ? '✓' : '✗'}</td>
                <td className="muted">{new Date(b.createdAt).toLocaleString('zh-CN')}</td>
                <td><button className="btn" onClick={() => onOpen(b.id)}>打开</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
