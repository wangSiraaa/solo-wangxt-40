import { useEffect, useState } from 'react';
import { api, yuan, STATUS_LABEL, type BatchDetail } from '../api';
import { useAction } from '../toast';

export default function BatchDetailPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<BatchDetail | null>(null);
  const act = useAction();

  async function load() {
    setD(await api.batch(id));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!d) return <div className="muted">加载中…</div>;
  const { batch, allocations, creatorTotals, payments, conservation } = d;

  return (
    <div>
      <button className="btn" onClick={onBack} style={{ marginBottom: 12 }}>← 返回批次列表</button>
      <h2>{batch.label}</h2>
      <p className="desc">{batch.note}</p>

      <div className="stat">
        <div className="box"><div className="k">状态</div><div className="v"><span className={`badge ${batch.status}`}>{STATUS_LABEL[batch.status]}</span></div></div>
        <div className="box"><div className="k">平台行数</div><div className="v">{batch.rowCount}</div></div>
        <div className="box"><div className="k">收益明细</div><div className="v">{allocations.length}</div></div>
        <div className="box"><div className="k">批次总额(CNY)</div><div className="v">{yuan(batch.totalCnyCents)}</div></div>
        <div className="box">
          <div className="k">守恒（行合计＝明细合计＝批次额）</div>
          <div className={`v ${conservation.ok ? 'check-ok' : 'check-bad'}`}>
            {conservation.ok ? `✓ ${yuan(conservation.sumOfAllocations)}` : '✗ 不平'}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>批次操作（预计算与付款清单分离）</h3>
        <div className="row-flex">
          {batch.status === 'precomputed' && (
            <>
              <button className="btn primary"
                onClick={() => act(async () => { await api.confirm(id); await load(); }, '批次已确认并冻结，现可生成付款清单')}>
                ② 确认批次（冻结前再做守恒复核）
              </button>
              <button className="btn danger"
                onClick={() => act(async () => { await api.void(id); await load(); }, '批次已作废，账单行已释放可重新试算')}>
                作废试算（释放账单行）
              </button>
            </>
          )}
          {batch.status === 'confirmed' && (
            <button className="btn primary"
              onClick={() => act(async () => { await api.payments(id); await load(); }, '已按创作者汇总生成付款清单（尚未付款）')}>
              ③ 生成付款清单（独立动作）
            </button>
          )}
          {batch.status === 'voided' && <span className="check-bad">该批次已作废，不参与后续流程。</span>}
          <span className="note">
            {batch.confirmedAt && `确认于 ${new Date(batch.confirmedAt).toLocaleString('zh-CN')}`}
            {batch.voidedAt && `作废于 ${new Date(batch.voidedAt).toLocaleString('zh-CN')}`}
          </span>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="panel">
          <h3>付款清单（仅模拟结算，不接真实支付）</h3>
          <table>
            <thead><tr><th>创作者</th><th>模拟账户</th><th className="num">金额(CNY)</th><th>状态</th><th>付款时间</th><th></th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{creatorTotals.find((t) => t.creatorId === p.creatorId)?.creatorName ?? p.creatorId}</td>
                  <td className="muted">{p.payoutAccount}</td>
                  <td className="num">{yuan(p.amountCnyCents)}</td>
                  <td><span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span></td>
                  <td className="muted">{p.paidAt ? new Date(p.paidAt).toLocaleString('zh-CN') : '—'}</td>
                  <td>
                    {p.status === 'pending_payout' && (
                      <button className="btn" onClick={() => act(async () => { await api.markPaid(p.id); await load(); }, '已标记模拟付款（无真实资金动作）')}>模拟付款</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><b>合计</b></td>
                <td className="num"><b>{yuan(payments.reduce((a, p) => a + BigInt(p.amountCnyCents), 0n).toString())}</b></td>
                <td colSpan={3} className="note">付款合计须等于批次总额 {yuan(batch.totalCnyCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="panel">
        <h3>按创作者汇总</h3>
        <table>
          <thead><tr><th>创作者</th><th className="num">明细笔数</th><th className="num">应得(CNY)</th></tr></thead>
          <tbody>
            {creatorTotals.map((t) => (
              <tr key={t.creatorId}>
                <td>{t.creatorName}</td>
                <td className="num">{t.lines}</td>
                <td className="num">{yuan(t.amountCnyCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>收益明细（每条均可下钻至平台原始行）</h3>
        <table>
          <thead>
            <tr>
              <th>平台 / 行号</th><th>ISRC / 期间</th><th>适用合同</th><th>切片</th>
              <th className="num">份额</th><th>创作者</th>
              <th className="num">切片额(分)</th><th className="num">实得(CNY)</th><th>追溯</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              const r = a.statementRow;
              const cross = a.periodTotalDays !== a.sliceDays;
              return (
                <tr key={a.id}>
                  <td>{r.platform}<div className="muted" style={{ fontSize: 11 }}>{r.platformLineId}</div></td>
                  <td><code>{r.isrc}</code><div className="muted" style={{ fontSize: 11 }}>{r.periodStart}~{r.periodEnd}</div></td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 180 }}>{a.contractLabel || '—'}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>
                    {a.sliceStart}~{a.sliceEnd}
                    <div>{cross ? `${a.sliceDays}/${a.periodTotalDays} 天（跨合同切分）` : `${a.sliceDays} 天`}</div>
                  </td>
                  <td className="num">{(a.basisPoints / 100).toFixed(2)}%</td>
                  <td>{a.creator.name}</td>
                  <td className="num muted">{yuan(a.sliceCnyCents)}</td>
                  <td className={`num ${BigInt(a.amountCnyCents) < 0n ? 'neg' : ''}`}>{yuan(a.amountCnyCents)}</td>
                  <td className="note" style={{ whiteSpace: 'normal', maxWidth: 230 }}>
                    原始行 {r.grossMajor} {r.currency} × 汇率 {r.rateSnapshot}
                    <div>原币行额折 CNY {yuan(r.cnyCents)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
