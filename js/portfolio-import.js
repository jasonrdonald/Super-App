// Turns broker files into trades and holdings. Columns are found by their
// heading, so this reads Zerodha's .xlsx tradebooks and its .csv ones alike.

import { readWorkbook, parseCsv } from './xlsx.js';

const key = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function table(rows) {
  const head = rows.findIndex(r => r.some(c => key(c) === 'symbol'));
  if (head < 0) return null;
  const cols = rows[head].map(key);
  const items = rows.slice(head + 1)
    .map(r => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ''])))
    .filter(x => x.symbol);
  return { items, before: rows.slice(0, head) };
}

const metaValue = (rows, label) => rows.find(r => r.some(c => key(c) === label))?.find(c => c !== '' && key(c) !== label) ?? '';
const textOf = (rows, pattern) => rows.flat().find(c => pattern.test(String(c))) ?? '';

// Excel may store a date as a serial number.
function isoDate(v) {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function tradesFrom(items) {
  const trades = [];
  let skipped = 0;
  for (const x of items) {
    const segment = String(x.segment ?? '').toUpperCase();
    if (segment && segment !== 'EQ' && segment !== 'MF') { skipped++; continue; }
    const side = String(x['trade type']).toLowerCase();
    const qty = Number(x.quantity), price = Number(x.price);
    if ((side !== 'buy' && side !== 'sell') || !(qty > 0) || !Number.isFinite(price)) { skipped++; continue; }
    const date = isoDate(x['trade date']);
    trades.push({
      symbol: String(x.symbol).trim(), isin: String(x.isin ?? '').trim(), date, side, qty, price,
      kind: segment === 'MF' ? 'mf' : 'stock', exchange: String(x.exchange ?? ''), series: String(x.series ?? ''),
      tradeId: String(x['trade id'] ?? ''), time: String(x['order execution time'] ?? ''),
    });
  }
  return { trades, skipped };
}

function holdingsFrom(items, kind) {
  const n = v => Number(v) || 0;
  return items.map(x => ({
    symbol: String(x.symbol).trim(), isin: String(x.isin ?? '').trim(), kind, sector: String(x.sector ?? x['instrument type'] ?? ''),
    qty: n(x['quantity available']) + n(x['quantity discrepant']) + n(x['quantity pledged margin']) + n(x['quantity pledged loan']),
    avg: n(x['average price']), close: n(x['previous closing price']),
  }));
}

/* ---------- HDFC Securities: names instead of tickers ---------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function hdfcDate(s) {
  const [d, m, y] = String(s).split('-');
  return `${y}-${String(MONTHS.indexOf(m.toLowerCase()) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function hdfcTrades(rows) {
  const head = rows.findIndex(r => key(r[0]) === 'scrip name');
  const cols = rows[head].map(key);
  const trades = [];
  let skipped = 0;
  for (const r of rows.slice(head + 1)) {
    if (!r[0]) continue;
    const x = Object.fromEntries(cols.map((c, i) => [c, r[i] ?? '']));
    const side = String(x['buy sell']).toLowerCase();
    const qty = Number(x.qty), price = Number(x['market price']);
    if ((side !== 'buy' && side !== 'sell') || !(qty > 0) || !Number.isFinite(price)) { skipped++; continue; }
    const date = hdfcDate(x['trade date']);
    trades.push({
      symbol: String(x['scrip name']).trim(), isin: '', date, side, qty, price,
      exchange: String(x.exchange ?? ''), series: '', tradeId: String(x['trade no'] ?? ''), time: `${date}T${x['trade time']}`,
    });
  }
  return { trades, skipped };
}

// Some orders show no units, such as an NFO. Another order for the fund within
// a few days gives the NAV, so the units can be worked out from the amount.
function fillUnits(orders) {
  const nearby = o => orders.find(x => x.units > 0 && x.symbol === o.symbol && Math.abs(new Date(x.date) - new Date(o.date)) <= 3 * 864e5);
  return orders.flatMap(o => {
    const known = o.units > 0 ? o : nearby(o);
    if (!known) return [];
    const nav = known.amount / known.units;
    return [{ ...o, qty: o.units > 0 ? o.units : o.amount / nav, price: nav }];
  });
}

function hdfcFunds(rows) {
  const head = rows.findIndex(r => key(r[0]) === 'scheme name');
  const cols = rows[head].map(key);
  const orders = [];
  let skipped = 0;
  for (const r of rows.slice(head + 1)) {
    if (!r[0]) continue;
    const x = Object.fromEntries(cols.map((c, i) => [c, r[i] ?? '']));
    const sideName = String(x['purchase redemption']).toLowerCase();
    if (String(x['order status']).toUpperCase() !== 'VALID' || !(Number(x.amount) > 0)) { skipped++; continue; }
    const date = hdfcDate(x['order date']);
    orders.push({
      symbol: String(x['scheme name']).replace(/\s+--\s+\(.*$/, '').trim().toUpperCase(), isin: String(x.isin ?? '').trim(), kind: 'mf',
      date, side: sideName.startsWith('pur') ? 'buy' : 'sell', amount: Number(x.amount), units: Number(x.quantity) || 0,
      exchange: String(x.exchange ?? ''), series: '', tradeId: String(x['order no'] ?? ''), time: `${date}T${x['order time']}`,
    });
  }
  const trades = fillUnits(orders).map(({ amount, units, ...t }) => t);
  return { trades, skipped: skipped + orders.length - trades.length };
}

function hdfcHoldings(items, file) {
  const d = new Date(file.lastModified);
  const asOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const holdings = items.map(x => ({
    symbol: String(x.symbol).trim(), isin: '', kind: 'stock', sector: '',
    qty: Number(x['avail qty']) || 0, avg: 0, close: Number(x.ltp) || 0,
  }));
  return { kind: 'holdings', named: true, holdings, asOf, clientId: '' };
}

/* ---------- Vested: US shares, in fractions ---------- */

function headedRows(rows, heading) {
  const head = rows.findIndex(r => r.some(c => key(c) === heading));
  if (head < 0) return [];
  const cols = rows[head].map(key);
  return rows.slice(head + 1).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? '']))).filter(x => x[heading]);
}

