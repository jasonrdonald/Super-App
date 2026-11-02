// Public market data as files: a folder for each market and a file for each
// month. Nothing here is personal, though the tickers show what you've followed.

import { BACKUP_FILES, backupSources } from './disclosures.js';

const PUBLIC_MARKETS = Object.fromEntries(BACKUP_FILES.map(f => [f.id, f.label]));

const KIND = 'superapp-public-data';
const isMonth = s => /^\d{4}-\d{2}$/.test(s);
const round = v => Number(v.toFixed(4));

function marketOf(symbol, rec) {
  if (symbol.startsWith('US:')) return 'us-stocks';
  if (symbol.startsWith('CR:')) return 'crypto';
  if (symbol.startsWith('FX:')) return 'fx';
  if (symbol.startsWith('IX:')) return 'indices';
  if (symbol.startsWith('EP:')) return 'india-stocks';
  return rec?.schemeCode || /[^A-Z0-9&_.-]/.test(symbol) ? 'mutual-funds' : 'india-stocks';
}

// Split-adjusted prices shift whenever a stock splits, so older months take on the
// new units, worked out from a month's open, which is fixed once that month starts.
export function mergeMonths(old, fresh, since) {
  const recent = Object.entries(fresh).filter(([k]) => k >= since);
  const shared = recent.map(([k]) => k).filter(k => old[k]).sort()[0];
  const ratio = shared ? fresh[shared][0] / old[shared][0] : 1;
  const scale = Math.abs(ratio - 1) > 0.02 ? ratio : 1;
  const out = Object.fromEntries(Object.entries(old).map(([k, [o, c]]) => [k, [o * scale, c * scale]]));
  recent.forEach(([k, v]) => { out[k] = v; });
  return out;
}

export function publicFiles(market, priceMonths, exportedAt) {
  const buckets = new Map();
  const bucket = (name, month) => {
    const path = `${name}/${month}.json`;
    if (!buckets.has(path)) buckets.set(path, { kind: KIND, market: name, month, exportedAt, sources: backupSources(name), prices: {}, dividends: {}, splits: {}, quotes: {} });
    return buckets.get(path);
  };
  const push = (group, symbol, row) => { (group[symbol] ??= []).push(row); };
  const records = new Map(market.map(m => [m.symbol, m]));
  for (const rec of market) {
    const name = marketOf(rec.symbol, rec);
    const { symbol, splits, dividends, eventsAt, ...quote } = rec;
    (splits ?? []).forEach(s => push(bucket(name, s.date.slice(0, 7)).splits, symbol, s));
    (dividends ?? []).forEach(d => push(bucket(name, d.date.slice(0, 7)).dividends, symbol, d));
    if (Object.keys(quote).length) bucket(name, new Date(rec.quotedAt ?? exportedAt).toISOString().slice(0, 7)).quotes[symbol] = quote;
  }
  for (const { symbol, months } of priceMonths) {
    const name = marketOf(symbol, records.get(symbol));
    for (const [month, [open, close]] of Object.entries(months)) bucket(name, month).prices[symbol] = [round(open), round(close)];
  }
  const files = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => ({ path, text: JSON.stringify(data) }));
  const sources = Object.fromEntries(BACKUP_FILES.map(f => [f.id, backupSources(f.id)]));
  const manifest = { kind: `${KIND}-manifest`, exportedAt, sources, files: files.map(f => f.path) };
  return [{ path: 'manifest.json', text: JSON.stringify(manifest, null, 2) }, ...files];
}

