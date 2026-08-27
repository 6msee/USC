'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  activeBrokers,
  activeCashFlows,
  activeTrades,
  aggregateDaily,
  brokerName,
  cashFlowUsc,
  cashFlowThb,
  cashFlowUsd,
  netTradeUsc,
  signedCashFlowUsd,
  summarize,
  tradeThb,
  tradeUsd,
} from './calculations';
import { bangkokDate, createDemoData } from './demo-data';
import {
  hasPendingSync,
  fetchLatestFxRate,
  isCloudConfigured,
  loadLocalData,
  pullFromCloud,
  pushToCloud,
  saveLocalData,
  setPendingSync,
  testCloudConnection,
  type LatestFxRate,
} from './data-client';
import type {
  AppData,
  AppSection,
  AppSettings,
  BrokerAccount,
  CashFlowRecord,
  Currency,
  EditorState,
  TradeRecord,
} from './types';

type SyncState = 'demo' | 'saved' | 'syncing' | 'synced' | 'offline' | 'error';
type RecordView = 'all' | 'trade' | 'cash' | 'trash';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface OpeningCapitalInput {
  amount: number;
  currency: Currency;
  flowDate: string;
  usdThbRate: number;
}

const navItems: { id: AppSection; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'ภาพรวม', icon: '⌂' },
  { id: 'records', label: 'รายการ', icon: '↗' },
  { id: 'brokers', label: 'พอร์ต', icon: '◎' },
  { id: 'insights', label: 'รายงาน', icon: '✦' },
];

const currencyFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatUsd(value: number, sign = false): string {
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value < 0 ? '-' : ''}$${currencyFormatter.format(Math.abs(value))}`;
}

function formatThb(value: number, sign = false): string {
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value < 0 ? '-' : ''}฿${currencyFormatter.format(Math.abs(value))}`;
}

