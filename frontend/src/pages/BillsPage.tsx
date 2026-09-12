import { useEffect, useState } from 'react';
import { api, yuan, STATUS_LABEL, type BillImport, type StatementRow } from '../api';
import { useAction, useToast } from '../toast';

export default function BillsPage() {
  const [imports, setImports] = useState<BillImport[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [total, setTotal] = useState('0');
  const [filter, setFilter] = useState('');
  const toast = useToast();
  const act = useAction();

  async function load() {
    setImports(await api.imports());
    const r = await api.rows(filter || undefined);
    setRows(r.rows);
    setTotal(r.totalConvertedCny);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function upload(file: File) {
    const res = await act(() => api.upload(file));
    if (res) {
      toast(
        res.fileSkippedAsDuplicate
          ? `文件 ${res.fileName} 与历史导入 SHA-256 完全相同，整文件跳过（重复导入）`
          : `导入完成：${res.fileName}，新增 ${res.newRows} 行，行级重复跳过 ${res.duplicateRows} 行`,
      );
      load();
    }
  }

  return (
    <div>
      <h2>平台账单</h2>
      <p className="desc">
        上传平台 CSV（列：<code>platform, platform_line_id, isrc, track_title, currency, gross, period_start, period_end</code>）。
        金额按<b>收入归属期间结束日</b>适用的汇率换算为 CNY；负向冲销（gross 为负）原样保留；
        同文件重复上传按 SHA-256 拦截，同平台同行号按行级幂等跳过。<b>外币未明确汇率换算前不与任何金额相加</b>。
      </p>

      <div className="panel">
        <h3>导入账单</h3>
        <div className="row-flex">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <span className="note">样例文件位于 <code>backend/samples/</code>，种子脚本已自动导入。</span>
        </div>
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>文件</th><th>平台</th><th className="num">总行</th>
              <th className="num">新增</th><th className="num">重复跳过</th><th>导入时间</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((b) => (
              <tr key={b.id}>
                <td>{b.fileName}</td>
                <td>{b.platform}</td>
                <td className="num">{b.totalRows}</td>
                <td className="num">{b.newRows}</td>
                <td className="num">{b.duplicateRows}</td>
                <td className="muted">{new Date(b.importedAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stat">
        <div className="box"><div className="k">行数</div><div className="v">{rows.length}</div></div>
        <div className="box"><div className="k">已换算金额合计（仅已就绪行，CNY）</div><div className="v">{yuan(total)}</div></div>
      </div>

      <div className="panel">
        <div className="row-flex" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>平台原始行</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="ready">就绪</option>
            <option value="pending_match">待匹配作品</option>
            <option value="pending_rate">待补汇率</option>
            <option value="pending_contract">待补合同</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>平台 / 行号</th><th>ISRC</th><th>作品</th>
              <th>归属期间</th><th>原币金额</th><th>换算汇率</th>
              <th className="num">CNY(分)</th><th>状态</th><th>说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.platform}<div className="muted" style={{ fontSize: 11 }}>{r.platformLineId}</div></td>
                <td><code>{r.isrc}</code></td>
                <td>{r.trackTitle}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{r.periodStart}<br />~ {r.periodEnd}</td>
                <td className={Number(r.grossMajor) < 0 ? 'neg' : ''}>
                  {r.grossMajor} {r.currency}
                </td>
                <td>{r.rateSnapshot ?? '—'}</td>
                <td className={`num ${r.cnyCents && BigInt(r.cnyCents) < 0n ? 'neg' : ''}`}>
                  {r.cnyCents ? yuan(r.cnyCents) : '—'}
                </td>
                <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td className="note" style={{ whiteSpace: 'normal', maxWidth: 260 }}>{r.statusNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
