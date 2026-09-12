export interface Creator {
  id: string;
  name: string;
  payoutAccount: string;
}
export interface Work {
  id: string;
  title: string;
  isrc: string;
  artist: string;
}
export interface ContractShare {
  creatorId: string;
  basisPoints: number;
  creator?: Creator;
}
export interface Contract {
  id: string;
  workId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  label: string;
  shares: ContractShare[];
}
export interface CurrencyRate {
  id: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rateToCny: string;
}
export type RowStatus =
  | 'ready'
  | 'pending_match'
  | 'pending_rate'
  | 'pending_contract';

export interface StatementRow {
  id: string;
  billImportId: string;
  platform: string;
  platformLineId: string;
  isrc: string;
  trackTitle: string;
  currency: string;
  grossMajor: string;
  periodStart: string;
  periodEnd: string;
  status: RowStatus;
  workId: string | null;
  rateSnapshot: string | null;
  grossCnyMajor: string | null;
  cnyCents: string | null;
  statusNote: string;
  billImport?: BillImport;
}
export interface BillImport {
  id: string;
  platform: string;
  fileName: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  importedAt: string;
}
export type BatchStatus = 'precomputed' | 'confirmed' | 'voided';
export interface Batch {
  id: string;
  label: string;
  status: BatchStatus;
  totalCnyCents: string;
  rowCount: number;
  allocationCount?: number;
  conservationVerified: boolean;
  createdAt: string;
  confirmedAt: string | null;
  voidedAt: string | null;
  note: string;
}
export interface Allocation {
  id: string;
  batchId: string;
  statementRowId: string;
  creatorId: string;
  creator: Creator;
  sliceIndex: number;
  sliceStart: string;
  sliceEnd: string;
  sliceDays: number;
  periodTotalDays: number;
  basisPoints: number;
  amountCnyCents: string;
  sliceCnyCents: string;
  sliceRemainderCents: string;
  contractLabel: string;
  statementRow: StatementRow;
}
export interface Payment {
  id: string;
  batchId: string;
  creatorId: string;
  creator?: Creator;
  amountCnyCents: string;
  status: 'pending_payout' | 'paid';
  payoutAccount: string;
  paidAt: string | null;
}
export interface BatchDetail {
  batch: Batch;
  allocations: Allocation[];
  creatorTotals: {
    creatorId: string;
    creatorName: string;
    amountCnyCents: string;
    lines: number;
  }[];
  payments: Payment[];
  conservation: {
    sumOfAllocations: string;
    batchTotal: string;
    ok: boolean;
  };
}
export interface LedgerLine extends Allocation {
  batchStatus: BatchStatus;
  rowCnyCents: string | null;
}
export interface Ledger {
  creator: Creator;
  totalCnyCents: string;
  lines: any[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  creators: () => req<Creator[]>('/api/catalog/creators'),
  createCreator: (b: { name: string; payoutAccount?: string }) =>
    req('/api/catalog/creators', { method: 'POST', body: JSON.stringify(b) }),
  works: () => req<Work[]>('/api/catalog/works'),
  createWork: (b: { title: string; isrc: string; artist?: string }) =>
    req('/api/catalog/works', { method: 'POST', body: JSON.stringify(b) }),
  contracts: (workId?: string) =>
    req<Contract[]>(`/api/catalog/contracts${workId ? `?workId=${workId}` : ''}`),
  createContract: (b: any) =>
    req('/api/catalog/contracts', { method: 'POST', body: JSON.stringify(b) }),
  rates: () => req<CurrencyRate[]>('/api/catalog/rates'),
  createRate: (b: any) =>
    req('/api/catalog/rates', { method: 'POST', body: JSON.stringify(b) }),
  pending: () => req<StatementRow[]>('/api/catalog/pending'),
  resolveIsrc: (rowId: string, b: any) =>
    req(`/api/catalog/pending/${rowId}/resolve-isrc`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  reprocess: () =>
    req('/api/catalog/pending/reprocess', { method: 'POST' }),
  imports: () => req<BillImport[]>('/api/imports'),
  rows: (status?: string) =>
    req<{ count: number; totalConvertedCny: string; rows: StatementRow[] }>(
      `/api/imports/rows${status ? `?status=${status}` : ''}`,
    ),
  availableRows: () => req<StatementRow[]>('/api/splits/available-rows'),
  precompute: (label: string, rowIds?: string[]) =>
    req('/api/splits/batches', {
      method: 'POST',
      body: JSON.stringify({ label, rowIds }),
    }),
  batches: () => req<Batch[]>('/api/splits/batches'),
  batch: (id: string) => req<BatchDetail>(`/api/splits/batches/${id}`),
  confirm: (id: string) =>
    req(`/api/splits/batches/${id}/confirm`, { method: 'POST' }),
  void: (id: string) =>
    req(`/api/splits/batches/${id}/void`, { method: 'POST' }),
  payments: (id: string) =>
    req(`/api/splits/batches/${id}/payments`, { method: 'POST' }),
  markPaid: (pid: string) =>
    req(`/api/splits/payments/${pid}/mark-paid`, { method: 'POST' }),
  ledger: (cid: string) =>
    req<Ledger>(`/api/splits/creators/${cid}/ledger`),
  upload: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/imports', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  },
};

/** CNY 分 -> 元 */
export function yuan(cents: string | number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const n = BigInt(cents as string);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const y = abs / 100n;
  const c = abs % 100n;
  return `${neg ? '-' : ''}¥${y}.${c.toString().padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<string, string> = {
  ready: '就绪',
  pending_match: '待匹配作品',
  pending_rate: '待补汇率',
  pending_contract: '待补合同',
  precomputed: '试算中',
  confirmed: '已确认',
  voided: '已作废',
  pending_payout: '待付款',
  paid: '已模拟付款',
};
