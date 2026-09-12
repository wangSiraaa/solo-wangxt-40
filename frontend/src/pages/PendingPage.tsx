import { useEffect, useState } from 'react';
import { api, STATUS_LABEL, type StatementRow } from '../api';
import { useAction } from '../toast';

export default function PendingPage() {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const act = useAction();

  async function load() {
    setRows(await api.pending());
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h2>待处理区</h2>
      <p className="desc">
        未匹配作品（未知 ISRC）、缺汇率、缺合同覆盖的账单行全部隔离在这里，<b>绝不参与试算</b>。
        补录作品映射、汇率或合同后系统会自动重新评估；也可点下方按钮手动重扫。
      </p>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn" onClick={() => act(async () => { await api.reprocess(); await load(); }, '已重新评估全部账单行')}>
          重新评估全部待处理行
        </button>
        <span className="note">解决完问题后一般无需手动点击（建合同/汇率时会自动触发）。</span>
      </div>

      {rows.length === 0 && (
        <div className="panel check-ok">✓ 待处理区为空，全部账单行均可核算。</div>
      )}

      {rows.map((r) => (
        <div className="panel" key={r.id}>
          <div className="row-flex" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 360px' }}>
              <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>{' '}
              <b>{r.platform} / {r.platformLineId}</b>
              <div className="note" style={{ marginTop: 6 }}>
                ISRC <code>{r.isrc}</code> · {r.trackTitle} · {r.grossMajor} {r.currency} ·
                归属期 {r.periodStart} ~ {r.periodEnd}
              </div>
              <div className="note" style={{ color: 'var(--warn)' }}>{r.statusNote}</div>
            </div>
            <div style={{ flex: '3 1 420px' }}>
              {r.status === 'pending_match' && <MatchForm row={r} onDone={load} />}
              {r.status === 'pending_rate' && <RateForm row={r} onDone={load} />}
              {r.status === 'pending_contract' && (
                <div className="note">
                  请到「③ 作品/合同/汇率」为该作品补一份覆盖归属期间的合同（注意区间不可与既有合同重叠）。
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchForm({ row, onDone }: { row: StatementRow; onDone: () => void }) {
  const [title, setTitle] = useState(row.trackTitle);
  const [artist, setArtist] = useState('');
  const act = useAction();
  return (
    <div className="formgrid">
      <label className="fld">作品名<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="fld">艺人<input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="可选" /></label>
      <button
        className="btn primary"
        onClick={() =>
          act(async () => {
            await api.resolveIsrc(row.id, { isrc: row.isrc, title, artist });
            onDone();
          }, `已为 ${row.platformLineId} 建立作品映射；若仍缺合同请在合同页补录`)
        }
      >
        新建作品并映射
      </button>
    </div>
  );
}

function RateForm({ row, onDone }: { row: StatementRow; onDone: () => void }) {
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState('2024-01-01');
  const act = useAction();
  return (
    <div className="formgrid">
      <label className="fld">1 {row.currency} = ? CNY<input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="如 0.0475" /></label>
      <label className="fld">汇率生效自<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <button
        className="btn primary"
        disabled={!rate}
        onClick={() =>
          act(async () => {
            await api.createRate({
              currency: row.currency,
              effectiveFrom: from,
              effectiveTo: null,
              rateToCny: rate,
            });
            onDone();
          }, `已补 ${row.currency} 汇率并重新换算（汇率按归属期结束日 ${row.periodEnd} 取）`)
        }
      >
        补汇率并重算
      </button>
    </div>
  );
}