const clock24 = t => {
  const [, h, m, s, ap] = String(t).match(/(\d+):(\d+):(\d+)\s*(AM|PM)/i) ?? [, '0', '00', '00', 'AM'];
  const hour = (Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${m}:${s}`;
};

// A trade's cash amount includes commission, and the broker's average cost
// counts it, so the price kept here is cash per share.
function vestedTrades(rows) {
  const trades = [];
  let skipped = 0;
  for (const x of headedRows(rows, 'ticker')) {
    const side = String(x.activity).toLowerCase();
    const qty = Number(x.quantity), cash = Number(x['cash amount']);
    if ((side !== 'buy' && side !== 'sell') || !(qty > 0) || !Number.isFinite(cash)) { skipped++; continue; }
    const date = isoDate(x.date);
    const time = `${date}T${clock24(x['time in utc'])}`;
    trades.push({ symbol: String(x.ticker).trim(), isin: '', date, side, qty, price: cash / qty, kind: 'stock', exchange: 'US', series: '', tradeId: `${time}-${x.ticker}`, time });
  }
  return { trades, skipped };
}

function vestedHoldings(rows) {
  const n = v => Number(String(v).replace(/,/g, '')) || 0;
  return headedRows(rows, 'ticker').map(x => ({
    symbol: String(x.ticker).trim(), isin: '', kind: 'stock', sector: '',
    qty: n(x['total shares held']), avg: n(x['average cost']), close: n(x['current price']),
  }));
}

// Resolves to { kind: 'tradebook', trades, skipped, clientId } or
// { kind: 'holdings', holdings, asOf, clientId }. `named` means the symbols are
// company names that still need turning into tickers.
export async function parseBrokerFile(file) {
  if (/\.csv$/i.test(file.name)) {
    const t = table(parseCsv(await file.text()));
    if (t?.items.length && 'stock val' in t.items[0]) return hdfcHoldings(t.items, file);
    if (!t || !t.items.length || !('trade date' in t.items[0])) throw new Error(`${file.name} is not a tradebook.`);
    return { kind: 'tradebook', clientId: '', ...tradesFrom(t.items) };
  }
  const sheets = await readWorkbook(file);
  const first = Object.values(sheets)[0] ?? [];
  if (sheets.Trades && sheets['My Account']) {
    return { kind: 'tradebook', clientId: String(metaValue(sheets['My Account'], 'drivewealth account number')), ...vestedTrades(sheets.Trades) };
  }
  if (sheets.Holdings && sheets['User Details']) {
    const [details] = headedRows(sheets['User Details'], 'period');
    const asOf = String(details?.period ?? '').replace(/^as of\s+/i, '').replace(/\s+/g, '-');
    return { kind: 'holdings', holdings: vestedHoldings(sheets.Holdings), asOf: hdfcDate(asOf), clientId: String(details?.['drivewealth account number'] ?? '') };
  }
  if (first.some(r => key(r[0] ?? '') === 'scheme name')) {
    return { kind: 'tradebook', funds: true, clientId: String(metaValue(first, 'trading id')), ...hdfcFunds(first) };
  }
  if (first.some(r => key(r[0] ?? '') === 'scrip name')) {
    return { kind: 'tradebook', named: true, clientId: String(metaValue(first, 'trading id')), ...hdfcTrades(first) };
  }
  const clientId = String(metaValue(first, 'client id'));
  const title = String(textOf(first, /holdings statement|tradebook/i));
  if (/holdings statement/i.test(title)) {
    const holdings = [];
    for (const [name, rows] of Object.entries(sheets)) {
      if (/combined/i.test(name)) continue;
      const t = table(rows);
      if (t) holdings.push(...holdingsFrom(t.items, /mutual/i.test(name) ? 'mf' : 'stock'));
    }
    return { kind: 'holdings', holdings, asOf: title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '', clientId };
  }
  const t = table(first);
  if (!t || !t.items.length || !('trade date' in t.items[0])) throw new Error(`${file.name} is not a tradebook or holdings file.`);
  return { kind: 'tradebook', clientId, ...tradesFrom(t.items) };
}
