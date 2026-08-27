import type { AppData, AppSettings } from './types';

const DATA_KEY = 'farmcent:data:v1';
const PENDING_KEY = 'farmcent:pending-sync';

export function loadLocalData(): AppData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch {
    return null;
  }
}

export function saveLocalData(data: AppData): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

export function setPendingSync(pending: boolean): void {
  if (typeof window === 'undefined') return;
  if (pending) window.localStorage.setItem(PENDING_KEY, '1');
  else window.localStorage.removeItem(PENDING_KEY);
}

export function hasPendingSync(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(PENDING_KEY) === '1';
}

export function isCloudConfigured(settings: AppSettings): boolean {
  return Boolean(settings.apiUrl && settings.keyId && settings.deviceSecret);
}

function remoteSafeData(data: AppData): AppData {
  return {
    ...data,
    settings: {
      ...data.settings,
      apiUrl: '',
      keyId: '',
      deviceSecret: '',
      lastSyncedAt: '',
    },
  };
}

async function hmac(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function request<T>(settings: AppSettings, action: string, payload: unknown): Promise<T> {
  if (!isCloudConfigured(settings)) throw new Error('ยังไม่ได้เชื่อม Google Sheets');
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const signature = await hmac(settings.deviceSecret, `${action}\n${timestamp}\n${nonce}\n${payloadJson}`);
  const response = await fetch(settings.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      action,
      payloadJson,
      auth: { keyId: settings.keyId, timestamp, nonce, signature },
    }),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`เชื่อมต่อไม่สำเร็จ (${response.status})`);
  const result = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!result.ok) throw new Error(result.error || 'Google Sheets ตอบกลับผิดพลาด');
  return result.data as T;
}

export async function pullFromCloud(local: AppData): Promise<AppData> {
  const remote = await request<AppData>(local.settings, 'data.load', {});
  const now = new Date().toISOString();
  const merged: AppData = {
    ...remote,
    settings: {
      ...remote.settings,
      apiUrl: local.settings.apiUrl,
      keyId: local.settings.keyId,
      deviceSecret: local.settings.deviceSecret,
      lastSyncedAt: now,
    },
  };
  saveLocalData(merged);
  setPendingSync(false);
  return merged;
}

export async function pushToCloud(data: AppData): Promise<AppData> {
  await request<{ savedAt: string }>(data.settings, 'data.save', remoteSafeData(data));
  const synced = { ...data, settings: { ...data.settings, lastSyncedAt: new Date().toISOString() } };
  saveLocalData(synced);
  setPendingSync(false);
  return synced;
}

export async function testCloudConnection(settings: AppSettings): Promise<string> {
  const result = await request<{ message: string }>(settings, 'health.authenticated', {});
  return result.message;
}

export interface LatestFxRate {
  date: string;
  usdThbRate: number;
  source: string;
  note: string;
}

export async function fetchLatestFxRate(settings: AppSettings): Promise<LatestFxRate> {
  return request<LatestFxRate>(settings, 'fx.latest', {});
}
