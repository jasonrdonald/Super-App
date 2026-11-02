// Turns broker files into trades and holdings. Columns are found by their
// heading, so this reads Zerodha's .xlsx tradebooks and its .csv ones alike.

import { readWorkbook, readLegacyWorkbook, parseCsv } from './xlsx.js';

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

/* ---------- Nippon India Mutual Fund: an account statement ---------- */

// Only the fund, folio and each transaction are kept. The statement also carries
// bank details, which the app has no use for.
function nipponTrades(rows) {
  const trades = [];
  let skipped = 0, folio = '';
  for (const x of headedRows(rows, 'acno')) {
    const units = Math.abs(Number(x.units)), amount = Math.abs(Number(x.amount));
    if (!(units > 0) || !(amount > 0)) { skipped++; continue; }
    const [d, m, y] = String(x.trdate).split('/');
    const date = `${y}-${m}-${d}`;
    const what = String(x.trdesc).trim();
    folio ||= String(x.acno);
    trades.push({
      symbol: String(x.funddesc).trim(), isin: '', date, side: /redem|switch out|withdraw/i.test(what) ? 'sell' : 'buy',
      qty: units, price: amount / units, kind: 'mf', exchange: '', series: '', tradeId: `${x.code}-${date}-${what}`, time: `${date}T12:00:00`,
    });
  }
  return { trades, skipped, clientId: folio };
}

/* ---------- Zebpay: crypto ---------- */

// The Consolidated sheet records every movement of coins. A coin put into Earn
// is still yours, so Earning and Lending Debits change nothing here, and the
// Credit that closes a contract only adds its interest. Coin swaps are one for
// one and handled as renames. Addresses and fiat movements aren't kept.
function zebpayTrades(rows) {
  const trades = [];
  const add = (x, side, qty, price, note = '') => {
    const [d, m, y] = String(x.date).split('/');
    const date = `${y}-${m}-${d}`;
    const coin = String(x['coin cryptopack name']).trim();
    const type = String(x['transaction type']).trim();
    trades.push({
      symbol: coin, isin: '', date, side, qty, price, note, kind: 'stock', exchange: 'Zebpay', series: '',
      tradeId: `${x['trade id contract id']}-${type}-${coin}-${date}-${x['time utc']}-${note}`, time: `${date}T${x['time utc']}`,
    });
  };
  for (const x of headedRows(rows, 'transaction type')) {
    const coin = String(x['coin cryptopack name']).trim();
    const type = String(x['transaction type']).trim();
    const qty = Number(x.quantity);
    if (!coin || coin === 'INR') continue;
    if (/ (buy|sell)$/i.test(type) && qty > 0) {
      // The total includes fees and GST, so cost carries them.
      const total = Number(x['total debit credit fiat']) || Number(x['trade amount']);
      add(x, /buy$/i.test(type) ? 'buy' : 'sell', qty, total / qty);
    } else if (type === 'Send') add(x, 'out', qty, 0, 'Sent out of Zebpay');
    else if (type === 'Membership Fees') add(x, 'out', qty, 0, 'Membership fee paid in coin');
    else if (type === 'Receive') add(x, 'buy', qty, 0, 'Received');
    else if (type === 'Earning (Legacy)') add(x, 'buy', qty, 0, 'Reward');
    else if (type === 'Earning Credit' || type === 'Lending Credit') {
      const interest = Number(x['earning interest']);
      if (interest > 0) add(x, 'buy', interest, 0, 'Earn interest');
    }
  }
  return { trades, skipped: 0 };
}

function zebpayContracts(rows) {
  const day = s => { const [d, m, y] = String(s).slice(0, 10).split('-'); return `${y}-${m}-${d}`; };
  return headedRows(rows, 'contractnumber').map(x => ({
    coin: String(x.currencycode).trim(), contract: String(x.contractnumber).trim(), start: day(x['actualstartdate utc']),
    maturity: day(x['maturitydate utc']), rate: String(x.interestrate), tenure: String(x.tenure),
    principal: Number(x.principleamount) || 0, earned: Number(x.accruedearnings) || 0, status: String(x.contractstatus).trim(),
  }));
}

/* ---------- Aionion Capital ---------- */

// Net value includes charges, and the broker's average cost counts them, so the
// price kept is net value per share. Rows carry no trade number, so a repeat of
// an identical fill is told apart by its place among them.
function aionionTrades(rows) {
  const trades = [];
  const seen = new Map();
  let skipped = 0;
  for (const x of headedRows(rows, 'symbol')) {
    const side = String(x.type).toLowerCase();
    if (side !== 'buy' && side !== 'sell') continue;
    const qty = Number(x.quantity), net = Number(x['net value']);
    if (!(qty > 0) || !Number.isFinite(net)) { skipped++; continue; }
    const [d, m, y] = String(x.date).split('/');
    const date = `${y}-${m}-${d}`;
    const fill = `${date}-${x.symbol}-${side}-${qty}-${x.price}`;
    const repeat = seen.get(fill) ?? 0;
    seen.set(fill, repeat + 1);
    trades.push({
      symbol: String(x.symbol).trim(), isin: String(x.isin ?? '').trim(), date, side, qty, price: net / qty, kind: 'stock',
      exchange: '', series: '', tradeId: `${fill}-${repeat}`, time: `${date}T12:00:00`,
    });
  }
  return { trades, skipped };
}

function aionionHoldings(rows) {
  return headedRows(rows, 'symbol').filter(x => /^IN[EF]/.test(String(x.isin))).map(x => ({
    symbol: String(x.symbol).trim(), isin: String(x.isin).trim(), kind: 'stock', sector: '',
    qty: Number(x['units qty']) || 0, avg: Number(x['avg price']) || 0, close: Number(x['market price']) || 0,
  }));
}

// Resolves to { kind: 'tradebook', trades, skipped, clientId } or
// { kind: 'holdings', holdings, asOf, clientId }. `named` means the symbols are
// company names that still need turning into tickers.
export async function parseBrokerFile(file) {
  if (/\.xls$/i.test(file.name)) {
    const [rows] = Object.values(readLegacyWorkbook(await file.arrayBuffer()));
    if (!rows?.some(r => r?.some(c => key(c) === 'trdesc'))) throw new Error(`${file.name} is not an account statement.`);
    return { kind: 'tradebook', ...nipponTrades(rows) };
  }
  if (/\.csv$/i.test(file.name)) {
    const t = table(parseCsv(await file.text()));
    if (t?.items.length && 'stock val' in t.items[0]) return hdfcHoldings(t.items, file);
    if (!t || !t.items.length || !('trade date' in t.items[0])) throw new Error(`${file.name} is not a tradebook.`);
    return { kind: 'tradebook', clientId: '', ...tradesFrom(t.items) };
  }
  const sheets = await readWorkbook(file);
  const first = Object.values(sheets)[0] ?? [];
  if (sheets.Consolidated) return { kind: 'tradebook', clientId: '', ...zebpayTrades(sheets.Consolidated) };
  if (sheets.Earning) return { kind: 'earnings', clientId: '', contracts: zebpayContracts(sheets.Earning) };
  const heading = String(textOf(first, /EQUITY (TRADES|PORTFOLIO) STATEMENT/));
  if (heading) {
    const clientId = String(metaValue(first, 'client id'));
    if (/TRADES/.test(heading)) return { kind: 'tradebook', clientId, ...aionionTrades(first) };
    const asOf = String(textOf(first, /AS ON:/)).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return { kind: 'holdings', holdings: aionionHoldings(first), asOf: asOf ? `${asOf[3]}-${asOf[2]}-${asOf[1]}` : '', clientId };
  }
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