function formatUsc(value: number, sign = false): string {
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${compactFormatter.format(value)} USC`;
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(`${value}T00:00:00+07:00`).toLocaleDateString('th-TH', options || {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

function formatDateTime(value: string): string {
  if (!value) return 'ยังไม่เคยซิงก์';
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function shiftDate(date: string, offset: number): string {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return bangkokDate(parsed);
}

export default function GoldFlowApp() {
  const [data, setData] = useState<AppData>(() => createDemoData());
  const [section, setSection] = useState<AppSection>('dashboard');
  const [editor, setEditor] = useState<EditorState>({ kind: 'none' });
  const [selectedBroker, setSelectedBroker] = useState('all');
  const [recordView, setRecordView] = useState<RecordView>('all');
  const [search, setSearch] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('demo');
  const [toast, setToast] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [online, setOnline] = useState(true);
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const cached = loadLocalData();
    if (cached) {
      setData(cached);
      setSyncState(isCloudConfigured(cached.settings) ? (hasPendingSync() ? 'saved' : 'synced') : 'demo');
      if (navigator.onLine && isCloudConfigured(cached.settings)) void refreshRate(cached, false);
    } else {
      saveLocalData(dataRef.current);
    }

    const handleOnline = () => {
      setOnline(true);
      if (hasPendingSync() && isCloudConfigured(dataRef.current.settings)) void syncToCloud(dataRef.current, false);
      if (isCloudConfigured(dataRef.current.settings)) void refreshRate(dataRef.current, false);
    };
    const handleOffline = () => {
      setOnline(false);
      setSyncState('offline');
    };
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    setOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleInstall);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    }
    const rateTimer = window.setInterval(() => {
      if (navigator.onLine && isCloudConfigured(dataRef.current.settings)) void refreshRate(dataRef.current, false);
    }, 30 * 60 * 1000);
    const params = new URLSearchParams(window.location.search);
    const requestedSection = params.get('section');
    if (navItems.some((item) => item.id === requestedSection)) setSection(requestedSection as AppSection);
    if (params.get('action') === 'trade') setEditor({ kind: 'trade' });
    if (params.get('action') === 'cash') setEditor({ kind: 'cash' });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleInstall);
      window.clearInterval(rateTimer);
    };
  }, []);

  const brokers = useMemo(() => activeBrokers(data), [data]);
  const summary = useMemo(() => summarize(data, selectedBroker), [data, selectedBroker]);
  const allSummary = useMemo(() => summarize(data), [data]);
  const dailySeries = useMemo(() => aggregateDaily(
    activeTrades(data).filter((trade) => selectedBroker === 'all' || trade.brokerId === selectedBroker),
  ), [data, selectedBroker]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }

  async function syncToCloud(next: AppData, announce = true) {
    if (!isCloudConfigured(next.settings)) {
      setSyncState('demo');
      return;
    }
    if (!navigator.onLine) {
      setPendingSync(true);
      setSyncState('offline');
      if (announce) notify('บันทึกไว้ในเครื่องแล้ว จะซิงก์เมื่อออนไลน์');
      return;
    }
    setSyncState('syncing');
    try {
      const synced = await pushToCloud(next);
      setData((current) => ({
        ...current,
        settings: { ...current.settings, lastSyncedAt: synced.settings.lastSyncedAt },
      }));
      setSyncState('synced');
      if (announce) notify('ซิงก์กับ Google Sheets แล้ว');
    } catch {
      setPendingSync(true);
      setSyncState('error');
      if (announce) notify('บันทึกในเครื่องแล้ว แต่ยังซิงก์ไม่สำเร็จ');
    }
  }

  async function refreshRate(current: AppData, announce = true) {
    try {
      const latest = await fetchLatestFxRate(current.settings);
      const next = {
        ...current,
        settings: {
          ...current.settings,
          defaultFxRate: latest.usdThbRate,
          fxSource: `${latest.source} · ${latest.date}`,
        },
      };
      dataRef.current = next;
      setData(next);
      saveLocalData(next);
      if (announce) notify(`อัปเดตเรตล่าสุด $1 = ฿${latest.usdThbRate.toFixed(4)}`);
    } catch {
      if (announce) notify('ยังดึงเรตล่าสุดไม่ได้ ระบบใช้เรตที่บันทึกไว้ก่อน');
    }
  }

  function commit(next: AppData, message: string) {
    setData(next);
    saveLocalData(next);
    setPendingSync(isCloudConfigured(next.settings));
    setSyncState(isCloudConfigured(next.settings) ? 'saved' : 'demo');
    notify(message);
    if (isCloudConfigured(next.settings)) void syncToCloud(next, false);
  }

  async function syncNow(mode: 'push' | 'pull' = 'push') {
    if (!isCloudConfigured(data.settings)) {
      setEditor({ kind: 'settings' });
      notify('เพิ่มข้อมูลเชื่อมต่อ Google Sheets ก่อน');
      return;
    }
    setSyncState('syncing');
    try {
      const synced = mode === 'pull' ? await pullFromCloud(data) : await pushToCloud(data);
      setData(synced);
      setSyncState('synced');
      notify(mode === 'pull' ? 'ดึงข้อมูลล่าสุดจาก Google Sheets แล้ว' : 'ซิงก์ข้อมูลทั้งหมดแล้ว');
    } catch (error) {
      setSyncState('error');
      notify(error instanceof Error ? error.message : 'ซิงก์ไม่สำเร็จ');
    }
  }

  function saveTrade(record: TradeRecord) {
    const exists = data.trades.some((trade) => trade.id === record.id);
    const trades = exists ? data.trades.map((trade) => trade.id === record.id ? record : trade) : [record, ...data.trades];
    commit({ ...data, trades }, exists ? 'แก้ไขรายการเทรดแล้ว' : 'เพิ่มกำไรการเทรดแล้ว');
    setEditor({ kind: 'none' });
  }

  function saveCashFlow(record: CashFlowRecord) {
    const exists = data.cashFlows.some((flow) => flow.id === record.id);
    const cashFlows = exists ? data.cashFlows.map((flow) => flow.id === record.id ? record : flow) : [record, ...data.cashFlows];
    commit({ ...data, cashFlows }, exists ? 'แก้ไขรายการเงินทุนแล้ว' : 'เพิ่มรายการเงินทุนแล้ว');
    setEditor({ kind: 'none' });
  }

  function saveBroker(record: BrokerAccount, openingCapital?: OpeningCapitalInput) {
    const exists = data.brokers.some((broker) => broker.id === record.id);
    const nextBrokers = exists ? data.brokers.map((broker) => broker.id === record.id ? record : broker) : [record, ...data.brokers];
    const now = new Date().toISOString();
    const openingFlow: CashFlowRecord | null = !exists && openingCapital && openingCapital.amount > 0 ? {
      id: id('cash'),
      flowDate: openingCapital.flowDate,
      brokerId: record.id,
      type: 'deposit',
      amount: openingCapital.amount,
      currency: openingCapital.currency,
      uscPerUsd: record.uscPerUsd,
      usdThbRate: openingCapital.usdThbRate,
      note: 'เงินทุนเริ่มต้น',
      createdAt: now,
      updatedAt: now,
    } : null;
    commit({ ...data, brokers: nextBrokers, cashFlows: openingFlow ? [openingFlow, ...data.cashFlows] : data.cashFlows }, exists ? 'แก้ไขบัญชีโบรกเกอร์แล้ว' : openingFlow ? 'เพิ่มโบรกเกอร์และเงินทุนเริ่มต้นแล้ว' : 'เพิ่มบัญชีโบรกเกอร์แล้ว');
    setEditor({ kind: 'none' });
  }

  function saveSettings(settings: AppSettings) {
    const next = { ...data, settings };
    commit(next, 'บันทึกการตั้งค่าแล้ว');
    if (isCloudConfigured(settings)) void refreshRate(next, true);
    setEditor({ kind: 'none' });
  }

  function softDelete(kind: 'trade' | 'cash', recordId: string) {
    if (!window.confirm('ย้ายรายการนี้ไปถังขยะหรือไม่? สามารถกู้คืนได้ภายหลัง')) return;
    const now = new Date().toISOString();
    const next = kind === 'trade'
      ? { ...data, trades: data.trades.map((item) => item.id === recordId ? { ...item, deletedAt: now, updatedAt: now } : item) }
      : { ...data, cashFlows: data.cashFlows.map((item) => item.id === recordId ? { ...item, deletedAt: now, updatedAt: now } : item) };
    commit(next, 'ย้ายรายการไปถังขยะแล้ว');
  }

  function restore(kind: 'trade' | 'cash', recordId: string) {
    const now = new Date().toISOString();
    const next = kind === 'trade'
      ? { ...data, trades: data.trades.map((item) => item.id === recordId ? { ...item, deletedAt: undefined, updatedAt: now } : item) }
      : { ...data, cashFlows: data.cashFlows.map((item) => item.id === recordId ? { ...item, deletedAt: undefined, updatedAt: now } : item) };
    commit(next, 'กู้คืนรายการแล้ว');
  }

  function archiveBroker(record: BrokerAccount) {
    const hasRecords = data.trades.some((item) => item.brokerId === record.id) || data.cashFlows.some((item) => item.brokerId === record.id);
    const now = new Date().toISOString();
    const updated = hasRecords
      ? { ...record, isActive: false, updatedAt: now }
      : { ...record, deletedAt: now, updatedAt: now };
    commit({ ...data, brokers: data.brokers.map((item) => item.id === record.id ? updated : item) }, hasRecords ? 'เก็บบัญชีที่มีประวัติไว้แล้ว' : 'ลบบัญชีโบรกเกอร์แล้ว');
  }

  function exportCsv() {
    const rows = [
      ['ชนิด', 'วันที่', 'โบรกเกอร์', 'สัญลักษณ์/ประเภท', 'USC', 'USD', 'THB', 'อัตรา USD/THB', 'หมายเหตุ'],
      ...activeTrades(data).map((trade) => [
        'เทรด', trade.tradeDate, brokerName(data, trade.brokerId), trade.symbol,
        netTradeUsc(trade), tradeUsd(trade), tradeThb(trade), trade.usdThbRate, trade.note,
      ]),
      ...activeCashFlows(data).map((flow) => [
        'เงินทุน', flow.flowDate, brokerName(data, flow.brokerId), flow.type,
        cashFlowUsc(flow) * (flow.type === 'withdrawal' ? -1 : 1), signedCashFlowUsd(flow),
        signedCashFlowUsd(flow) * flow.usdThbRate, flow.usdThbRate, flow.note,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `farmcent-${bangkokDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify('ส่งออก CSV แล้ว');
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
      return;
    }
    notify('บน iPhone: แตะ แชร์ → เพิ่มไปยังหน้าจอโฮม');
  }

  const todayLabel = formatDate(bangkokDate(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const status = syncLabel(syncState, online, isCloudConfigured(data.settings));

  return (
    <main className="min-h-screen pb-28 text-[#15161a] md:pb-12">
      <header className="topbar">
        <button className="brand-button" type="button" onClick={() => setSection('dashboard')} aria-label="กลับหน้าภาพรวม">
          <span className="logo-orb" aria-hidden="true">G</span>
          <span>
            <span className="brand-kicker">XAUUSDc Journal</span>
            <span className="brand-name">ฟามCENT</span>
          </span>
        </button>

        <nav className="desktop-nav" aria-label="เมนูหลัก">
          {navItems.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <button className={`sync-chip sync-${syncState}`} type="button" onClick={() => void syncNow('push')}>
            <span className="sync-dot" />
            <span className="hidden sm:inline">{status}</span>
          </button>
          <button className="avatar" aria-label="เปิดการตั้งค่า" onClick={() => setEditor({ kind: 'settings' })}>
            {(data.settings.profileName || 'G').slice(0, 1)}
          </button>
        </div>
      </header>

      {section === 'dashboard' && (
        <Dashboard
          data={data}
          summary={summary}
          allSummary={allSummary}
          selectedBroker={selectedBroker}
          setSelectedBroker={setSelectedBroker}
          brokers={brokers}
          dailySeries={dailySeries}
          todayLabel={todayLabel}
          onAddTrade={() => setEditor({ kind: 'trade' })}
          onAddCash={() => setEditor({ kind: 'cash' })}
          onAddBroker={() => setEditor({ kind: 'broker' })}
          onOpenRecords={() => setSection('records')}
        />
      )}

      {section === 'records' && (
        <Records
          data={data}
          brokers={brokers}
          view={recordView}
          setView={setRecordView}
          search={search}
          setSearch={setSearch}
          selectedBroker={selectedBroker}
          setSelectedBroker={setSelectedBroker}
          onAddTrade={() => setEditor({ kind: 'trade' })}
          onAddCash={() => setEditor({ kind: 'cash' })}
          onEditTrade={(record) => setEditor({ kind: 'trade', record })}
          onEditCash={(record) => setEditor({ kind: 'cash', record })}
          onDelete={softDelete}
          onRestore={restore}
        />
      )}

      {section === 'brokers' && (
        <Brokers
          data={data}
          brokers={brokers}
          onAdd={() => setEditor({ kind: 'broker' })}
          onEdit={(record) => setEditor({ kind: 'broker', record })}
          onArchive={archiveBroker}
        />
      )}

      {section === 'insights' && (
        <Insights
          data={data}
          summary={allSummary}
          series={aggregateDaily(activeTrades(data))}
          cloudConfigured={isCloudConfigured(data.settings)}
          onSettings={() => setEditor({ kind: 'settings' })}
          onInstall={() => void installApp()}
          onExport={exportCsv}
          onSync={() => void syncNow('pull')}
        />
      )}

      <nav className="mobile-nav md:hidden" aria-label="เมนูหลักบนมือถือ">
        {navItems.slice(0, 2).map((item) => (
          <button key={item.id} className={section === item.id ? 'mobile-nav-active' : ''} type="button" onClick={() => setSection(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
        <button className="mobile-add" type="button" aria-label="เพิ่มรายการ" onClick={() => setAddMenuOpen((value) => !value)}>＋</button>
        {navItems.slice(2).map((item) => (
          <button key={item.id} className={section === item.id ? 'mobile-nav-active' : ''} type="button" onClick={() => setSection(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>

      {addMenuOpen && (
        <div className="quick-add-menu">
          <button type="button" onClick={() => { setEditor({ kind: 'trade' }); setAddMenuOpen(false); }}>↗ บันทึกกำไรเทรด</button>
          <button type="button" onClick={() => { setEditor({ kind: 'cash' }); setAddMenuOpen(false); }}>＋ เงินฝาก / ถอน</button>
        </div>
      )}

      {editor.kind !== 'none' && (
        <EditorModal
          editor={editor}
          data={data}
          onClose={() => setEditor({ kind: 'none' })}
          onSaveTrade={saveTrade}
          onSaveCash={saveCashFlow}
          onSaveBroker={saveBroker}
          onSaveSettings={saveSettings}
          onTestConnection={testCloudConnection}
          onFetchRate={fetchLatestFxRate}
        />
      )}

      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function syncLabel(state: SyncState, online: boolean, configured: boolean): string {
  if (!online) return 'ออฟไลน์ · บันทึกในเครื่อง';
  if (!configured) return 'โหมดตัวอย่าง';
  if (state === 'syncing') return 'กำลังซิงก์…';
  if (state === 'error') return 'รอซิงก์ใหม่';
  if (state === 'saved') return 'บันทึกแล้ว · รอซิงก์';
  return 'Google Sheets ซิงก์แล้ว';
}

function Dashboard({
  data, summary, allSummary, selectedBroker, setSelectedBroker, brokers, dailySeries, todayLabel,
  onAddTrade, onAddCash, onAddBroker, onOpenRecords,
}: {
  data: AppData;
  summary: ReturnType<typeof summarize>;
  allSummary: ReturnType<typeof summarize>;
  selectedBroker: string;
  setSelectedBroker: (value: string) => void;
  brokers: BrokerAccount[];
  dailySeries: ReturnType<typeof aggregateDaily>;
  todayLabel: string;
  onAddTrade: () => void;
  onAddCash: () => void;
  onAddBroker: () => void;
  onOpenRecords: () => void;
}) {
  const growth = summary.netCapitalUsc ? (summary.cumulativeProfitUsc / summary.netCapitalUsc) * 100 : 0;
  const metrics = [
    { label: 'กำไรวันนี้', value: formatUsc(summary.todayProfitUsc, true), sub: `${formatUsd(summary.todayProfitUsd, true)} · ${formatThb(summary.todayProfitUsd * summary.fxRate, true)}`, tone: 'metric-lime', mark: '↗' },
    { label: 'กำไรเดือนนี้', value: formatUsc(summary.monthProfitUsc, true), sub: `${formatUsd(summary.monthProfitUsd, true)} · ${formatThb(summary.monthProfitUsd * summary.fxRate, true)}`, tone: 'metric-blue', mark: '◌' },
    { label: 'กำไรสะสม', value: formatUsc(summary.cumulativeProfitUsc, true), sub: `${formatUsd(summary.cumulativeProfitUsd, true)} · ${formatThb(summary.cumulativeProfitUsd * summary.fxRate, true)}`, tone: 'metric-violet', mark: '✦' },
    { label: 'ยอดพอร์ตรวม', value: formatUsc(summary.portfolioUsc), sub: `${formatUsd(summary.portfolioUsd)} · ${formatThb(summary.portfolioUsd * summary.fxRate)}`, tone: 'metric-orange', mark: '◎' },
  ];
  const recent = combinedRecords(data).slice(0, 4);

  return (
    <div className="page-shell">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">{todayLabel}</p>
          <h1>สวัสดีคุณ{data.settings.profileName || 'นักเทรด'} <span aria-hidden="true">👋🏻</span></h1>
        </div>
        <select className="soft-select" value={selectedBroker} onChange={(event) => setSelectedBroker(event.target.value)} aria-label="เลือกบัญชีโบรกเกอร์">
          <option value="all">ทุกบัญชี</option>
          {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.brokerName} · {broker.accountName}</option>)}
        </select>
      </div>

      {!brokers.length && (
        <section className="onboarding-card">
          <div className="onboarding-icon">◎</div>
          <div><p className="eyebrow">เริ่มใช้งานครั้งแรก</p><h2>เพิ่มโบรกเกอร์และเงินทุนเริ่มต้นครั้งเดียว</h2><span>หลังจากนั้นเพิ่มทุนในพอร์ตเดิมได้เรื่อย ๆ พร้อมบันทึกกำไร/ขาดทุน ค่าธรรมเนียม และการถอน ระบบจะคำนวณรายงานให้เอง</span></div>
          <button className="dark-button" type="button" onClick={onAddBroker}>＋ ตั้งค่ากระเป๋าแรก</button>
        </section>
      )}

      <section className="hero-card">
        <div className="hero-content">
          <div>
            <div className="hero-label"><span /> 100 USC = $1.00 · $1 = ฿{summary.fxRate.toFixed(4)}</div>
            <p className="hero-caption">ยอดพอร์ตทั้งหมด</p>
            <div className="hero-total">
              <strong>{formatUsc(summary.portfolioUsc)}</strong>
              <span>≈ {formatUsd(summary.portfolioUsd)} · {formatThb(summary.portfolioUsd * summary.fxRate)}</span>
            </div>
            <p className="hero-growth">ผลตอบแทน <strong>{growth >= 0 ? '+' : ''}{growth.toFixed(2)}%</strong> จากเงินทุนสุทธิ {formatUsc(summary.netCapitalUsc)} <span>· เรต {data.settings.fxSource}</span></p>
          </div>
          <div className="hero-actions">
            <button className="secondary-hero-button" type="button" onClick={onAddCash}>เพิ่มทุน / ถอนทุน</button>
            <button className="primary-button" type="button" onClick={onAddTrade}><span>＋</span> เพิ่มกำไรวันนี้</button>
          </div>
        </div>
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
      </section>

      <section className="metric-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className={`metric-card ${metric.tone}`}>
            <div className="metric-top"><p>{metric.label}</p><span>{metric.mark}</span></div>
            <strong className={metric.value.includes('-') ? 'amount-negative' : ''}>{metric.value}</strong>
            <p className="metric-sub">{metric.sub}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="glass-card chart-card">
          <div className="card-heading">
            <div><p className="eyebrow">Performance</p><h2>แนวโน้มกำไรรายวัน</h2><p>คำนวณจากกำไรสุทธิหลังค่าธรรมเนียม</p></div>
            <span className="tiny-badge">{dailySeries.length} วันเทรด</span>
          </div>
          <ProfitBars series={dailySeries.slice(-14)} />
          <div className="inline-stats">
            <span><b className="violet-text">{formatUsc(summary.averageTradingDayUsc)}</b> เฉลี่ย/วันเทรด</span>
            <span><b className="green-text">{summary.winDayRate.toFixed(0)}%</b> วันที่ทำกำไร</span>
            <span><b className="orange-text">{formatUsc(summary.bestDayUsc)}</b> วันที่ดีที่สุด</span>
          </div>
        </article>

        <article className="glass-card activity-card">
          <div className="card-heading horizontal">
            <div><p className="eyebrow">Latest activity</p><h2>รายการล่าสุด</h2></div>
            <button className="text-button" type="button" onClick={onOpenRecords}>ดูทั้งหมด</button>
          </div>
          <div className="activity-list">
            {recent.length ? recent.map((item) => <ActivityRow key={`${item.kind}-${item.record.id}`} data={data} item={item} />) : <EmptyState compact />}
          </div>
        </article>
      </section>

      <section className="goal-grid">
        <GoalCard label="เป้ากำไรรายวัน" value={allSummary.todayProfitUsc} target={data.settings.dailyTargetUsc} tone="lime" />
        <GoalCard label="เป้ากำไรเดือนนี้" value={allSummary.monthProfitUsc} target={data.settings.monthlyTargetUsc} tone="violet" />
        <article className="glass-card capital-summary">
          <div className="capital-icon">฿</div>
          <div><p>กระแสเงินทุนสุทธิ</p><strong>{formatUsc(allSummary.netCapitalUsc)}</strong><span>ฝาก {formatUsc(allSummary.depositsUsc)} · ถอน {formatUsc(allSummary.withdrawalsUsc)}</span></div>
        </article>
      </section>
    </div>
  );
}

function ProfitBars({ series }: { series: ReturnType<typeof aggregateDaily> }) {
  if (!series.length) return <EmptyState compact />;
  const max = Math.max(...series.map((item) => Math.abs(item.profitUsc)), 1);
  return (
    <div className="profit-chart" role="img" aria-label="กราฟกำไรรายวัน">
      {series.map((item) => {
        const height = Math.max(10, Math.round((Math.abs(item.profitUsc) / max) * 100));
        return (
          <div className="bar-column" key={item.date} title={`${formatDate(item.date)}: ${formatUsc(item.profitUsc, true)}`}>
            <div className={`profit-bar ${item.profitUsc < 0 ? 'negative' : ''}`} style={{ '--bar-height': `${height}%` } as CSSProperties} />
            <span>{new Date(`${item.date}T00:00:00+07:00`).getDate()}</span>
          </div>
        );
      })}
    </div>
  );
}

function GoalCard({ label, value, target, tone }: { label: string; value: number; target: number; tone: 'lime' | 'violet' }) {
  const percent = target > 0 ? (value / target) * 100 : 0;
  return (
    <article className={`goal-card goal-${tone}`}>
      <div><p>{label}</p><strong>{formatUsc(value, true)}</strong></div>
      <span>{clampPercent(percent).toFixed(0)}%</span>
      <div className="goal-track"><i style={{ width: `${clampPercent(percent)}%` }} /></div>
      <small>เป้าหมาย {formatUsc(target)}</small>
    </article>
  );
}

type CombinedItem = { kind: 'trade'; record: TradeRecord } | { kind: 'cash'; record: CashFlowRecord };

function combinedRecords(data: AppData, includeDeleted = false): CombinedItem[] {
  const trades: CombinedItem[] = data.trades.filter((item) => includeDeleted ? item.deletedAt : !item.deletedAt).map((record) => ({ kind: 'trade', record }));
  const cash: CombinedItem[] = data.cashFlows.filter((item) => includeDeleted ? item.deletedAt : !item.deletedAt).map((record) => ({ kind: 'cash', record }));
  return [...trades, ...cash].sort((a, b) => {
    const dateA = a.kind === 'trade' ? a.record.tradeDate : a.record.flowDate;
    const dateB = b.kind === 'trade' ? b.record.tradeDate : b.record.flowDate;
    return dateB.localeCompare(dateA) || b.record.updatedAt.localeCompare(a.record.updatedAt);
  });
}

function ActivityRow({ data, item }: { data: AppData; item: CombinedItem }) {
  const isTrade = item.kind === 'trade';
  const usd = isTrade ? tradeUsd(item.record) : signedCashFlowUsd(item.record);
  const usc = isTrade ? netTradeUsc(item.record) : cashFlowUsc(item.record) * (item.record.type === 'withdrawal' ? -1 : 1);
  const thb = isTrade ? tradeThb(item.record) : usd * item.record.usdThbRate;
  const date = isTrade ? item.record.tradeDate : item.record.flowDate;
  const label = isTrade ? item.record.symbol : item.record.type === 'deposit' ? 'ฝากเงินทุน' : item.record.type === 'withdrawal' ? 'ถอนเงิน' : 'ปรับยอด';
  return (
    <div className="activity-row">
      <div className={`activity-icon ${isTrade ? (usd >= 0 ? 'activity-positive' : 'activity-negative') : 'activity-cash'}`}>{isTrade ? (usd >= 0 ? '↗' : '↘') : (usd >= 0 ? '＋' : '↓')}</div>
      <div className="activity-copy"><p>{label} · {brokerName(data, item.record.brokerId)}</p><span>{formatDate(date)}</span></div>
      <div className="activity-amount"><strong className={usc < 0 ? 'amount-negative' : 'amount-positive'}>{formatUsc(usc, true)}</strong><span>{formatUsd(usd, true)} · {formatThb(thb, true)}</span></div>
    </div>
  );
}

function Records({
  data, brokers, view, setView, search, setSearch, selectedBroker, setSelectedBroker,
  onAddTrade, onAddCash, onEditTrade, onEditCash, onDelete, onRestore,
}: {
  data: AppData;
  brokers: BrokerAccount[];
  view: RecordView;
  setView: (value: RecordView) => void;
  search: string;
  setSearch: (value: string) => void;
  selectedBroker: string;
  setSelectedBroker: (value: string) => void;
  onAddTrade: () => void;
  onAddCash: () => void;
  onEditTrade: (record: TradeRecord) => void;
  onEditCash: (record: CashFlowRecord) => void;
  onDelete: (kind: 'trade' | 'cash', recordId: string) => void;
  onRestore: (kind: 'trade' | 'cash', recordId: string) => void;
}) {
  const records = useMemo(() => {
    const source = combinedRecords(data, view === 'trash');
    return source.filter((item) => {
      if (view === 'trade' && item.kind !== 'trade') return false;
      if (view === 'cash' && item.kind !== 'cash') return false;
      if (selectedBroker !== 'all' && item.record.brokerId !== selectedBroker) return false;
      const text = `${brokerName(data, item.record.brokerId)} ${item.kind === 'trade' ? `${item.record.symbol} ${item.record.note}` : item.record.note}`.toLowerCase();
      return text.includes(search.trim().toLowerCase());
    });
  }, [data, view, selectedBroker, search]);

  return (
    <div className="page-shell">
      <div className="section-heading-row">
        <div><p className="section-kicker">Trading ledger</p><h1>รายการทั้งหมด</h1><p className="section-description">กำไร เงินฝาก ถอน และการปรับยอด แยกจากกันอย่างชัดเจน</p></div>
        <div className="heading-actions"><button className="soft-button" type="button" onClick={onAddCash}>เพิ่มทุน / ถอนทุน</button><button className="dark-button" type="button" onClick={onAddTrade}>＋ เพิ่มรายการเทรด</button></div>
      </div>

      <div className="records-toolbar glass-card">
        <div className="segmented-control">
          {([['all', 'ทั้งหมด'], ['trade', 'การเทรด'], ['cash', 'เงินทุน'], ['trash', 'ถังขยะ']] as [RecordView, string][]).map(([key, label]) => (
            <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>
          ))}
        </div>
        <div className="record-filters">
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารายการ…" /></label>
          <select className="soft-select" value={selectedBroker} onChange={(event) => setSelectedBroker(event.target.value)}>
            <option value="all">ทุกบัญชี</option>
            {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.brokerName}</option>)}
          </select>
        </div>
      </div>

      <div className="records-list glass-card">
        <div className="records-header"><span>วันที่ / รายการ</span><span>บัญชี</span><span>USC</span><span>USD / THB</span><span>จัดการ</span></div>
        {records.length ? records.map((item) => {
          const isTrade = item.kind === 'trade';
          const usd = isTrade ? tradeUsd(item.record) : signedCashFlowUsd(item.record);
          const thb = isTrade ? tradeThb(item.record) : usd * item.record.usdThbRate;
          const date = isTrade ? item.record.tradeDate : item.record.flowDate;
          const usc = isTrade ? netTradeUsc(item.record) : cashFlowUsc(item.record) * (item.record.type === 'withdrawal' ? -1 : 1);
          return (
            <div className="record-row" key={`${item.kind}-${item.record.id}`}>
              <div className="record-primary"><span className={`activity-icon ${usd >= 0 ? 'activity-positive' : 'activity-negative'}`}>{isTrade ? (usd >= 0 ? '↗' : '↘') : (usd >= 0 ? '＋' : '↓')}</span><div><strong>{isTrade ? item.record.symbol : item.record.type === 'deposit' ? 'ฝากเงินทุน' : item.record.type === 'withdrawal' ? 'ถอนเงิน' : 'ปรับยอด'}</strong><span>{formatDate(date)}{item.record.note ? ` · ${item.record.note}` : ''}</span></div></div>
              <div className="record-cell"><span className="mobile-cell-label">บัญชี</span><strong>{brokerName(data, item.record.brokerId)}</strong></div>
              <div className="record-cell"><span className="mobile-cell-label">USC</span><strong className={usd < 0 ? 'amount-negative' : 'amount-positive'}>{formatUsc(usc, true)}</strong></div>
              <div className="record-cell"><span className="mobile-cell-label">มูลค่า</span><strong className={usd < 0 ? 'amount-negative' : 'amount-positive'}>{formatUsd(usd, true)}</strong><small>{formatThb(thb, true)}</small></div>
              <div className="record-actions">
                {view === 'trash' ? <button type="button" onClick={() => onRestore(item.kind, item.record.id)}>กู้คืน</button> : <><button type="button" onClick={() => isTrade ? onEditTrade(item.record) : onEditCash(item.record)}>แก้ไข</button><button className="danger-text" type="button" onClick={() => onDelete(item.kind, item.record.id)}>ลบ</button></>}
              </div>
            </div>
          );
        }) : <EmptyState />}
      </div>
    </div>
  );
}

function Brokers({ data, brokers, onAdd, onEdit, onArchive }: { data: AppData; brokers: BrokerAccount[]; onAdd: () => void; onEdit: (record: BrokerAccount) => void; onArchive: (record: BrokerAccount) => void }) {
  return (
    <div className="page-shell">
      <div className="section-heading-row">
        <div><p className="section-kicker">Broker accounts</p><h1>โบรกเกอร์และพอร์ต</h1><p className="section-description">จัดการบัญชี USC/USD และอัตราแปลงของแต่ละโบรกเกอร์</p></div>
        <button className="dark-button" type="button" onClick={onAdd}>＋ เพิ่มบัญชีโบรกเกอร์</button>
      </div>
      <section className="broker-grid">
        {brokers.map((broker, index) => {
          const brokerSummary = summarize(data, broker.id);
          return (
            <article className={`broker-card broker-tone-${index % 4}`} key={broker.id}>
              <div className="broker-card-top"><div className="broker-logo">{broker.brokerName.slice(0, 1).toUpperCase()}</div><span className={broker.isActive ? 'status-active' : 'status-archived'}>{broker.isActive ? 'ใช้งาน' : 'เก็บถาวร'}</span></div>
              <p>{broker.brokerName}</p><h2>{broker.accountName}</h2><span className="account-number">{broker.accountNumberMasked || 'ไม่ระบุเลขบัญชี'} · {broker.accountUnit}</span>
              <div className="broker-balance"><small>ยอดพอร์ตตามระบบ</small><strong>{formatUsc(brokerSummary.portfolioUsc)}</strong><span>{formatUsd(brokerSummary.portfolioUsd)} · {formatThb(brokerSummary.portfolioUsd * data.settings.defaultFxRate)}</span></div>
              <div className="broker-stats"><span><small>กำไรสะสม</small><b className={brokerSummary.cumulativeProfitUsc < 0 ? 'amount-negative' : 'amount-positive'}>{formatUsc(brokerSummary.cumulativeProfitUsc, true)}</b></span><span><small>ทุนสุทธิ</small><b>{formatUsc(brokerSummary.netCapitalUsc)}</b></span></div>
              <div className="broker-actions"><button type="button" onClick={() => onEdit(broker)}>แก้ไข</button><button className="danger-text" type="button" onClick={() => onArchive(broker)}>{brokerSummary.tradingDays ? 'เก็บถาวร' : 'ลบ'}</button></div>
            </article>
          );
        })}
        {!brokers.length && <button className="empty-broker-card" type="button" onClick={onAdd}>＋ เพิ่มบัญชีโบรกเกอร์แรก</button>}
      </section>
      <article className="glass-card formula-note"><div className="formula-icon">i</div><div><strong>สูตรยอดพอร์ต</strong><p>เงินฝาก − เงินถอน + กำไรสุทธิจากการเทรด การถอนจะไม่ถูกนับเป็นขาดทุน และการฝากจะไม่ถูกนับเป็นกำไร</p></div></article>
    </div>
  );
}

function Insights({ data, summary, series, cloudConfigured, onSettings, onInstall, onExport, onSync }: { data: AppData; summary: ReturnType<typeof summarize>; series: ReturnType<typeof aggregateDaily>; cloudConfigured: boolean; onSettings: () => void; onInstall: () => void; onExport: () => void; onSync: () => void }) {
  const calendar = useMemo(() => {
    const map = new Map(series.map((item) => [item.date, item.profitUsc]));
    const today = bangkokDate();
    return Array.from({ length: 35 }, (_, index) => {
      const date = shiftDate(today, index - 34);
      return { date, value: map.get(date) || 0 };
    });
  }, [series]);
  const maxHeat = Math.max(...calendar.map((item) => Math.abs(item.value)), 1);
  const streakLabel = summary.currentStreak > 0 ? `กำไรต่อเนื่อง ${summary.currentStreak} วัน` : summary.currentStreak < 0 ? `ขาดทุนต่อเนื่อง ${Math.abs(summary.currentStreak)} วัน` : 'ยังไม่มี streak';

  return (
    <div className="page-shell">
      <div className="section-heading-row"><div><p className="section-kicker">Automatic report</p><h1>รายงานสรุป</h1><p className="section-description">ระบบคำนวณยอด USC, USD, บาท กำไร ขาดทุน และเงินทุนให้ทั้งหมด</p></div><button className="soft-button" type="button" onClick={onExport}>⇩ ส่งออก CSV</button></div>
      <section className="insight-stat-grid">
        <StatCard label="Win rate รายวัน" value={`${summary.winDayRate.toFixed(1)}%`} note={`${summary.profitableDays} วันกำไร · ${summary.losingDays} วันขาดทุน`} tone="lime" />
        <StatCard label="Best day" value={formatUsc(summary.bestDayUsc, true)} note="กำไรสุทธิสูงสุดในวันเดียว" tone="blue" />
        <StatCard label="Max drawdown" value={formatUsc(-summary.maxDrawdownUsc)} note="คำนวณจาก equity curve" tone="orange" />
        <StatCard label="Current streak" value={`${Math.abs(summary.currentStreak)} วัน`} note={streakLabel} tone="violet" />
      </section>
      <section className="insights-layout">
        <article className="glass-card heatmap-card">
          <div className="card-heading"><div><p className="eyebrow">Consistency</p><h2>ปฏิทินกำไร 5 สัปดาห์</h2><p>สีเข้มขึ้นเมื่อกำไรหรือขาดทุนมากขึ้น</p></div></div>
          <div className="heatmap-grid">
            {calendar.map((item) => {
              const intensity = Math.max(.14, Math.abs(item.value) / maxHeat);
              const style = { '--heat-alpha': intensity } as CSSProperties;
              return <div key={item.date} className={`heat-cell ${item.value > 0 ? 'heat-positive' : item.value < 0 ? 'heat-negative' : 'heat-empty'}`} style={style} title={`${formatDate(item.date)}: ${formatUsc(item.value, true)}`}><span>{new Date(`${item.date}T00:00:00+07:00`).getDate()}</span></div>;
            })}
          </div>
          <div className="heatmap-legend"><span>ขาดทุน</span><i className="legend-loss" /><i className="legend-empty" /><i className="legend-profit" /><span>กำไร</span></div>
        </article>
        <article className="glass-card allocation-card">
          <div className="card-heading"><div><p className="eyebrow">Portfolio mix</p><h2>องค์ประกอบพอร์ต</h2></div></div>
          <div className="donut" style={{ '--profit-angle': `${clampPercent(summary.portfolioUsc ? (summary.cumulativeProfitUsc / summary.portfolioUsc) * 100 : 0) * 3.6}deg` } as CSSProperties}><div><span>ยอดรวม</span><strong>{formatUsc(summary.portfolioUsc)}</strong></div></div>
          <div className="allocation-legend"><span><i className="capital-dot" /> เงินทุนสุทธิ <b>{formatUsc(summary.netCapitalUsc)}</b></span><span><i className="profit-dot" /> กำไรสะสม <b>{formatUsc(summary.cumulativeProfitUsc)}</b></span></div>
        </article>
      </section>
      <section className="tool-grid">
        <ToolCard icon="▦" title="Google Sheets" description={cloudConfigured ? `ซิงก์ล่าสุด ${formatDateTime(data.settings.lastSyncedAt)}` : 'เชื่อมฐานข้อมูลส่วนตัวเพื่อเก็บข้อมูลถาวร'} action={cloudConfigured ? 'ดึงข้อมูลล่าสุด' : 'เชื่อมต่อ'} onClick={cloudConfigured ? onSync : onSettings} tone="green" />
        <ToolCard icon="▣" title="ติดตั้งบนมือถือ" description="เปิดเหมือนแอป ใช้เต็มหน้าจอ และบันทึกออฟไลน์ได้" action="ติดตั้ง PWA" onClick={onInstall} tone="violet" />
        <ToolCard icon="⇩" title="สำรองข้อมูล" description="ดาวน์โหลดรายการทั้งหมดเป็น CSV ที่เปิดใน Excel ได้" action="ส่งออกตอนนี้" onClick={onExport} tone="orange" />
      </section>
    </div>
  );
}

function StatCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={`stat-card stat-${tone}`}><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}

function ToolCard({ icon, title, description, action, onClick, tone }: { icon: string; title: string; description: string; action: string; onClick: () => void; tone: string }) {
  return <article className="glass-card tool-card"><div className={`tool-icon tool-${tone}`}>{icon}</div><div><h3>{title}</h3><p>{description}</p></div><button type="button" onClick={onClick}>{action}</button></article>;
}

function EmptyState({ compact = false }: { compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><span>✦</span><strong>ยังไม่มีรายการ</strong><p>เพิ่มข้อมูลแรกเพื่อเริ่มดูผลลัพธ์ของคุณ</p></div>;
}

function EditorModal({ editor, data, onClose, onSaveTrade, onSaveCash, onSaveBroker, onSaveSettings, onTestConnection, onFetchRate }: {
  editor: Exclude<EditorState, { kind: 'none' }>;
  data: AppData;
  onClose: () => void;
  onSaveTrade: (record: TradeRecord) => void;
  onSaveCash: (record: CashFlowRecord) => void;
  onSaveBroker: (record: BrokerAccount, openingCapital?: OpeningCapitalInput) => void;
  onSaveSettings: (settings: AppSettings) => void;
  onTestConnection: (settings: AppSettings) => Promise<string>;
  onFetchRate: (settings: AppSettings) => Promise<LatestFxRate>;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-sheet" role="dialog" aria-modal="true">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิด">×</button>
        {editor.kind === 'trade' && <TradeForm data={data} record={editor.record} onSave={onSaveTrade} onClose={onClose} />}
        {editor.kind === 'cash' && <CashForm data={data} record={editor.record} onSave={onSaveCash} onClose={onClose} />}
        {editor.kind === 'broker' && <BrokerForm record={editor.record} defaultFxRate={data.settings.defaultFxRate} onSave={onSaveBroker} onClose={onClose} />}
        {editor.kind === 'settings' && <SettingsForm settings={data.settings} onSave={onSaveSettings} onClose={onClose} onTest={onTestConnection} onFetchRate={onFetchRate} />}
      </div>
    </div>
  );
}

function TradeForm({ data, record, onSave, onClose }: { data: AppData; record?: TradeRecord; onSave: (record: TradeRecord) => void; onClose: () => void }) {
  const brokers = activeBrokers(data).filter((broker) => broker.isActive || broker.id === record?.brokerId);
  const fallbackBroker = brokers[0];
  const [values, setValues] = useState({
    tradeDate: record?.tradeDate || bangkokDate(),
    brokerId: record?.brokerId || fallbackBroker?.id || '',
    symbol: record?.symbol || 'XAUUSDc',
    grossProfitUsc: String(record?.grossProfitUsc ?? ''),
    commissionUsc: String(Math.abs(record?.commissionUsc ?? 0)),
    swapUsc: String(record?.swapUsc ?? 0),
    otherFeeUsc: String(Math.abs(record?.otherFeeUsc ?? 0)),
    usdThbRate: String(record?.usdThbRate ?? data.settings.defaultFxRate),
    note: record?.note || '',
  });
  const selected = brokers.find((broker) => broker.id === values.brokerId) || fallbackBroker;
  const netUsc = Number(values.grossProfitUsc || 0) - Math.abs(Number(values.commissionUsc || 0)) + Number(values.swapUsc || 0) - Math.abs(Number(values.otherFeeUsc || 0));
  const netUsd = netUsc / Math.max(selected?.uscPerUsd || 100, 1);
  const netThb = netUsd * Number(values.usdThbRate || 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.brokerId || !values.tradeDate || !Number.isFinite(Number(values.grossProfitUsc))) return;
    const now = new Date().toISOString();
    onSave({
      id: record?.id || id('trade'), tradeDate: values.tradeDate, brokerId: values.brokerId,
      symbol: values.symbol.trim() || 'XAUUSDc', grossProfitUsc: Number(values.grossProfitUsc),
      commissionUsc: -Math.abs(Number(values.commissionUsc || 0)), swapUsc: Number(values.swapUsc || 0), otherFeeUsc: -Math.abs(Number(values.otherFeeUsc || 0)),
      uscPerUsd: selected?.uscPerUsd || 100, usdThbRate: Number(values.usdThbRate), fxSource: data.settings.fxSource,
      note: values.note.trim(), createdAt: record?.createdAt || now, updatedAt: now, deletedAt: record?.deletedAt,
    });
  }

  if (!brokers.length) return <NoBroker onClose={onClose} />;
  return (
    <form onSubmit={submit}>
      <ModalHeading kicker="Daily trade result" title={record ? 'แก้ไขผลการเทรด' : 'บันทึกกำไรการเทรดรายวัน'} description="กรอกกำไรและค่าใช้จ่ายของวันนั้นเป็น USC ระบบจะหักค่าธรรมเนียมและแปลงเป็น USD/THB อัตโนมัติ" />
      <div className="form-grid"><Field label="วันที่"><input type="date" required value={values.tradeDate} onChange={(event) => setValues({ ...values, tradeDate: event.target.value })} /></Field><Field label="บัญชีโบรกเกอร์"><select required value={values.brokerId} onChange={(event) => setValues({ ...values, brokerId: event.target.value })}>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.brokerName} · {broker.accountName}</option>)}</select></Field></div>
      <div className="form-grid"><Field label="สัญลักษณ์"><input required value={values.symbol} onChange={(event) => setValues({ ...values, symbol: event.target.value })} /></Field><Field label="กำไร/ขาดทุนก่อนค่าธรรมเนียม (USC)"><input type="number" step="0.01" required value={values.grossProfitUsc} onChange={(event) => setValues({ ...values, grossProfitUsc: event.target.value })} placeholder="เช่น 3842 หรือ -1250" /></Field></div>
      <div className="form-grid three"><Field label="Commission ที่หัก (USC)"><input type="number" min="0" step="0.01" required value={values.commissionUsc} onChange={(event) => setValues({ ...values, commissionUsc: event.target.value })} /></Field><Field label="Swap (USC, ใส่ +/− ได้)"><input type="number" step="0.01" required value={values.swapUsc} onChange={(event) => setValues({ ...values, swapUsc: event.target.value })} /></Field><Field label="ค่าใช้จ่ายอื่นที่หัก (USC)"><input type="number" min="0" step="0.01" required value={values.otherFeeUsc} onChange={(event) => setValues({ ...values, otherFeeUsc: event.target.value })} /></Field></div>
      <p className="daily-input-note">ใส่ Commission และค่าใช้จ่ายอื่นเป็นจำนวนบวก ระบบจะหักออกให้เอง · Swap ใส่ค่าตามที่โบรกเกอร์แสดง</p>
      <div className="form-grid"><Field label="อัตรา USD → THB"><input type="number" step="0.0001" min="0.0001" required value={values.usdThbRate} onChange={(event) => setValues({ ...values, usdThbRate: event.target.value })} /></Field><Field label="หมายเหตุ"><input value={values.note} onChange={(event) => setValues({ ...values, note: event.target.value })} placeholder="แผนเทรดหรือเหตุการณ์สำคัญ" /></Field></div>
      <div className={`conversion-preview ${netUsd < 0 ? 'loss' : ''}`}><div><span>กำไรสุทธิ</span><strong>{formatUsc(netUsc, true)}</strong></div><div><span>เท่ากับ</span><strong>{formatUsd(netUsd, true)}</strong></div><div><span>คิดเป็นเงินไทย</span><strong>{formatThb(netThb, true)}</strong></div></div>
      <p className="conversion-rule">เกณฑ์บัญชี Cent: {selected?.uscPerUsd || 100} USC = 1 USD · สูตร USD = USC ÷ {selected?.uscPerUsd || 100}</p>
      <FormActions onClose={onClose} label={record ? 'บันทึกการแก้ไข' : 'เพิ่มรายการเทรด'} />
    </form>
  );
}

function CashForm({ data, record, onSave, onClose }: { data: AppData; record?: CashFlowRecord; onSave: (record: CashFlowRecord) => void; onClose: () => void }) {
  const brokers = activeBrokers(data).filter((broker) => broker.isActive || broker.id === record?.brokerId);
  const fallbackBroker = brokers[0];
  const [values, setValues] = useState({
    flowDate: record?.flowDate || bangkokDate(), brokerId: record?.brokerId || fallbackBroker?.id || '', type: record?.type || 'deposit',
    amount: String(record?.amount ?? ''), currency: record?.currency || 'USC', usdThbRate: String(record?.usdThbRate ?? data.settings.defaultFxRate), note: record?.note || '',
  });
  const selected = brokers.find((broker) => broker.id === values.brokerId) || fallbackBroker;
  const amount = Number(values.amount || 0);
  const usd = values.currency === 'USD' ? amount : values.currency === 'USC' ? amount / Math.max(selected?.uscPerUsd || 100, 1) : amount / Math.max(Number(values.usdThbRate), .0001);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.brokerId || amount <= 0) return;
    const now = new Date().toISOString();
    onSave({
      id: record?.id || id('cash'), flowDate: values.flowDate, brokerId: values.brokerId, type: values.type as CashFlowRecord['type'],
      amount, currency: values.currency as Currency, uscPerUsd: selected?.uscPerUsd || 100, usdThbRate: Number(values.usdThbRate), note: values.note.trim(),
      createdAt: record?.createdAt || now, updatedAt: now, deletedAt: record?.deletedAt,
    });
  }

  if (!brokers.length) return <NoBroker onClose={onClose} />;
  return (
    <form onSubmit={submit}>
      <ModalHeading kicker="Capital movement" title={record ? 'แก้ไขเงินทุน / ถอนทุน' : 'เพิ่มทุนหรือถอนทุน'} description="เพิ่มทุนในพอร์ตเดิมได้ไม่จำกัดครั้ง รายการนี้จะกระทบยอดพอร์ต แต่ไม่ถูกนับเป็นกำไรจากการเทรด" />
      <div className="type-picker">{([['deposit', '＋ เพิ่มทุน'], ['withdrawal', '↓ ถอนทุน'], ['adjustment', '↔ ปรับยอด']] as const).map(([key, label]) => <button key={key} className={values.type === key ? 'active' : ''} type="button" onClick={() => setValues({ ...values, type: key })}>{label}</button>)}</div>
      <div className="form-grid"><Field label="วันที่"><input type="date" required value={values.flowDate} onChange={(event) => setValues({ ...values, flowDate: event.target.value })} /></Field><Field label="บัญชีโบรกเกอร์"><select required value={values.brokerId} onChange={(event) => setValues({ ...values, brokerId: event.target.value })}>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.brokerName} · {broker.accountName}</option>)}</select></Field></div>
      <div className="form-grid amount-currency"><Field label="จำนวนเงิน"><input type="number" min="0.01" step="0.01" required value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} placeholder="0.00" /></Field><Field label="สกุลเงิน"><select value={values.currency} onChange={(event) => setValues({ ...values, currency: event.target.value as Currency })}><option value="USD">USD</option><option value="USC">USC</option><option value="THB">THB</option></select></Field></div>
      <div className="form-grid"><Field label="อัตรา USD → THB"><input type="number" min="0.0001" step="0.0001" required value={values.usdThbRate} onChange={(event) => setValues({ ...values, usdThbRate: event.target.value })} /></Field><Field label="หมายเหตุ"><input value={values.note} onChange={(event) => setValues({ ...values, note: event.target.value })} placeholder="เช่น เพิ่มทุนบัญชีหลัก" /></Field></div>
      <div className="conversion-preview neutral"><div><span>มูลค่า USD</span><strong>{formatUsd(usd)}</strong></div><div><span>มูลค่า THB</span><strong>{formatThb(usd * Number(values.usdThbRate || 0))}</strong></div><div><span>ผลต่อพอร์ต</span><strong>{values.type === 'withdrawal' ? 'ลดลง' : 'เพิ่มขึ้น'}</strong></div></div>
      <FormActions onClose={onClose} label={record ? 'บันทึกการแก้ไข' : values.type === 'deposit' ? 'ยืนยันเพิ่มทุน' : values.type === 'withdrawal' ? 'ยืนยันถอนทุน' : 'ยืนยันปรับยอด'} />
    </form>
  );
}

