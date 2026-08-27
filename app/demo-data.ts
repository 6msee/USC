import type { AppData } from './types';

export function bangkokDate(input = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(input);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function createDemoData(): AppData {
  return {
    version: 1,
    brokers: [],
    trades: [],
    cashFlows: [],
    settings: {
      profileName: '',
      defaultFxRate: 34.53,
      fxSource: 'กำหนดเอง',
      dailyTargetUsc: 3000,
      monthlyTargetUsc: 60000,
      apiUrl: '',
      keyId: '',
      deviceSecret: '',
      lastSyncedAt: '',
    },
  };
}