// Newer files win. An older file only fills months and events missing here, so
// restoring an old backup can't undo newer data. Returns only what changed.
export function applyPublicFiles(parsed, market, priceMonths) {
  const records = new Map(market.map(m => [m.symbol, m]));
  const series = new Map(priceMonths.map(m => [m.symbol, m]));
  const startAt = new Map(priceMonths.map(m => [m.symbol, m.at]));
  const changed = { market: new Map(), priceMonths: new Map() };
  const recordOf = symbol => {
    const rec = { ...(changed.market.get(symbol) ?? records.get(symbol) ?? { symbol }) };
    changed.market.set(symbol, rec);
    return rec;
  };
  const dated = (rec, field, rows, at) => {
    const newer = at >= (records.get(rec.symbol)?.eventsAt ?? 0);
    const kept = (rec[field] ?? []).filter(x => !(newer && rows.some(r => r.date === x.date)));
    rec[field] = [...kept, ...rows.filter(r => !kept.some(x => x.date === r.date))];
    rec.eventsAt = Math.max(rec.eventsAt ?? 0, at);
  };
  let used = 0;
  for (const file of parsed) {
    if (file?.kind !== KIND || !isMonth(file.month) || !PUBLIC_MARKETS[file.market]) continue;
    used++;
    const at = Date.parse(file.exportedAt) || 0;
    for (const [symbol, candle] of Object.entries(file.prices ?? {})) {
      if (!Array.isArray(candle) || candle.length !== 2 || !candle.every(Number.isFinite)) continue;
      const rec = { ...(changed.priceMonths.get(symbol) ?? series.get(symbol) ?? { symbol, months: {}, at: 0 }) };
      rec.months = { ...rec.months };
      if (at >= (startAt.get(symbol) ?? 0) || !rec.months[file.month]) rec.months[file.month] = candle;
      rec.at = Math.max(rec.at, at);
      changed.priceMonths.set(symbol, rec);
    }
    for (const [symbol, rows] of Object.entries(file.dividends ?? {})) dated(recordOf(symbol), 'dividends', rows, at);
    for (const [symbol, rows] of Object.entries(file.splits ?? {})) dated(recordOf(symbol), 'splits', rows, at);
    for (const [symbol, quote] of Object.entries(file.quotes ?? {})) {
      const rec = recordOf(symbol);
      if (!rec.quotedAt || (quote.quotedAt ?? 0) >= rec.quotedAt) Object.assign(rec, quote);
      rec.eventsAt = Math.max(rec.eventsAt ?? 0, at);
    }
  }
  return { used, market: [...changed.market.values()], priceMonths: [...changed.priceMonths.values()] };
}

// One row a market for the Data sources page.
export function publicSummary(market, priceMonths) {
  const records = new Map(market.map(m => [m.symbol, m]));
  const rows = Object.fromEntries(Object.entries(PUBLIC_MARKETS).map(([id, label]) => [id, { id, label, symbols: 0, withHistory: 0, first: '', last: '', quotedAt: 0, months: new Set() }]));
  for (const m of market) {
    const row = rows[marketOf(m.symbol, m)];
    row.symbols++;
    row.quotedAt = Math.max(row.quotedAt, m.quotedAt ?? 0);
    [...(m.splits ?? []), ...(m.dividends ?? [])].forEach(x => row.months.add(x.date.slice(0, 7)));
    if (m.quotedAt) row.months.add(new Date(m.quotedAt).toISOString().slice(0, 7));
  }
  for (const { symbol, months } of priceMonths) {
    const keys = Object.keys(months).sort();
    if (!keys.length || /^(IX:pe|EP):/.test(symbol)) continue;
    const row = rows[marketOf(symbol, records.get(symbol))];
    row.withHistory++;
    keys.forEach(k => row.months.add(k));
    if (!row.first || keys[0] < row.first) row.first = keys[0];
    if (keys.at(-1) > row.last) row.last = keys.at(-1);
  }
  return Object.values(rows).map(({ months, ...row }) => ({ ...row, files: months.size }));
}

/* ---------- zip: for browsers that can't write to a folder ---------- */

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = bytes => {
  let c = ~0;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};

const le = (...fields) => {
  const out = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [value, size] of fields) {
    if (size === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += size;
  }
  return out;
};

// Stored, not compressed, which keeps this small and needs no library.
export function zipFiles(files, root) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { path, text } of files) {
    const name = enc.encode(`${root}/${path}`);
    const data = enc.encode(text);
    const crc = crc32(data);
    const common = [[20, 2], [0x800, 2], [0, 2], [0, 2], [33, 2], [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2]];
    const head = le([0x04034b50, 4], ...common);
    parts.push(head, name, data);
    central.push(le([0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), name);
    offset += head.length + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  return new Blob([...parts, ...central, le([0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [size, 4], [offset, 4], [0, 2])], { type: 'application/zip' });
}

// Reads the zips above, and ones made by other tools, which usually compress.
export async function unzipFiles(buffer) {
  const view = new DataView(buffer);
  let end = buffer.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(new Uint8Array(buffer, at + 46, nameLength));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (!name.endsWith('.json')) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const bytes = new Uint8Array(buffer, start, packed);
    const text = method === 8
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
      : dec.decode(bytes);
    out.push({ name, text });
  }
  return out;
}
