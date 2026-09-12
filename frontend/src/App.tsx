import { useState } from 'react';
import { ToastProvider } from './toast';
import BillsPage from './pages/BillsPage';
import PendingPage from './pages/PendingPage';
import CatalogPage from './pages/CatalogPage';
import BatchesPage from './pages/BatchesPage';
import BatchDetailPage from './pages/BatchDetailPage';
import LedgerPage from './pages/LedgerPage';

const TABS = [
  { key: 'bills', label: '① 平台账单' },
  { key: 'pending', label: '② 待处理区' },
  { key: 'catalog', label: '③ 作品/合同/汇率' },
  { key: 'batches', label: '④ 分账批次' },
  { key: 'ledger', label: '⑤ 创作者台账' },
];

export default function App() {
  const [tab, setTab] = useState('bills');
  const [batchId, setBatchId] = useState<string | null>(null);

  const go = (k: string) => {
    setBatchId(null);
    setTab(k);
  };

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <h1>独立音乐分账核算台</h1>
          <p className="sub">按归属期合同份额 · 总额守恒 · 全程可复核</p>
          <nav className="nav">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'active' : ''}
                onClick={() => go(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="main">
          {tab === 'bills' && <BillsPage />}
          {tab === 'pending' && <PendingPage />}
          {tab === 'catalog' && <CatalogPage />}
          {tab === 'batches' && (
            batchId ? (
              <BatchDetailPage id={batchId} onBack={() => setBatchId(null)} />
            ) : (
              <BatchesPage onOpen={(id) => { setBatchId(id); setTab('batches'); }} />
            )
          )}
          {tab === 'ledger' && <LedgerPage />}
        </main>
      </div>
    </ToastProvider>
  );
}