function BrokerForm({ record, defaultFxRate, onSave, onClose }: { record?: BrokerAccount; defaultFxRate: number; onSave: (record: BrokerAccount, openingCapital?: OpeningCapitalInput) => void; onClose: () => void }) {
  const [values, setValues] = useState({ brokerName: record?.brokerName || '', accountName: record?.accountName || '', accountNumberMasked: record?.accountNumberMasked || '', accountUnit: record?.accountUnit || 'USC', uscPerUsd: String(record?.uscPerUsd || 100), note: record?.note || '', isActive: record?.isActive ?? true, openingAmount: '', openingCurrency: 'USC' as Currency, openingDate: bangkokDate(), usdThbRate: String(defaultFxRate) });
  function submit(event: FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    const broker = { id: record?.id || id('broker'), brokerName: values.brokerName.trim(), accountName: values.accountName.trim(), accountNumberMasked: values.accountNumberMasked.trim(), accountUnit: values.accountUnit as BrokerAccount['accountUnit'], uscPerUsd: Number(values.uscPerUsd), note: values.note.trim(), isActive: values.isActive, createdAt: record?.createdAt || now, updatedAt: now, deletedAt: record?.deletedAt };
    const openingCapital = !record && Number(values.openingAmount) > 0 ? { amount: Number(values.openingAmount), currency: values.openingCurrency, flowDate: values.openingDate, usdThbRate: Number(values.usdThbRate) } : undefined;
    onSave(broker, openingCapital);
  }
  return (
    <form onSubmit={submit}>
      <ModalHeading kicker="Broker account" title={record ? 'แก้ไขบัญชีโบรกเกอร์' : 'เพิ่มบัญชีโบรกเกอร์'} description="ตั้งค่าหน่วยบัญชีให้ตรงกับที่โบรกเกอร์แสดงจริง" />
      <div className="form-grid"><Field label="ชื่อโบรกเกอร์"><input required value={values.brokerName} onChange={(event) => setValues({ ...values, brokerName: event.target.value })} placeholder="เช่น XM Global" /></Field><Field label="ชื่อบัญชี"><input required value={values.accountName} onChange={(event) => setValues({ ...values, accountName: event.target.value })} placeholder="เช่น Standard Cent" /></Field></div>
      <div className="form-grid"><Field label="เลขบัญชี (แนะนำให้ปิดบางส่วน)"><input value={values.accountNumberMasked} onChange={(event) => setValues({ ...values, accountNumberMasked: event.target.value })} placeholder="เช่น ••• 8421" /></Field><Field label="หน่วยบัญชี"><select value={values.accountUnit} onChange={(event) => setValues({ ...values, accountUnit: event.target.value as BrokerAccount['accountUnit'], uscPerUsd: event.target.value === 'USC' ? '100' : '1' })}><option value="USC">USC (Cent account)</option><option value="USD">USD</option></select></Field></div>
      <div className="form-grid"><Field label="จำนวน USC ต่อ 1 USD"><input type="number" min="1" step="1" required value={values.uscPerUsd} onChange={(event) => setValues({ ...values, uscPerUsd: event.target.value })} /></Field><Field label="หมายเหตุ"><input value={values.note} onChange={(event) => setValues({ ...values, note: event.target.value })} placeholder="ข้อมูลสำหรับจำแนกบัญชี" /></Field></div>
      <p className="conversion-rule">บัญชี Standard Cent ทั่วไปใช้ 100 USC = 1 USD (ตัวอย่าง: ฝาก $5 จะแสดง 500 USC) ปรับค่านี้เฉพาะเมื่อโบรกเกอร์กำหนดต่างออกไป</p>
      {!record && <div className="opening-capital-box"><h3>เงินทุนเริ่มต้น (กรอกครั้งแรก)</h3><div className="form-grid three"><Field label="จำนวนเงินทุน"><input type="number" min="0" step="0.01" value={values.openingAmount} onChange={(event) => setValues({ ...values, openingAmount: event.target.value })} placeholder="เช่น 10000" /></Field><Field label="หน่วยเงินทุน"><select value={values.openingCurrency} onChange={(event) => setValues({ ...values, openingCurrency: event.target.value as Currency })}><option value="USC">USC</option><option value="USD">USD</option><option value="THB">THB</option></select></Field><Field label="วันที่เริ่มต้น"><input type="date" value={values.openingDate} onChange={(event) => setValues({ ...values, openingDate: event.target.value })} /></Field></div><Field label="อัตรา USD → THB วันที่เริ่มต้น"><input type="number" min="0.0001" step="0.0001" value={values.usdThbRate} onChange={(event) => setValues({ ...values, usdThbRate: event.target.value })} /></Field><p>ภายหลังเพิ่มทุนในพอร์ตนี้ได้เรื่อย ๆ จากปุ่ม “เพิ่มทุน / ถอนทุน” ระบบจะรวมทุกครั้งให้อัตโนมัติ</p></div>}
      <label className="toggle-row"><input type="checkbox" checked={values.isActive} onChange={(event) => setValues({ ...values, isActive: event.target.checked })} /><span /><div><strong>เปิดใช้งานบัญชีนี้</strong><small>บัญชีที่ปิดจะยังคงประวัติเดิมไว้</small></div></label>
      <FormActions onClose={onClose} label={record ? 'บันทึกการแก้ไข' : 'เพิ่มบัญชี'} />
    </form>
  );
}

