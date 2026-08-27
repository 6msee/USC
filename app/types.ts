export type AccountUnit = 'USC' | 'USD';
export type CashFlowType = 'deposit' | 'withdrawal' | 'adjustment';
export type Currency = 'USC' | 'USD' | 'THB';

export interface BrokerAccount {
  id: string;
  brokerName: string;
  accountName: string;
  accountNumberMasked: string;
  accountUnit: AccountUnit;
  uscPerUsd: number;
  note: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface TradeRecord {
  id: string;
  tradeDate: string;
  brokerId: string;
  symbol: string;
  grossProfitUsc: number;
  commissionUsc: number;
  swapUsc: number;
  otherFeeUsc: number;
  uscPerUsd: number;
  usdThbRate: number;
  fxSource: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CashFlowRecord {
  id: string;
  flowDate: string;
  brokerId: string;
  type: CashFlowType;
  amount: number;
  currency: Currency;
  uscPerUsd: number;
  usdThbRate: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AppSettings {
  profileName: string;
  defaultFxRate: number;
  fxSource: string;
  dailyTargetUsc: number;
  monthlyTargetUsc: number;
  apiUrl: string;
  keyId: string;
  deviceSecret: string;
  lastSyncedAt: string;
}

export interface AppData {
  version: 1;
  brokers: BrokerAccount[];
  trades: TradeRecord[];
  cashFlows: CashFlowRecord[];
  settings: AppSettings;
}

export type EditorState =
  | { kind: 'trade'; record?: TradeRecord }
  | { kind: 'cash'; record?: CashFlowRecord }
  | { kind: 'broker'; record?: BrokerAccount }
  | { kind: 'settings' }
  | { kind: 'none' };

export type AppSection = 'dashboard' | 'records' | 'brokers' | 'insights';
