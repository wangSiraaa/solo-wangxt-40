import { useEffect, useState } from 'react';
import {
  api, yuan,
  type Contract, type Creator, type CurrencyRate, type Work,
} from '../api';
import { useAction } from '../toast';

export default function CatalogPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [works, setWorks] = useState<Work[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const act = useAction();

  async function load() {
    const [c, w, k, r] = await Promise.all([
      api.creators(), api.works(), api.contracts(), api.rates(),
    ]);
    setCreators(c); setWorks(w); setContracts(k); setRates(r);
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h2>作品 / 合同 / 汇率</h2>
      <p className="desc">
        合同保存「有效期 + 创作者份额（基点，合计 10000）」；同一作品合同区间不可重叠。
        核算时按收入归属期间逐日选择适用合同——<b>不是导入当天的份额</b>。
        汇率同样按归属期间生效，1 外币折合多少 CNY，CNY 本币恒为 1。
      </p>

      <div className="panel">
        <h3>创作者</h3>
        <table>
          <thead><tr><th>姓名</th><th>模拟收款账户</th></tr></thead>
          <tbody>
            {creators.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td className="muted">{c.payoutAccount}</td></tr>
            ))}
          </tbody>
        </table>
        <CreatorForm onDone={load} />
      </div>

      <div className="panel">
        <h3>作品（ISRC 映射）</h3>
        <table>
          <thead><tr><th>作品</th><th>艺人</th><th>ISRC</th></tr></thead>
          <tbody>
            {works.map((w) => (
              <tr key={w.id}><td>{w.title}</td><td className="muted">{w.artist}</td><td><code>{w.isrc}</code></td></tr>
            ))}
          </tbody>
        </table>
        <WorkForm onDone={load} />
      </div>

      <div className="panel">
        <h3>合同（含有效期与份额）</h3>
        <table>
          <thead><tr><th>作品</th><th>合同</th><th>有效期</th><th>份额（基点 → 百分比）</th></tr></thead>
          <tbody>
            {contracts.map((k) => (
              <tr key={k.id}>
                <td>{works.find((w) => w.id === k.workId)?.title ?? k.workId}</td>
                <td>{k.label || '—'}</td>
                <td className="muted">{k.effectiveFrom} ~ {k.effectiveTo ?? '至今'}</td>
                <td>
                  {k.shares
                    .slice()
                    .sort((a, b) => b.basisPoints - a.basisPoints)
                    .map((s) => (
                      <span key={s.creatorId} className="pill" style={{ marginRight: 6 }}>
                        {s.creator?.name ?? creators.find((c) => c.id === s.creatorId)?.name}: {s.basisPoints}（{(s.basisPoints / 100).toFixed(2)}%）
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ContractForm creators={creators} works={works} onDone={load} />
      </div>

      <div className="panel">
        <h3>汇率（按期间生效，1 外币 = ? CNY）</h3>
        <table>
          <thead><tr><th>币种</th><th>生效期</th><th className="num">汇率</th></tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td><b>{r.currency}</b></td>
                <td className="muted">{r.effectiveFrom} ~ {r.effectiveTo ?? '至今'}</td>
                <td className="num">{r.rateToCny}</td>
              </tr>
            ))}
            <tr><td><b>CNY</b></td><td className="muted">永久</td><td className="num">1（本币，{yuan(123)} 展示用）</td></tr>
          </tbody>
        </table>
        <RateForm onDone={load} />
      </div>
    </div>
  );
}

function CreatorForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [acc, setAcc] = useState('');
  const act = useAction();
  return (
    <div className="row-flex" style={{ marginTop: 10 }}>
      <input placeholder="创作者姓名" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="模拟收款账户" value={acc} onChange={(e) => setAcc(e.target.value)} />
      <button className="btn" disabled={!name} onClick={() => act(async () => { await api.createCreator({ name, payoutAccount: acc }); setName(''); setAcc(''); onDone(); }, '已新增创作者')}>新增</button>
    </div>
  );
}

function WorkForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [isrc, setIsrc] = useState('');
  const [artist, setArtist] = useState('');
  const act = useAction();
  return (
    <div className="row-flex" style={{ marginTop: 10 }}>
      <input placeholder="作品名" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="ISRC" value={isrc} onChange={(e) => setIsrc(e.target.value.toUpperCase())} style={{ width: 150 }} />
      <input placeholder="艺人（可选）" value={artist} onChange={(e) => setArtist(e.target.value)} />
      <button className="btn" disabled={!title || !isrc}
        onClick={() => act(async () => { await api.createWork({ title, isrc, artist }); setTitle(''); setIsrc(''); setArtist(''); onDone(); }, '已新增作品')}>新增</button>
    </div>
  );
}

function ContractForm({ creators, works, onDone }: { creators: Creator[]; works: Work[]; onDone: () => void }) {
  const [workId, setWorkId] = useState('');
  const [from, setFrom] = useState('2025-01-01');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [pairs, setPairs] = useState<{ creatorId: string; bps: string }[]>([]);
  const act = useAction();
  const sum = pairs.reduce((a, p) => a + (Number(p.bps) || 0), 0);

  function add() {
    const unused = creators.find((c) => !pairs.some((p) => p.creatorId === c.id));
    if (unused) setPairs([...pairs, { creatorId: unused.id, bps: '' }]);
  }

  return (
    <details>
      <summary>新增合同版本</summary>
      <div className="formgrid" style={{ margin: '10px 0' }}>
        <label className="fld">作品
          <select value={workId} onChange={(e) => setWorkId(e.target.value)}>
            <option value="">选择…</option>
            {works.map((w) => <option key={w.id} value={w.id}>{w.title} ({w.isrc})</option>)}
          </select>
        </label>
        <label className="fld">生效自<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="fld">失效日（留空=至今）<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="fld">合同标签<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如 换签 v2（50/40/10）" /></label>
      </div>
      <div className="row-flex">
        {pairs.map((p, i) => (
          <div key={i} className="pill row-flex" style={{ gap: 6 }}>
            <select value={p.creatorId} onChange={(e) => setPairs(pairs.map((x, j) => j === i ? { ...x, creatorId: e.target.value } : x))}>
              {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input style={{ width: 90 }} placeholder="基点" value={p.bps}
              onChange={(e) => setPairs(pairs.map((x, j) => j === i ? { ...x, bps: e.target.value.replace(/[^0-9]/g, '') } : x))} />
          </div>
        ))}
        <button className="btn" onClick={add}>+ 创作者</button>
        <span className={sum === 10000 ? 'check-ok' : 'check-bad'}>基点合计：{sum} / 10000</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={!workId || sum !== 10000 || pairs.some((p) => !p.creatorId)}
          onClick={() => act(async () => {
            await api.createContract({
              workId, effectiveFrom: from, effectiveTo: to || null, label,
              shares: pairs.map((p) => ({ creatorId: p.creatorId, basisPoints: Number(p.bps) })),
            });
            setPairs([]); setLabel(''); onDone();
          }, '合同已生效，待处理行已自动重新评估')}>
          保存合同
        </button>
      </div>
    </details>
  );
}

function RateForm({ onDone }: { onDone: () => void }) {
  const [currency, setCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState('2025-01-01');
  const act = useAction();
  return (
    <details>
      <summary>新增汇率</summary>
      <div className="row-flex" style={{ marginTop: 10 }}>
        <input placeholder="币种 USD/EUR/JPY…" maxLength={3} style={{ width: 90 }}
          value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        <input placeholder="1 外币 = ? CNY" style={{ width: 150 }}
          value={rate} onChange={(e) => setRate(e.target.value)} />
        <label className="fld">生效自<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <button className="btn primary" disabled={!currency || !rate}
          onClick={() => act(async () => {
            await api.createRate({ currency, rateToCny: rate, effectiveFrom: from, effectiveTo: null });
            setCurrency(''); setRate(''); onDone();
          }, '汇率已保存，待处理行已按新汇率换算')}>保存汇率</button>
      </div>
    </details>
  );
}
