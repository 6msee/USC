const GF_VERSION = 1;
const GF_TABLES = {
  Brokers: ['id', 'brokerName', 'accountName', 'accountNumberMasked', 'accountUnit', 'uscPerUsd', 'note', 'isActive', 'createdAt', 'updatedAt', 'deletedAt'],
  Trades: ['id', 'tradeDate', 'brokerId', 'symbol', 'grossProfitUsc', 'commissionUsc', 'swapUsc', 'otherFeeUsc', 'uscPerUsd', 'usdThbRate', 'fxSource', 'note', 'createdAt', 'updatedAt', 'deletedAt'],
  CashFlows: ['id', 'flowDate', 'brokerId', 'type', 'amount', 'currency', 'uscPerUsd', 'usdThbRate', 'note', 'createdAt', 'updatedAt', 'deletedAt'],
};

/** Run once from the Apps Script editor attached to a new Google Sheet. */
function setupFarmCENT() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('เปิด Apps Script จาก Google Sheet แล้วลองใหม่');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());

  Object.keys(GF_TABLES).forEach((name) => ensureSheet_(spreadsheet, name, GF_TABLES[name]));
  ensureSheet_(spreadsheet, 'Settings', ['key', 'value']);
  ensureSheet_(spreadsheet, 'AuditLog', ['timestamp', 'keyId', 'action', 'summary']);
  const fxSheet = ensureSheet_(spreadsheet, 'FXRates', ['date', 'usdThbRate', 'source', 'updatedAt']);
  if (fxSheet.getLastRow() < 2) {
    fxSheet.getRange('A2').setFormula('=TODAY()');
    fxSheet.getRange('B2').setFormula('=GOOGLEFINANCE("CURRENCY:USDTHB")');
    fxSheet.getRange('C2').setValue('GoogleFinance reference');
    fxSheet.getRange('D2').setValue(new Date());
    fxSheet.getRange('B:B').setNumberFormat('0.0000');
  }

  const credential = createDeviceKey();
  const result = {
    spreadsheetId: spreadsheet.getId(),
    keyId: credential.keyId,
    deviceSecret: credential.deviceSecret,
    nextStep: 'Deploy > New deployment > Web app > Execute as me > Anyone',
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Creates another device credential. Copy the returned secret immediately. */
function createDeviceKey() {
  const properties = PropertiesService.getScriptProperties();
  const keys = JSON.parse(properties.getProperty('DEVICE_KEYS') || '{}');
  const keyId = `device-${Utilities.getUuid().slice(0, 8)}`;
  const seed = `${Utilities.getUuid()}-${Utilities.getUuid()}-${Date.now()}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  const deviceSecret = Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
  keys[keyId] = deviceSecret;
  properties.setProperty('DEVICE_KEYS', JSON.stringify(keys));
  return { keyId, deviceSecret };
}

function revokeDeviceKey(keyId) {
  const properties = PropertiesService.getScriptProperties();
  const keys = JSON.parse(properties.getProperty('DEVICE_KEYS') || '{}');
  delete keys[keyId];
  properties.setProperty('DEVICE_KEYS', JSON.stringify(keys));
  return { revoked: keyId };
}

function doGet() {
  return json_({ ok: true, data: { service: 'ฟามCENT Sheets API', version: GF_VERSION, status: 'ready' } });
}

function doPost(event) {
  const requestId = Utilities.getUuid();
  try {
    if (!event || !event.postData || !event.postData.contents) throw new Error('missing_request_body');
    const body = JSON.parse(event.postData.contents);
    const action = String(body.action || '');
    const payloadJson = String(body.payloadJson || '{}');
    verifyAuth_(action, payloadJson, body.auth || {});
    const payload = JSON.parse(payloadJson);

    if (action === 'health.authenticated') {
      return json_({ ok: true, data: { message: 'เชื่อมฟามCENTกับ Google Sheets สำเร็จ' }, requestId });
    }
    if (action === 'data.load') {
      return json_({ ok: true, data: readData_(), requestId });
    }
    if (action === 'data.save') {
      validateData_(payload);
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        writeData_(payload);
        audit_(body.auth.keyId, action, {
          brokers: payload.brokers.length,
          trades: payload.trades.length,
          cashFlows: payload.cashFlows.length,
        });
      } finally {
        lock.releaseLock();
      }
      return json_({ ok: true, data: { savedAt: new Date().toISOString() }, requestId });
    }
    if (action === 'fx.latest') {
      return json_({ ok: true, data: readFxRate_(), requestId });
    }
    throw new Error('unknown_action');
  } catch (error) {
    return json_({ ok: false, error: safeError_(error), requestId });
  }
}

function verifyAuth_(action, payloadJson, auth) {
  const keyId = String(auth.keyId || '');
  const timestamp = Number(auth.timestamp || 0);
  const nonce = String(auth.nonce || '');
  const signature = String(auth.signature || '').toLowerCase();
  if (!keyId || !timestamp || !nonce || !signature) throw new Error('authentication_required');
  if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) throw new Error('request_expired');
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error('invalid_signature');

  const keys = JSON.parse(PropertiesService.getScriptProperties().getProperty('DEVICE_KEYS') || '{}');
  const secret = keys[keyId];
  if (!secret) throw new Error('unknown_device');
  const replayKey = `nonce:${keyId}:${nonce}`;
  const cache = CacheService.getScriptCache();
  if (cache.get(replayKey)) throw new Error('replayed_request');

  const message = `${action}\n${auth.timestamp}\n${nonce}\n${payloadJson}`;
  const bytes = Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8);
  const expected = bytes.map((byte) => ((byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0'))).join('');
  if (!constantTimeEqual_(expected, signature)) throw new Error('invalid_signature');
  cache.put(replayKey, '1', 600);
}

function constantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function validateData_(data) {
  if (!data || data.version !== GF_VERSION) throw new Error('unsupported_data_version');
  ['brokers', 'trades', 'cashFlows'].forEach((key) => {
    if (!Array.isArray(data[key])) throw new Error(`invalid_${key}`);
    if (data[key].length > 20000) throw new Error(`${key}_limit_exceeded`);
  });
  data.brokers.forEach((record) => {
    requireId_(record.id);
    if (!record.brokerName || Number(record.uscPerUsd) <= 0) throw new Error('invalid_broker');
  });
  data.trades.forEach((record) => {
    requireId_(record.id);
    if (!record.tradeDate || !record.brokerId || Number(record.uscPerUsd) <= 0 || Number(record.usdThbRate) <= 0) throw new Error('invalid_trade');
    ['grossProfitUsc', 'commissionUsc', 'swapUsc', 'otherFeeUsc'].forEach((field) => {
      if (!Number.isFinite(Number(record[field]))) throw new Error(`invalid_trade_${field}`);
    });
  });
  data.cashFlows.forEach((record) => {
    requireId_(record.id);
    if (!record.flowDate || !record.brokerId || Number(record.amount) < 0 || Number(record.usdThbRate) <= 0) throw new Error('invalid_cash_flow');
  });
  if (!data.settings || typeof data.settings !== 'object') throw new Error('invalid_settings');
  ['apiUrl', 'keyId', 'deviceSecret'].forEach((key) => {
    if (data.settings[key]) throw new Error('client_secret_must_not_be_stored');
  });
}

function requireId_(value) {
  if (!value || String(value).length > 120) throw new Error('invalid_record_id');
}

function readData_() {
  const spreadsheet = getSpreadsheet_();
  const settings = {
    profileName: '', defaultFxRate: 34.5, fxSource: 'กำหนดเอง',
    dailyTargetUsc: 3000, monthlyTargetUsc: 60000,
    apiUrl: '', keyId: '', deviceSecret: '', lastSyncedAt: '',
  };
  const settingsSheet = spreadsheet.getSheetByName('Settings');
  if (settingsSheet && settingsSheet.getLastRow() > 1) {
    settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues().forEach((row) => {
      try { settings[String(row[0])] = JSON.parse(String(row[1])); } catch (_) { settings[String(row[0])] = row[1]; }
    });
  }
  return {
    version: GF_VERSION,
    brokers: readRecords_(spreadsheet, 'Brokers', GF_TABLES.Brokers),
    trades: readRecords_(spreadsheet, 'Trades', GF_TABLES.Trades),
    cashFlows: readRecords_(spreadsheet, 'CashFlows', GF_TABLES.CashFlows),
    settings,
  };
}

function writeData_(data) {
  const spreadsheet = getSpreadsheet_();
  writeRecords_(spreadsheet, 'Brokers', GF_TABLES.Brokers, data.brokers);
  writeRecords_(spreadsheet, 'Trades', GF_TABLES.Trades, data.trades);
  writeRecords_(spreadsheet, 'CashFlows', GF_TABLES.CashFlows, data.cashFlows);
  const safeSettings = Object.keys(data.settings)
    .filter((key) => !['apiUrl', 'keyId', 'deviceSecret', 'lastSyncedAt'].includes(key))
    .map((key) => [key, JSON.stringify(data.settings[key])]);
  writeRows_(ensureSheet_(spreadsheet, 'Settings', ['key', 'value']), ['key', 'value'], safeSettings);
}

function readRecords_(spreadsheet, name, headers) {
  const sheet = ensureSheet_(spreadsheet, name, headers);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      const value = row[index];
      record[header] = value instanceof Date ? value.toISOString() : value;
    });
    return record;
  }).filter((record) => record.id);
}

function writeRecords_(spreadsheet, name, headers, records) {
  const rows = records.map((record) => headers.map((header) => sanitizeCell_(record[header])));
  writeRows_(ensureSheet_(spreadsheet, name, headers), headers, rows);
}

function writeRows_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  styleHeader_(sheet, headers.length);
}

function sanitizeCell_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sheet, headers.length);
  return sheet;
}

function styleHeader_(sheet, width) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width).setBackground('#5e48ca').setFontColor('#ffffff').setFontWeight('bold');
  sheet.autoResizeColumns(1, width);
}

function readFxRate_() {
  const sheet = getSpreadsheet_().getSheetByName('FXRates');
  if (!sheet || sheet.getLastRow() < 2) throw new Error('fx_rate_not_ready');
  const row = sheet.getRange(2, 1, 1, 4).getValues()[0];
  const rate = Number(row[1]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('fx_rate_not_ready');
  return {
    date: row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Bangkok', 'yyyy-MM-dd') : String(row[0]),
    usdThbRate: rate,
    source: String(row[2] || 'GoogleFinance reference'),
    note: 'อัตราอ้างอิงอาจล่าช้า ควรใช้อัตราจริงของโบรกเกอร์เมื่อถอนเงิน',
  };
}

function audit_(keyId, action, summary) {
  const sheet = ensureSheet_(getSpreadsheet_(), 'AuditLog', ['timestamp', 'keyId', 'action', 'summary']);
  sheet.appendRow([new Date(), sanitizeCell_(keyId), sanitizeCell_(action), JSON.stringify(summary)]);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('run_setupFarmCENT_first');
  return SpreadsheetApp.openById(id);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function safeError_(error) {
  const message = error && error.message ? String(error.message) : 'unknown_error';
  return message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 180);
}
