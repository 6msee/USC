import { bangkokDate } from './demo-data';
import type { AppData, BrokerAccount, CashFlowRecord, TradeRecord } from './types';

export function netTradeUsc(trade: TradeRecord): number {
  return trade.grossProfitUsc + trade.commissionUsc + trade.swapUsc + trade.otherFeeUsc;
}

export function tradeUsd(trade: TradeRecord): number {
  return netTradeUsc(trade) / Math.max(trade.uscPerUsd || 100, 1);
}

export function tradeThb(trade: TradeRecord): number {
  return tradeUsd(trade) * trade.usdThbRate;
}

export function cashFlowUsd(flow: CashFlowRecord): number {
  if (flow.currency === 'USD') return flow.amount;
  if (flow.currency === 'USC') return flow.amount / Math.max(flow.uscPerUsd || 100, 1);
  return flow.amount / Math.max(flow.usdThbRate || 1, 0.000001);
}

export function cashFlowThb(flow: CashFlowRecord): number {
  return cashFlowUsd(flow) * flow.usdThbRate;
}

export function cashFlowUsc(flow: CashFlowRecord): number {
  if (flow.currency === 'USC') return flow.amount;
  return cashFlowUsd(flow) * Math.max(flow.uscPerUsd || 100, 1);
}

export function signedCashFlowUsd(flow: CashFlowRecord): number {
  const amount = cashFlowUsd(flow);
  if (flow.type === 'withdrawal') return -amount;
  return amount;
}

export function activeBrokers(data: AppData): BrokerAccount[] {
  return data.brokers.filter((broker) => !broker.deletedAt);
}

export function activeTrades(data: AppData): TradeRecord[] {
  return data.trades.filter((trade) => !trade.deletedAt);
}

export function activeCashFlows(data: AppData): CashFlowRecord[] {
  return data.cashFlows.filter((flow) => !flow.deletedAt);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function summarize(data: AppData, brokerId = 'all') {
  const today = bangkokDate();
  const thisMonth = monthKey(today);
  const trades = activeTrades(data).filter((trade) => brokerId === 'all' || trade.brokerId === brokerId);
  const cashFlows = activeCashFlows(data).filter((flow) => brokerId === 'all' || flow.brokerId === brokerId);
  const cumulativeProfitUsd = trades.reduce((sum, trade) => sum + tradeUsd(trade), 0);
  const cumulativeProfitUsc = trades.reduce((sum, trade) => sum + netTradeUsc(trade), 0);
  const todayProfitUsd = trades.filter((trade) => trade.tradeDate === today).reduce((sum, trade) => sum + tradeUsd(trade), 0);
  const todayProfitUsc = trades.filter((trade) => trade.tradeDate === today).reduce((sum, trade) => sum + netTradeUsc(trade), 0);
  const monthProfitUsd = trades.filter((trade) => monthKey(trade.tradeDate) === thisMonth).reduce((sum, trade) => sum + tradeUsd(trade), 0);
  const monthProfitUsc = trades.filter((trade) => monthKey(trade.tradeDate) === thisMonth).reduce((sum, trade) => sum + netTradeUsc(trade), 0);
  const netCapitalUsd = cashFlows.reduce((sum, flow) => sum + signedCashFlowUsd(flow), 0);
  const netCapitalUsc = cashFlows.reduce((sum, flow) => sum + cashFlowUsc(flow) * (flow.type === 'withdrawal' ? -1 : 1), 0);
  const depositsUsd = cashFlows.filter((flow) => flow.type === 'deposit').reduce((sum, flow) => sum + cashFlowUsd(flow), 0);
  const depositsUsc = cashFlows.filter((flow) => flow.type === 'deposit').reduce((sum, flow) => sum + cashFlowUsc(flow), 0);
  const withdrawalsUsd = cashFlows.filter((flow) => flow.type === 'withdrawal').reduce((sum, flow) => sum + cashFlowUsd(flow), 0);
  const withdrawalsUsc = cashFlows.filter((flow) => flow.type === 'withdrawal').reduce((sum, flow) => sum + cashFlowUsc(flow), 0);
  const tradingDates = new Set(trades.map((trade) => trade.tradeDate));
  const profitByDate = aggregateDaily(trades);
  const profitableDays = profitByDate.filter((item) => item.profitUsd > 0).length;
  const losingDays = profitByDate.filter((item) => item.profitUsd < 0).length;
  const fxRate = data.settings.defaultFxRate;

  return {
    todayProfitUsd,
    todayProfitUsc,
    monthProfitUsd,
    monthProfitUsc,
    cumulativeProfitUsd,
    cumulativeProfitUsc,
    netCapitalUsd,
    netCapitalUsc,
    depositsUsd,
    depositsUsc,
    withdrawalsUsd,
    withdrawalsUsc,
    portfolioUsd: netCapitalUsd + cumulativeProfitUsd,
    portfolioUsc: netCapitalUsc + cumulativeProfitUsc,
    averageTradingDayUsd: tradingDates.size ? cumulativeProfitUsd / tradingDates.size : 0,
    averageTradingDayUsc: tradingDates.size ? cumulativeProfitUsc / tradingDates.size : 0,
    tradingDays: tradingDates.size,
    profitableDays,
    losingDays,
    winDayRate: profitByDate.length ? (profitableDays / profitByDate.length) * 100 : 0,
    bestDayUsd: profitByDate.length ? Math.max(...profitByDate.map((item) => item.profitUsd)) : 0,
    bestDayUsc: profitByDate.length ? Math.max(...profitByDate.map((item) => item.profitUsc)) : 0,
    worstDayUsd: profitByDate.length ? Math.min(...profitByDate.map((item) => item.profitUsd)) : 0,
    worstDayUsc: profitByDate.length ? Math.min(...profitByDate.map((item) => item.profitUsc)) : 0,
    maxDrawdownUsd: calculateMaxDrawdown(profitByDate),
    maxDrawdownUsc: calculateMaxDrawdownUsc(profitByDate),
    currentStreak: calculateStreak(profitByDate),
    fxRate,
  };
}

export function aggregateDaily(trades: TradeRecord[]) {
  const values = new Map<string, { profitUsd: number; profitUsc: number }>();
  trades.forEach((trade) => {
    const current = values.get(trade.tradeDate) || { profitUsd: 0, profitUsc: 0 };
    values.set(trade.tradeDate, { profitUsd: current.profitUsd + tradeUsd(trade), profitUsc: current.profitUsc + netTradeUsc(trade) });
  });
  return [...values.entries()]
    .map(([date, profit]) => ({ date, ...profit }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculateMaxDrawdownUsc(series: ReturnType<typeof aggregateDaily>): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  series.forEach((item) => {
    equity += item.profitUsc;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  });
  return drawdown;
}

function calculateMaxDrawdown(series: ReturnType<typeof aggregateDaily>): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  series.forEach((item) => {
    equity += item.profitUsd;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  });
  return drawdown;
}

function calculateStreak(series: ReturnType<typeof aggregateDaily>): number {
  if (!series.length) return 0;
  const latestDirection = Math.sign(series.at(-1)?.profitUsd || 0);
  if (!latestDirection) return 0;
  let count = 0;
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (Math.sign(series[index].profitUsd) !== latestDirection) break;
    count += latestDirection;
  }
  return count;
}

export function brokerName(data: AppData, brokerId: string): string {
  const broker = data.brokers.find((item) => item.id === brokerId);
  return broker ? `${broker.brokerName} · ${broker.accountName}` : 'ไม่พบบัญชี';
}