function SettingsForm({ settings, onSave, onClose, onTest, onFetchRate }: { settings: AppSettings; onSave: (settings: AppSettings) => void; onClose: () => void; onTest: (settings: AppSettings) => Promise<string>; onFetchRate: (settings: AppSettings) => Promise<LatestFxRate> }) {
  const [values, setValues] = useState(settings);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [fetchingRate, setFetchingRate] = useState(false);
  async function test() {
    setTesting(true); setTestResult('');
    try { setTestResult(await onTest(values)); } catch (error) { setTestResult(error instanceof Error ? error.message : 'ทดสอบไม่สำเร็จ'); }
    setTesting(false);
  }
  async function refreshCurrentRate() {
    setFetchingRate(true);
    try {
      const latest = await onFetchRate(values);
      setValues({ ...values, defaultFxRate: latest.usdThbRate, fxSource: `${latest.source} · ${latest.date}` });
      setTestResult(`เรตล่าสุด $1 = ฿${latest.usdThbRate.toFixed(4)}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'ดึงเรตไม่สำเร็จ');
    }
    setFetchingRate(false);
  }
  function submit(event: FormEvent) { event.preventDefault(); onSave({ ...values, defaultFxRate: Number(values.defaultFxRate), dailyTargetUsc: Number(values.dailyTargetUsc), monthlyTargetUsc: Number(values.monthlyTargetUsc) }); }
  return (
    <form onSubmit={submit}>
      <ModalHeading kicker="Preferences & sync" title="การตั้งค่า" description="กำหนดเป้าหมาย อัตราแลกเปลี่ยน และการเชื่อม Google Sheets" />
      <div className="settings-section"><h3>โปรไฟล์และเป้าหมาย</h3><div className="form-grid three"><Field label="ชื่อที่แสดง"><input value={values.profileName} onChange={(event) => setValues({ ...values, profileName: event.target.value })} /></Field><Field label="เป้ากำไรรายวัน (USC)"><input type="number" min="0" step="1" value={values.dailyTargetUsc} onChange={(event) => setValues({ ...values, dailyTargetUsc: Number(event.target.value) })} /></Field><Field label="เป้ากำไรรายเดือน (USC)"><input type="number" min="0" step="1" value={values.monthlyTargetUsc} onChange={(event) => setValues({ ...values, monthlyTargetUsc: Number(event.target.value) })} /></Field></div></div>
      <div className="settings-section"><h3>อัตราแลกเปลี่ยน</h3><div className="form-grid"><Field label="USD → THB ล่าสุด"><input type="number" min="0.0001" step="0.0001" value={values.defaultFxRate} onChange={(event) => setValues({ ...values, defaultFxRate: Number(event.target.value) })} /></Field><Field label="แหล่งอัตรา"><input value={values.fxSource} onChange={(event) => setValues({ ...values, fxSource: event.target.value })} placeholder="GoogleFinance reference หรือเรตโบรกเกอร์" /></Field></div><div className="rate-refresh-row"><button className="soft-button" type="button" disabled={fetchingRate || !isCloudConfigured(values)} onClick={() => void refreshCurrentRate()}>{fetchingRate ? 'กำลังดึงเรต…' : '↻ ดึงเรตล่าสุดอัตโนมัติ'}</button><span>100 USC = 1 USD · ระบบจะใช้เรตนี้กับรายการใหม่</span></div><p className="field-help">อัตราจะถูกบันทึกแยกในแต่ละรายการ ทำให้ยอดย้อนหลังไม่เปลี่ยนเอง หากเรตถอนจริงต่างจากเรตอ้างอิง สามารถแก้เฉพาะรายการนั้นได้</p></div>
      <div className="settings-section cloud-settings"><h3>เชื่อม Google Sheets</h3><Field label="Apps Script Web App URL"><input type="url" value={values.apiUrl} onChange={(event) => setValues({ ...values, apiUrl: event.target.value.trim() })} placeholder="https://script.google.com/macros/s/.../exec" /></Field><div className="form-grid"><Field label="Device Key ID"><input autoComplete="off" value={values.keyId} onChange={(event) => setValues({ ...values, keyId: event.target.value.trim() })} /></Field><Field label="Device Secret"><input type="password" autoComplete="new-password" value={values.deviceSecret} onChange={(event) => setValues({ ...values, deviceSecret: event.target.value })} /></Field></div><p className="security-note">🔒 รหัสอุปกรณ์เก็บเฉพาะในเครื่องนี้และไม่ถูกฝังไว้ใน GitHub</p><div className="connection-test"><button className="soft-button" type="button" disabled={testing || !values.apiUrl || !values.keyId || !values.deviceSecret} onClick={() => void test()}>{testing ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}</button>{testResult && <span>{testResult}</span>}</div></div>
      <FormActions onClose={onClose} label="บันทึกการตั้งค่า" />
    </form>
  );
}

function ModalHeading({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <div className="modal-heading"><p className="eyebrow">{kicker}</p><h2>{title}</h2><span>{description}</span></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function FormActions({ onClose, label }: { onClose: () => void; label: string }) {
  return <div className="form-actions"><button className="soft-button" type="button" onClick={onClose}>ยกเลิก</button><button className="dark-button" type="submit">{label}</button></div>;
}

function NoBroker({ onClose }: { onClose: () => void }) {
  return <div><ModalHeading kicker="Broker required" title="เพิ่มบัญชีโบรกเกอร์ก่อน" description="ระบบต้องทราบหน่วย USC/USD เพื่อคำนวณอย่างถูกต้อง" /><div className="empty-state"><span>◎</span><strong>ยังไม่มีบัญชีโบรกเกอร์</strong><p>ปิดหน้าต่างนี้แล้วไปที่เมนูพอร์ตเพื่อเพิ่มบัญชี</p></div><FormActions onClose={onClose} label="ปิด" /></div>;
}
