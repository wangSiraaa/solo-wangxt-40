import { useEffect, useState } from 'react';
import { api, yuan, STATUS_LABEL, type Creator, type Ledger } from '../api';

export default function LedgerPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [cid, setCid] = useState('');
  const [ledger, setLedger] = useState<Ledger | null>(null);

  useEffect(() => { api.creators().then((c) => { setCreators(c); if (c[0]) setCid(c[0].id); }); }, []);
  useEffect(() => { if (cid) api.ledger(cid).then(setLedger); }, [cid]);

  return (
    <div>
      <h2>创作者收益台账</h2>
      <p className="desc">
        任意一条收益明细都能反向追溯到平台原始行：平台、行号、所属导入文件、原币金额、
        归属期、适用汇率与合同、切片天数、份额基点。冲销行为负数，同样逐条可追。
      </p>
      <div className="panel row-flex">
        <label className="fld">创作者
          <select value={cid} onChange={(e) => setCid(e.target.value)} style={{ minWidth: 220 }}>
            {creators.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.payoutAccount}）</option>)}
          </select>
        </label>
        {ledger && (
          <div className="stat" style={{ margin: 0 }}>
            <div className="box"><div className="k">累计应得（含已确认/试算批次）</div><div className="v">{yuan(ledger.totalCnyCents)}</div></div>
            <div className="box"><div className="k">明细笔数</div><div className="v">{ledger.lines.length}</div></div>
          </div>
        )}
      </div>

      {ledger && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>批次状态</th><th>平台原始行</th><th>ISRC</th><th>收入归属期间</th>
                <th>适用合同切片</th><th className="num">份额</th>
                <th>原始行金额</th><th className="num">实得(CNY)</th><th>原始行 UUID（可复核）</th>
              </tr>
            </thead>
            <tbody>
              {ledger.lines.map((l) => (
                <tr key={l.allocationId}>
                  <td><span className={`badge ${l.batchStatus}`}>{STATUS_LABEL[l.batchStatus]}</span></td>
                  <td>{l.platform}<div className="muted" style={{ fontSize: 11 }}>{l.platformLineId}</div></td>
                  <td><code>{l.isrc}</code><div className="muted" style={{ fontSize: 11 }}>{l.trackTitle}</div></td>
                  <td className="muted" style={{ fontSize: 11.5 }}>
                    {l.periodStart}~{l.periodEnd}
                    <div>切片 {l.sliceStart}~{l.sliceEnd}（{l.sliceDays}/{l.periodTotalDays}天）</div>
                  </td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 170, fontSize: 11.5 }}>{l.contractLabel}</td>
                  <td className="num">{(l.basisPoints / 100).toFixed(2)}%</td>
                  <td style={{ fontSize: 11.5 }}>
                    <span className={Number(l.grossMajor) < 0 ? 'neg' : ''}>{l.grossMajor} {l.currency}</span>
                    <div className="muted">× {l.rateSnapshot} → {yuan(l.rowCnyCents)}</div>
                  </td>
                  <td className={`num ${BigInt(l.amountCnyCents) < 0n ? 'neg' : ''}`}>{yuan(l.amountCnyCents)}</td>
                  <td className="note" style={{ fontSize: 10.5 }}>{l.statementRowId}<div>导入批次 {l.billImportId.slice(0, 8)}…</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
