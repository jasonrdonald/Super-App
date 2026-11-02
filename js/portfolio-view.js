import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import { ISSUE_LABEL, xirr, costHeldAt, baseSymbol, buildPositions, summarizePosition, summarizeAll, reconcile, originalShares, splitTaken, cleanAccount, cleanTrade, cleanHoldingsFile, cleanAdjustment, cleanContract, cleanTransfer, cleanFee, cleanNote, cleanMarket } from './portfolio.js';
import { parseBrokerFile } from './portfolio-import.js';
import { stockQuotes, usQuotes, usdInr, stockEvents, fundQuote, fundCodes, fundNav, cryptoQuotes, listedSecurities, EVENT_GAP_MS } from './market.js';
import { CORPORATE_ACTIONS } from './corporate-actions.js';
import { tickerFor, companyPart } from './tickers.js';
import { SOURCES, DATA_POINTS } from './disclosures.js';
import { GROUPINGS, bandOf, orderBands } from './ratings.js';

const KINDS = { stock: 'Stocks', mf: 'Mutual funds', crypto: 'Crypto' };
const BROKERS = ['Zerodha', 'HDFC Securities', 'Vested', 'Nippon MF', 'Aionion Capital', 'Zebpay', 'Blockchain Wallet', 'Coinbase Wallet', 'Other'];
const FX_KEY = 'FX:USDINR';
const US_PREFIX = 'US:';
const CRYPTO_PREFIX = 'CR:';
const isTicker = s => /^[A-Z0-9&_-]+$/.test(s);
const HOME = '#/s/portfolio';
const QUOTE_MAX_AGE = 6 * 60 * 60 * 1000;
const EVENTS_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const EPS = 1e-6;

const COLUMNS = [
  { key: 'symbol', label: 'Ticker', text: true },
  { key: 'name', label: 'Stock name', text: true },
  { key: 'qty', label: 'Shares', f: v => qtyText(v) },
  { key: 'avg', label: 'Cost per share', f: v => perShare(v) },
  { key: 'price', label: 'Last price', f: v => perShare(v), src: 'price' },
  { key: 'cost', label: 'Total cost', f: v => money(v) },
  { key: 'value', label: 'Market value', f: v => money(v), src: 'price' },
  { key: 'dividends', label: 'Total div income', f: v => money(v), src: 'dividends', sub: r => yieldLine(r.yieldOnCost) },
  { key: 'dayPct', label: 'Day gain %', f: v => pct(v), tone: true, src: 'price' },
  { key: 'dayGain', label: 'Day gain', f: v => money(v, true), tone: true, src: 'price' },
  { key: 'gainPct', label: 'Total gain %', f: v => pct(v), tone: true, src: 'gain' },
  { key: 'gain', label: 'Total gain', f: v => money(v, true), tone: true, src: 'gain' },
  { key: 'xirr', label: 'XIRR', f: v => pct(v), tone: true, src: 'xirr' },
  { key: 'realizedPct', label: 'Realized gain %', f: v => pct(v), tone: true },
  { key: 'realized', label: 'Realized gain', f: v => money(v, true), tone: true },
];

const crores = v => {
  if (v == null) return '–';
  if (shown === 'USD') return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v / 1e9)}B`;
  return `₹${new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 0 }).format(v / 1e7)} Cr`;
};
const ratio = v => (v == null ? '–' : v.toFixed(2));
const plainPct = v => (v == null ? '–' : `${v.toFixed(2)}%`);

// Added from the column chooser, in the groups it shows them.
const OPTIONAL = [
  { group: 'Size and sector', cols: [
    { key: 'sector', label: 'Sector', text: true, src: 'sector' },
    { key: 'industry', label: 'Industry', text: true, src: 'sector' },
    { key: 'marketCap', label: 'Market cap', f: crores, src: 'sector' },
  ] },
  { group: 'Dividends', cols: [
    { key: 'divYield', label: 'Dividend yield', f: plainPct, src: 'fundamentals' },
    { key: 'yieldOnCost', label: 'Yield on cost', f: plainPct, src: 'yieldOnCost' },
    { key: 'payout', label: 'Payout ratio', f: plainPct, src: 'quality' },
  ] },
  { group: 'Valuation', cols: [
    { key: 'eps', label: 'EPS', f: v => perShare(v), src: 'fundamentals' },
    { key: 'pe', label: 'P/E', f: ratio, src: 'fundamentals' },
    { key: 'pb', label: 'P/B', f: ratio, src: 'fundamentals' },
    { key: 'ps', label: 'P/S', f: ratio, src: 'fundamentals' },
    { key: 'evEbitda', label: 'EV/EBITDA', f: ratio, src: 'fundamentals' },
  ] },
  { group: 'Profitability', cols: [
    { key: 'roe', label: 'ROE', f: plainPct, src: 'profitability' },
    { key: 'roce', label: 'ROCE', f: plainPct, src: 'profitability' },
    { key: 'roic', label: 'ROIC', f: plainPct, src: 'profitability' },
    { key: 'roa', label: 'ROA', f: plainPct, src: 'profitability' },
    { key: 'grossMargin', label: 'Gross margin', f: plainPct, src: 'profitability' },
    { key: 'operatingMargin', label: 'Operating margin', f: plainPct, src: 'profitability' },
    { key: 'netMargin', label: 'Net margin', f: plainPct, src: 'profitability' },
  ] },
  { group: 'Quality', cols: [
    { key: 'debtEquity', label: 'Debt-to-equity', f: ratio, src: 'quality' },
    { key: 'currentRatio', label: 'Current ratio', f: ratio, src: 'quality' },
    { key: 'fcf', label: 'Free cash flow', f: crores, tone: true, src: 'quality' },
    { key: 'piotroski', label: 'Piotroski score', f: v => (v == null ? '–' : String(v)), src: 'quality' },
    { key: 'beta', label: 'Beta', f: ratio, src: 'quality' },
  ] },
  { group: 'Growth', cols: [
    { key: 'revenueGrowth', label: 'Revenue growth', f: v => pct(v), tone: true, src: 'growth' },
    { key: 'epsGrowth', label: 'EPS growth', f: v => pct(v), tone: true, src: 'growth' },
    { key: 'profitGrowth', label: 'Profit growth', f: v => pct(v), tone: true, src: 'growth' },
  ] },
  { group: 'Momentum', cols: [
    { key: 'pos52', label: '52-week range', f: (v, r) => (r.low52 == null ? '–' : `${perShare(r.low52)} – ${perShare(r.high52)}`), src: 'momentum' },
    { key: 'fromHigh', label: 'From 52-week high', f: v => pct(v), tone: true, src: 'momentum' },
    { key: 'perf1m', label: '1-month return', f: v => pct(v), tone: true, src: 'momentum' },
    { key: 'perf3m', label: '3-month return', f: v => pct(v), tone: true, src: 'momentum' },
    { key: 'perf6m', label: '6-month return', f: v => pct(v), tone: true, src: 'momentum' },
    { key: 'perf1y', label: '1-year return', f: v => pct(v), tone: true, src: 'momentum' },
    { key: 'rsi', label: 'RSI', f: ratio, src: 'momentum' },
    { key: 'vsSma200', label: 'Vs 200-day average', f: v => pct(v), tone: true, src: 'momentum' },
  ] },
];
const OPTIONAL_COLUMNS = OPTIONAL.flatMap(g => g.cols);

// The chosen columns stay after the standard ones, in chooser order.
const chosenColumns = () => {
  const picked = new Set(A.ls.get('pfColumns', ['divYield', 'pe', 'roe']));
  return OPTIONAL_COLUMNS.filter(c => picked.has(c.key));
};
const BROKERS_COLUMN = { key: 'brokers', label: 'Brokers', text: true, links: true };
const columns = () => [...COLUMNS.slice(0, 2), ...(mergedPage ? [BROKERS_COLUMN] : []), ...COLUMNS.slice(2), ...chosenColumns()];
const columnOf = key => columns().find(c => c.key === key) ?? COLUMNS[0];

const yieldLine = v => (v == null || v <= 0 ? '' : `${v.toFixed(2)}% on cost`);

const GROUPS = ['Stocks', 'ETFs', 'Commodities', 'Debt', 'Mutual funds', 'Crypto'];
const ASSETS = {
  equity: { label: 'Stocks & ETFs', groups: ['Stocks', 'ETFs'] },
  commodities: { label: 'Commodities', groups: ['Commodities'] },
  debt: { label: 'Debt', groups: ['Debt'] },
  mf: { label: 'Mutual funds', groups: ['Mutual funds'] },
};

const EVENT_LABEL = {
  buy: 'Bought', sell: 'Sold', split: 'Split', bonus: 'Bonus', merger: 'Merger', rename: 'Renamed',
  demerger: 'Demerger', dividend: 'Dividend', adjust: 'Broker adjustment', allot: 'Allotment', out: 'Moved out', arrive: 'Transferred in',
};

const ACTION_KINDS = new Set(['split', 'bonus', 'merger', 'rename', 'demerger', 'allot', 'adjust']);

const V = { sort: 'value', dir: -1, show: 'current', asset: 'all', q: '' };
const pickedBrokers = new Set();
let mergedPage = false;
const job = { running: false, done: 0, total: 0, failed: 0 };
let firstVisit = true;

let A;
export function initPortfolio(helpers) { A = helpers; }

const cache = new Map();
const building = new Set();
const invalidate = () => cache.clear();

const accountById = id => A.S.brokerAccounts.find(a => a.id === id);
const accounts = () => [...A.S.brokerAccounts].sort((a, b) => a.createdAt - b.createdAt);
const holdingsOf = id => A.S.brokerHoldings.find(h => h.id === id);
const accountPath = id => `${HOME}/a/${id}`;

// The currency on screen: a broker's own on its pages, rupees on the main page.
let shown = CONFIG.currency;
const formatters = {
  [CONFIG.currency]: new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
const MASK = '••••••';
const isPrivate = () => A.ls.get('pfPrivate', false);

// Per-share figures are public prices, so privacy mode leaves them showing.
function perShare(v) {
  if (v == null) return '–';
  return formatters[shown].format(v);
}

function money(v, signed) {
  if (v == null) return '–';
  if (isPrivate()) return MASK;
  const text = formatters[shown].format(v);
  return signed && v > 0 ? `+${text}` : text;
}
const pct = v => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
// Coins can be far below one, where three decimals would show nothing.
const qtyText = v => (isPrivate() ? MASK : new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: Math.abs(v) < 1 ? 8 : 3 }).format(v));
const tone = v => (v == null || Math.abs(v) < 0.005 ? '' : v > 0 ? 'up' : 'down');
const day = s => A.fmt(new Date(`${s}T00:00:00`), { dateStyle: 'medium' });

/* ---------- derived data ---------- */

const isUsd = account => account.currency === 'USD';
const fxRate = () => A.S.market.find(m => m.symbol === FX_KEY)?.price ?? null;

// Market data for an account's own market, under its plain symbols. US records
// are kept apart, as a ticker can mean different companies in each country.
const marketPrefix = account => (isUsd(account) ? US_PREFIX : account.kind === 'crypto' ? CRYPTO_PREFIX : '');

function marketFor(account) {
  const prefix = marketPrefix(account);
  if (!prefix) return A.S.market.filter(m => !m.symbol.includes(':'));
  return A.S.market.filter(m => m.symbol.startsWith(prefix)).map(m => ({ ...m, symbol: m.symbol.slice(prefix.length) }));
}

// Earn contracts still running. Their coins stay in holdings the whole time.
const lockedOf = (accountId, coin) => A.S.earnContracts.filter(c => c.accountId === accountId && c.coin === coin && c.status === 'Active');

function lockedLine(account, symbol) {
  const list = lockedOf(account.id, symbol);
  if (!list.length) return '';
  return list.map(c => `Locked in Earn: ${qtyText(c.principal)} ${c.coin} until ${day(c.maturity)} at ${c.rate}`).join(' · ');
}

/* ---------- transfers ---------- */

// A send stays a plain removal until it's linked to the account that received
// the coins. Then those coins arrive there with their original dates and cost.
const sends = () => A.S.trades.filter(t => t.side === 'out' && /^Sent/.test(t.note));
const transferOf = tradeId => A.S.transfers.find(x => x.tradeId === tradeId);
const coinsFeeOn = tradeId => A.S.brokerFees.filter(f => f.tradeId === tradeId).reduce((n, f) => n + f.qty, 0);
const outEvent = (accountId, coin, tradeId) => computed(accountById(accountId)).positions.get(coin)?.events.find(e => e.kind === 'out' && e.tradeId === tradeId);

function arrivals(account) {
  return A.S.transfers.filter(x => x.toAccountId === account.id && x.received > 0).flatMap(x => {
    const from = accountById(x.fromAccountId);
    // Coins sent back and forth can't be worked out from each other, so that link waits.
    if (!from || building.has(from.id)) return [];
    const sent = outEvent(from.id, x.coin, x.tradeId);
    if (!sent) return [];
    return [{ type: 'arrive', symbol: x.coin, date: x.date, lots: splitTaken(sent.taken, x.received).kept, source: `Transferred from ${from.name} on ${day(x.date)}` }];
  });
}

function quoteFor(symbol, rows, market) {
  const m = market.find(x => x.symbol === symbol);
  if (m?.price != null) return m;
  const file = rows.find(r => baseSymbol(r.symbol) === symbol);
  return file?.close ? { price: file.close, change: null } : null;
}

// A fund of gold or bonds isn't shares, and only its name says so. Miners are
// companies, so a gold miners ETF stays put, as do hybrids that part-hold debt.
function fundGroup(name, rest) {
  if (/\b(gold|silver|commodit(y|ies))\b/i.test(name) && !/\bminers?\b/i.test(name)) return 'Commodities';
  const debt = /\b(bonds?|gilt|g-?sec|government securities|liquid|debt|treasury|t-?bills?|overnight|money market|(ultra short|short|low|medium|long) duration|credit risk|floating rate|floater)\b/i;
  return debt.test(name) && !/\b(equity|hybrid|balanced)\b/i.test(name) ? 'Debt' : rest;
}

// ETFs trade like stocks, but every fund's ISIN starts with INF.
function grouper(account, rows, trades) {
  const known = new Map(rows.map(r => [baseSymbol(r.symbol), r]));
  trades.forEach(t => { if (!known.has(baseSymbol(t.symbol))) known.set(baseSymbol(t.symbol), t); });
  return symbol => {
    if (account.kind === 'crypto') return 'Crypto';
    const row = known.get(symbol);
    if (account.kind === 'mf' || row?.kind === 'mf') return 'Mutual funds';
    return row?.isin?.startsWith('INF') ? 'ETFs' : 'Stocks';
  };
}

function computed(account) {
  if (cache.has(account.id)) return cache.get(account.id);
  building.add(account.id);
  const file = holdingsOf(account.id);
  const rows = file?.rows ?? [];
  const trades = A.S.trades.filter(t => t.accountId === account.id);
  const groupOf = grouper(account, rows, trades);
  const market = marketFor(account);
  const positions = buildPositions({
    trades,
    holdings: rows,
    market,
    own: [...A.S.portfolioActions.filter(a => a.accountId === account.id), ...arrivals(account)],
    fractional: isUsd(account),
  });
  const lines = [...positions.values()]
    .filter(p => p.lots.length || p.realized.length || p.dividends || p.events.some(e => e.kind === 'allot'))
    .map(p => {
      const record = market.find(m => m.symbol === p.symbol);
      const f = record?.f ?? {};
      const raw = groupOf(p.symbol);
      // US tickers carry no ISIN, so the scanner says which are funds.
      const kind = raw === 'Stocks' && f.type === 'fund' ? 'ETFs' : raw;
      const mutualFund = kind === 'Mutual funds';
      const group = mutualFund || kind === 'ETFs' ? fundGroup(`${p.symbol} ${record?.name ?? ''}`, kind) : kind;
      const line = { ...summarizePosition(p, quoteFor(p.symbol, rows, market)), group, mutualFund, name: record?.name ?? (mutualFund ? p.symbol : '') };
      const fileRow = rows.find(r => baseSymbol(r.symbol) === p.symbol);
      if (isUsd(account) && f.marketCap != null) line.capInr = f.marketCap * (fxRate() ?? 1);
      Object.assign(line, f, { sector: f.sector ?? (fileRow?.sector || undefined) });
      // The scanner reports a 0% payout for many companies that do pay dividends.
      if (!line.payout && line.divYield) line.payout = null;
      const { price, high52: high, low52: low, sma200 } = line;
      if (price != null && high != null) {
        line.fromHigh = (price / high - 1) * 100;
        line.pos52 = high > low ? (price - low) / (high - low) * 100 : null;
      }
      if (price != null && sma200) line.vsSma200 = (price / sma200 - 1) * 100;
      return line;
    });
  const held = lines.filter(l => l.qty > EPS);
  const result = {
    positions, lines, held,
    summary: summarizeAll(lines),
    recon: rows.length ? reconcile(positions, rows) : null,
  };
  cache.set(account.id, result);
  building.delete(account.id);
  return result;
}

const MONEY_FIELDS = ['cost', 'value', 'gain', 'dayGain', 'dividends', 'dividends12m', 'realized', 'soldCost'];

function inRupees(line, rate) {
  const out = { ...line };
  for (const key of MONEY_FIELDS) if (out[key] != null) out[key] *= rate;
  out.flows = (line.flows ?? []).map(f => ({ ...f, amount: f.amount * rate }));
  return out;
}

export const portfolioTileText = () => {
  if (isPrivate()) return MASK;
  return new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 }).format(portfolioTotal().value);
};

// Everything in rupees. Without a rate, USD brokers can't be added in.
export function portfolioTotal() {
  const rate = fxRate();
  return summarizeAll(accounts().flatMap(a => {
    const { lines } = computed(a);
    if (!isUsd(a)) return lines;
    return rate ? lines.map(l => inRupees(l, rate)) : [];
  }));
}

// A USD line as a full table row in rupees, per-share figures included.
function rupeeRow(line, rate) {
  const out = inRupees(line, rate);
  for (const key of ['avg', 'price', 'eps', 'high52', 'low52', 'fcf']) if (out[key] != null) out[key] *= rate;
  return { ...out, marketCap: line.capInr ?? line.marketCap };
}

// One ticker's lines from several brokers as one row. Fundamentals are the same
// for all of them, so only what depends on the shares held is worked out again.
function mergeLines(held) {
  const lines = held.map(h => h.line);
  const row = { ...(lines.find(l => l.price != null) ?? lines[0]), holders: held.map(h => h.account), brokers: held.map(h => h.account.name).join(', ') };
  if (lines.length === 1) return row;
  const sum = key => lines.reduce((n, l) => n + (l[key] ?? 0), 0);
  for (const key of MONEY_FIELDS) row[key] = lines.every(l => l[key] == null) ? null : sum(key);
  const pricedCost = lines.filter(l => l.gain != null).reduce((n, l) => n + l.cost, 0);
  row.qty = sum('qty');
  row.avg = row.qty > EPS ? row.cost / row.qty : 0;
  row.flows = lines.flatMap(l => l.flows ?? []);
  row.xirr = xirr(row.flows);
  row.gainPct = row.gain != null && pricedCost > 0 ? row.gain / pricedCost * 100 : null;
  row.realizedPct = row.soldCost > 0 ? row.realized / row.soldCost * 100 : null;
  row.yieldOnCost = row.cost > 0 ? row.dividends12m / row.cost * 100 : null;
  return row;
}

// Every picked broker's lines in rupees, one row a ticker. Markets stay apart, as
// a ticker can mean different things in each. No rate leaves USD brokers out.
function consolidatedLines() {
  const rate = fxRate();
  const picked = accounts().filter(a => pickedBrokers.has(a.id));
  const byTicker = new Map();
  for (const account of (picked.length ? picked : accounts()).filter(a => !isUsd(a) || rate)) {
    for (const line of computed(account).lines) {
      const key = marketPrefix(account) + line.symbol;
      byTicker.set(key, [...(byTicker.get(key) ?? []), { account, line: isUsd(account) ? rupeeRow(line, rate) : line }]);
    }
  }
  return [...byTicker.values()].map(mergeLines);
}

export const portfolioNav = () => [
  { id: 'home', name: 'Overview', icon: 'pie', href: HOME },
  { id: 'consolidated', name: 'Consolidated', icon: 'list', href: `${HOME}/consolidated` },
  { id: 'reports', name: 'Reports', icon: 'file', href: `${HOME}/reports` },
  { id: 'transfers', name: 'Transfers', icon: 'swap', href: `${HOME}/transfers` },
  ...accounts().map(a => ({ id: a.id, name: a.name, icon: a.kind === 'crypto' ? 'cloud' : a.kind === 'mf' ? 'chart' : 'card', href: accountPath(a.id) })),
];

export function portfolioRouteValid(r) {
  if (['home', 'add', 'reports', 'transfers', 'consolidated'].includes(r.page)) return true;
  if (!accountById(r.id)) return false;
  if (r.page === 'stock') return !!computed(accountById(r.id)).positions.get(r.symbol);
  return ['account', 'reconcile', 'trade'].includes(r.page);
}

/* ---------- market refresh ---------- */

function saveMarket(symbol, patch) {
  const rec = A.S.market.find(m => m.symbol === symbol) ?? { symbol };
  if (!A.S.market.includes(rec)) A.S.market.push(rec);
  Object.assign(rec, patch);
  return rec;
}

function showStatus() {
  const el = A.$('#pf-status');
  if (el) el.innerHTML = statusLine();
}

function redraw() {
  invalidate();
  const r = A.S.route;
  if (r?.name !== 'portfolio' || ['add', 'trade'].includes(r.page) || A.$('#modal').open) return;
  if (document.activeElement?.matches('input')) return showStatus();
  const scroller = A.$('.scroll');
  const top = scroller?.scrollTop ?? 0;
  const tableLeft = A.$('.holdings-wrap')?.scrollLeft ?? 0;
  A.refresh();
  if (A.$('.scroll')) A.$('.scroll').scrollTop = top;
  if (A.$('.holdings-wrap')) A.$('.holdings-wrap').scrollLeft = tableLeft;
}

async function refreshQuotes() {
  const stock = new Set(), funds = new Map(), coins = new Set(), us = new Set();
  for (const a of accounts()) {
    if (isUsd(a)) {
      computed(a).lines.forEach(l => { us.add(l.symbol); });
      continue;
    }
    const rows = holdingsOf(a.id)?.rows;
    for (const line of computed(a).lines) {
      const open = line.qty > EPS;
      // A fund the broker no longer lists was probably redeemed, so it isn't valued.
      const listed = !rows || rows.some(r => baseSymbol(r.symbol) === line.symbol);
      if (line.group === 'Crypto') { if (open) coins.add(line.symbol); }
      else if (line.mutualFund) { if (open && listed) funds.set(line.symbol, line.symbol); }
      // Sold stocks are looked up too, for their names.
      else if (isTicker(line.symbol)) stock.add(line.symbol);
    }
  }
  const t = Date.now();
  const changed = [];
  const apply = (symbol, q) => changed.push(saveMarket(symbol, { ...q, quotedAt: t }));
  if (stock.size) (await stockQuotes([...stock])).forEach((q, s) => apply(s, q));
  if (us.size) {
    (await usQuotes([...us])).forEach((q, s) => apply(US_PREFIX + s, q));
    const rate = await usdInr();
    if (rate) apply(FX_KEY, { price: rate });
  }
  if (coins.size) (await cryptoQuotes([...coins])).forEach((q, s) => apply(CRYPTO_PREFIX + s, q));
  const fileRow = name => A.S.brokerHoldings.flatMap(h => h.rows).find(x => baseSymbol(x.symbol) === name);
  for (const name of funds.keys()) {
    const isin = fileRow(name)?.isin || A.S.trades.find(t => t.symbol === name)?.isin;
    const known = A.S.market.find(m => m.symbol === name)?.schemeCode;
    const code = known ?? (isin ? (await fundCodes().catch(() => new Map())).get(isin) : null);
    if (code) {
      const q = await fundNav(code).catch(() => null);
      if (q) apply(name, { ...q, schemeCode: code });
      continue;
    }
    // Fund names vary, so a NAV far from the last known price is the wrong plan.
    const lastTrade = A.S.trades.filter(t => t.symbol === name).reduce((a, t) => (!a || t.date > a.date ? t : a), null);
    const near = fileRow(name)?.close || lastTrade?.price;
    const q = await fundQuote(name, near).catch(() => null);
    if (q && (!near || Math.abs(q.price - near) / near < 0.2)) apply(name, q);
  }
  await db.putMany('market', changed);
  A.ls.set('pfQuotedAt', t);
  return changed.length;
}

function eventSymbols() {
  const t = Date.now();
  const held = new Set();
  const all = new Map();
  for (const a of accounts()) {
    if (a.kind !== 'stock') continue;
    const rows = holdingsOf(a.id)?.rows ?? [];
    const c = computed(a);
    const prefix = isUsd(a) ? US_PREFIX : '';
    const funds = new Set(rows.filter(r => r.kind === 'mf').map(r => baseSymbol(r.symbol)));
    c.held.forEach(l => { if (!funds.has(l.symbol)) held.add(prefix + l.symbol); });
    for (const p of c.positions.values()) {
      if (!p.events.length || funds.has(p.symbol) || p.symbol.endsWith('-RE') || !isTicker(p.symbol.replace('.', ''))) continue;
      const first = p.events.reduce((d, e) => (e.date < d ? e.date : d), '9999');
      if (first < (all.get(prefix + p.symbol) ?? '9999')) all.set(prefix + p.symbol, first);
    }
  }
  const due = [...all.keys()].filter(s => {
    const m = A.S.market.find(x => x.symbol === s);
    return !m?.eventsAt || t - m.eventsAt > EVENTS_MAX_AGE;
  });
  // What you hold now decides the numbers on screen, so it loads first.
  return due.sort((a, b) => held.has(b) - held.has(a)).map(s => [s, all.get(s)]);
}

// The relay allows about 20 calls a minute, so a first load runs in the background.
async function refreshEvents() {
  if (job.running) return;
  const list = eventSymbols();
  if (!list.length) return;
  Object.assign(job, { running: true, done: 0, total: list.length, failed: 0 });
  showStatus();
  for (const [symbol, from] of list) {
    const started = Date.now();
    try {
      // History starts well before the first trade, so nothing near it is missed.
      const us = symbol.startsWith(US_PREFIX);
      const events = await stockEvents(us ? symbol.slice(US_PREFIX.length) : symbol, `${Number(from.slice(0, 4)) - 1}-01-01`, us);
      await db.put('market', saveMarket(symbol, { ...(events ?? { splits: [], dividends: [] }), eventsAt: Date.now() }));
    } catch {
      job.failed++;
    }
    job.done++;
    if (job.done % 10 === 0) redraw();
    else showStatus();
    await new Promise(r => setTimeout(r, Math.max(0, EVENT_GAP_MS - (Date.now() - started))));
  }
  job.running = false;
  redraw();
}

async function refreshMarket(manual) {
  const btn = A.$('[data-act=pf-refresh]');
  if (btn) btn.disabled = true;
  try {
    const n = await refreshQuotes();
    if (manual) A.toast(`Updated ${A.plural(n, 'price')}`);
    redraw();
  } catch (e) {
    if (manual) A.toast(`Could not update prices: ${e.message}`);
  }
  if (btn) btn.disabled = false;
  refreshEvents();
}

function statusLine() {
  const at = A.ls.get('pfQuotedAt', 0);
  const quoted = at ? `Prices updated ${A.relDate(at)}, delayed.` : 'Prices not loaded yet.';
  if (job.running) return `${icon('clock')}<span>${quoted} Loading splits and dividends: ${job.done} of ${job.total}. Figures update as they arrive.</span>`;
  if (job.failed) return `${icon('alert')}<span>${quoted} ${A.plural(job.failed, 'stock')} could not load splits or dividends; refresh to retry.</span>`;
  return `${icon('clock')}<span>${quoted}</span>`;
}

/* ---------- shared pieces ---------- */

function hero(title, sub, up, extra = '') {
  return `<header class="topbar hero">
    ${A.upButton(up)}
    <span class="hero-icon">${icon('pie')}</span>
    <div class="titles"><h1>${A.esc(title)}</h1><p>${A.esc(sub)}</p></div>
    ${privacyButton()}${extra}${A.menuButton}
  </header>`;
}

const privacyButton = () => `<button class="icon-btn" data-act="pf-privacy" aria-pressed="${isPrivate()}" aria-label="${isPrivate() ? 'Show amounts' : 'Hide amounts'}" title="${isPrivate() ? 'Show amounts' : 'Hide amounts'}">${icon(isPrivate() ? 'eyeOff' : 'eye')}</button>`;

const info = id => `<button class="pf-info" data-act="pf-info" data-id="${id}" aria-label="Data source">${icon('info')}</button>`;

function stat(label, value, note = '', cls = '') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span><span class="stat-note ${cls}">${note}</span></div>`;
}

function summaryStats(s) {
  return `<div class="stats five">
    ${stat(`Total amount${info('price')}`, money(s.value), `Invested ${money(s.cost)}${s.unpriced ? `, ${s.unpriced} unpriced left out` : ''}`)}
    ${stat(`Unrealized gain/loss${info('gain')}`, money(s.gain, true), pct(s.gainPct), tone(s.gain))}
    ${stat(`XIRR${info('xirr')}`, pct(s.xirr), 'Annual return', tone(s.xirr))}
    ${stat('Realized gain/loss', money(s.realized, true), pct(s.realizedPct), tone(s.realized))}
    ${stat(`Day change${info('price')}`, money(s.dayGain, true), pct(s.dayPct), tone(s.dayGain))}
    ${stat(`Total dividends${info('dividends')}`, money(s.dividends), s.yieldOnCost ? `${s.yieldOnCost.toFixed(2)}% yield on cost${info('yieldOnCost')}` : '')}
  </div>`;
}

/* ---------- backup ---------- */

const BACKUP_MARK = 'superapp-portfolio';

const backupButtons = (add = '') => `<div class="btn-row">
    ${add}
    ${add && A.S.brokerAccounts.length ? `<button class="btn sm" data-act="pf-refresh">${icon('restore')}<span>Refresh all</span></button>` : ''}
    ${A.S.brokerAccounts.length ? `<button class="btn sm" data-act="pf-backup">${icon('download')}<span>Back up all brokers</span></button>` : ''}
    <label class="btn sm">${icon('upload')}<span>Import brokers</span><input id="pf-restore" type="file" accept=".json,application/json" hidden></label>
  </div>`;

// Splits and dividends travel with the backup, so a restore skips their slow first load.
export const portfolioBackupText = () => JSON.stringify({
  app: BACKUP_MARK,
  version: 1,
  exportedAt: new Date().toISOString(),
  brokerAccounts: A.S.brokerAccounts,
  trades: A.S.trades,
  brokerHoldings: A.S.brokerHoldings,
  portfolioActions: A.S.portfolioActions,
  portfolioNotes: A.S.portfolioNotes,
  earnContracts: A.S.earnContracts,
  transfers: A.S.transfers,
  brokerFees: A.S.brokerFees,
  market: A.S.market,
}, null, 1);

async function saveBackup() {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const name = `superapp-brokers-backup-${stamp}.json`;
  const body = portfolioBackupText();
  // Where the browser allows it, you pick the folder; elsewhere it goes to Downloads.
  if (window.showSaveFilePicker) {
    try {
      // The id makes the browser reopen the folder used last time.
      const handle = await showSaveFilePicker({ id: 'superapp-brokers', suggestedName: name, types: [{ description: 'SuperApp backup', accept: { 'application/json': ['.json'] } }] });
      const out = await handle.createWritable();
      await out.write(body);
      await out.close();
      return A.toast(`Saved ${handle.name}`);
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  A.downloadFile(new File([body], name, { type: 'application/json' }));
}

// Market data stays: it is public, and slow to load again.
async function clearBrokers() {
  for (const store of ['brokerAccounts', 'trades', 'brokerHoldings', 'portfolioActions', 'portfolioNotes', 'earnContracts', 'transfers', 'brokerFees']) {
    await db.clear(store);
    A.S[store] = [];
  }
}

// Merges like the app-wide backup: the newer copy of each row wins, and nothing
// is deleted unless you choose to clear first. Quotes and history are compared
// by when they were fetched.
async function restoreBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return A.toast('That file is not valid JSON.');
  }
  if (data?.app !== BACKUP_MARK || !Array.isArray(data.brokerAccounts) || !Array.isArray(data.trades)) {
    return A.toast('This file is not a SuperApp brokers backup.');
  }
  const rows = (name, clean) => (Array.isArray(data[name]) ? data[name] : []).map(clean).filter(Boolean);
  const accountsIn = rows('brokerAccounts', cleanAccount);
  const ids = new Set(accountsIn.map(a => a.id));
  const tradesIn = rows('trades', cleanTrade).filter(t => ids.has(t.accountId));
  if (!accountsIn.length) return A.toast('This backup has no brokers in it.');
  const brokers = accountsIn.map(a => a.name).join(', ');
  const v = await formDialog(`Import ${A.plural(accountsIn.length, 'broker')}?`, `
    <p>${A.esc(brokers)}: ${A.plural(tradesIn.length, 'trade')} from “${A.esc(file.name)}”.</p>
    ${A.S.brokerAccounts.length ? `<p>Without clearing, these merge into your ${A.plural(A.S.brokerAccounts.length, 'broker')}: newer versions win and nothing is deleted.</p>
    <label class="switch"><input type="checkbox" name="clear"><span>Clear all existing brokers first. Their trades, holdings, overrides and notes are permanently removed from this device.</span></label>` : ''}`, 'Import');
  if (!v) return;
  if (v.clear) await clearBrokers();

  const merge = async (store, items, key, stamp) => {
    const index = new Map(A.S[store].map(x => [x[key], x]));
    const changed = [];
    for (const item of items) {
      const cur = index.get(item[key]);
      if (!cur) { A.S[store].push(item); changed.push(item); }
      else if (stamp(item) > stamp(cur)) { Object.assign(cur, item); changed.push(cur); }
    }
    await db.putMany(store, changed);
    return changed.length;
  };
  const edited = x => x.updatedAt;
  const added = await merge('brokerAccounts', accountsIn, 'id', edited);
  const trades = await merge('trades', tradesIn, 'id', edited);
  await merge('brokerHoldings', rows('brokerHoldings', cleanHoldingsFile).filter(h => ids.has(h.id)), 'id', edited);
  await merge('portfolioActions', rows('portfolioActions', cleanAdjustment).filter(a => ids.has(a.accountId)), 'id', edited);
  await merge('portfolioNotes', rows('portfolioNotes', cleanNote).filter(n => ids.has(n.accountId)), 'id', edited);
  await merge('earnContracts', rows('earnContracts', cleanContract).filter(c => ids.has(c.accountId)), 'id', edited);
  await merge('transfers', rows('transfers', cleanTransfer).filter(x => ids.has(x.fromAccountId)), 'id', edited);
  await merge('brokerFees', rows('brokerFees', cleanFee).filter(f => ids.has(f.accountId)), 'id', edited);
  await merge('market', rows('market', cleanMarket), 'symbol', m => Math.max(m.eventsAt ?? 0, m.quotedAt ?? 0));
  A.markDirty();
  invalidate();
  A.toast(`Imported ${A.plural(added, 'new broker')} and ${A.plural(trades, 'new trade')}`);
  firstVisit = true;
  if (A.S.route.page === 'home') A.refresh();
  else A.go(HOME, true);
}

function bindRestore() {
  A.$('#pf-restore')?.addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) restoreBackup(file);
  });
}

/* ---------- overview ---------- */

const fxNote = list => (list.some(isUsd) ? `<div class="status">${fxRate() ? `USD brokers are converted at ${perShare(fxRate())} to the dollar` : 'No USD rate yet, so USD brokers are left out of these totals'}${info('fx')}</div>` : '');

function homeView(r) {
  const list = accounts();
  const add = `<a class="btn sm primary" href="${HOME}/add">${icon('plus')}<span>Add broker account</span></a>${list.length ? `<a class="btn sm" href="${HOME}/consolidated">${icon('list')}<span>Consolidated</span></a><a class="btn sm" href="${HOME}/reports">${icon('file')}<span>Reports</span></a><a class="btn sm" href="${HOME}/transfers">${icon('swap')}<span>Transfers</span></a>` : ''}`;
  const body = list.length
    ? `<div class="pay-page pf-page">
        ${summaryStats(portfolioTotal())}
        <div class="status" id="pf-status">${statusLine()}</div>
        ${fxNote(list)}
        ${backupButtons(add)}
        <div class="rows pf-accounts">${list.map(a => {
          const { summary: s, held } = computed(a);
          const rupees = isUsd(a) && fxRate() ? money(s.value * fxRate()) : '';
          shown = a.currency ?? CONFIG.currency;
          const card = `<a class="sub pf-account" href="${accountPath(a.id)}">
            <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
            <span class="card-meta">${A.esc(a.broker)} · ${KINDS[a.kind]} · ${A.plural(held.length, 'holding')}${rupees ? ` · ${rupees}` : ''}</span></span></span>
            <span class="pay-side"><span class="pay-amount">${money(s.value)}</span><span class="pf-delta ${tone(s.gain)}">${money(s.gain, true)} (${pct(s.gainPct)})</span></span>
          </a>`;
          shown = CONFIG.currency;
          return card;
        }).join('')}</div>
      </div>`
    : `<div class="empty">${icon('pie')}<p>Add a broker account for your stocks, mutual funds or crypto, then load its tradebooks.</p><div class="pf-start">${backupButtons(add)}</div></div>`;
  A.view.innerHTML = `${hero('Portfolio', A.plural(list.length, 'broker account'), '#/')}
    <div class="scroll">${body}</div>`;
  bindRestore();
}

/* ---------- add account ---------- */

function addView() {
  A.view.innerHTML = `
    <header class="topbar">${A.upButton(HOME)}<div class="titles"><h1>Add broker account</h1><p>Portfolio</p></div>${A.menuButton}</header>
    <div class="scroll"><form class="pay-form" id="pf-form" novalidate>
      <label class="f wide"><span>Account name</span><input name="name" required maxlength="80" placeholder="e.g. Zerodha" autocomplete="off"></label>
      <label class="f"><span>Broker</span><select name="broker">${BROKERS.map(b => `<option>${b}</option>`).join('')}</select></label>
      <label class="f"><span>Account type</span><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="f"><span>Currency</span><select name="currency"><option value="INR">INR</option><option value="USD">USD</option></select></label>
      <label class="f wide"><span>Load tradebooks and holdings</span><input name="files" type="file" multiple accept=".xlsx,.xls,.csv"></label>
      <p class="muted small wide">Pick every yearly tradebook, plus the holdings file to reconcile against. You can load more later.</p>
      <div class="f-actions wide"><button class="btn primary" type="submit">Add account</button><a class="btn ghost" href="${HOME}">Cancel</a></div>
      <div class="wide pf-or"><p class="muted small">Or import one or more brokers from a backup instead:</p>${backupButtons()}</div>
    </form></div>`;
  bindRestore();
  const form = A.$('#pf-form');
  form.elements.broker.addEventListener('change', e => {
    form.elements.currency.value = e.target.value === 'Vested' ? 'USD' : 'INR';
    if (e.target.value === 'Nippon MF') form.elements.kind.value = 'mf';
    if (['Zebpay', 'Blockchain Wallet', 'Coinbase Wallet'].includes(e.target.value)) form.elements.kind.value = 'crypto';
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = new FormData(form);
    const name = d.get('name').trim();
    if (!name) return A.toast('Give the account a name.');
    const t = Date.now();
    const account = { id: A.uid(), name, broker: d.get('broker'), kind: d.get('kind'), currency: d.get('currency'), clientId: '', createdAt: t, updatedAt: t };
    A.S.brokerAccounts.push(account);
    await A.persist('brokerAccounts', account);
    invalidate();
    const files = form.elements.files.files;
    if (files.length) await loadFiles(account, files);
    A.go(accountPath(account.id), true);
  });
}

// Holdings first: their prices pin down the ticker, and a tradebook then uses
// the same symbol for the same company.
async function resolveNames(parsed) {
  const list = await listedSecurities();
  for (const p of parsed.filter(x => x.named && x.holdings)) {
    p.holdings = p.holdings.map(h => {
      const t = tickerFor(h.symbol, list, h.close);
      if (t) return { ...h, symbol: t.symbol, isin: t.isin ?? '' };
      return { ...h, symbol: companyPart(h.symbol), kind: /FUND|ASSET MANAGEMENT/.test(h.symbol.toUpperCase()) ? 'mf' : 'stock' };
    });
  }
  const seen = new Map();
  for (const p of parsed.filter(x => x.named && x.trades)) {
    p.trades = p.trades.map(t => {
      if (!seen.has(t.symbol)) seen.set(t.symbol, tickerFor(t.symbol, list));
      const hit = seen.get(t.symbol);
      return { ...t, symbol: hit?.symbol ?? companyPart(t.symbol), isin: hit?.isin ?? '' };
    });
  }
}

// A holdings file may call a fund something quite unlike its order reports, so
// the link is the unit count, which is exact to three decimals, plus the fund house.
async function linkFunds(account) {
  const file = holdingsOf(account.id);
  if (!file) return;
  const units = new Map();
  for (const t of A.S.trades.filter(x => x.accountId === account.id && x.kind === 'mf')) {
    const row = units.get(t.symbol) ?? { units: 0, isin: t.isin };
    row.units += t.side === 'sell' ? -t.qty : t.qty;
    units.set(t.symbol, row);
  }
  const firstWord = s => s.split(/\s+/)[0].toUpperCase();
  let changed = false;
  for (const row of file.rows.filter(r => r.kind === 'mf' && !units.has(r.symbol))) {
    const match = [...units].find(([name, u]) => Math.abs(u.units - row.qty) < 0.02 && firstWord(name) === firstWord(row.symbol));
    if (match) { Object.assign(row, { symbol: match[0], isin: match[1].isin }); changed = true; }
  }
  if (changed) await db.put('brokerHoldings', file);
}

async function loadFiles(account, files) {
  const parsed = [];
  for (const file of files) {
    try {
      parsed.push(await parseBrokerFile(file));
    } catch (e) {
      A.toast(e.message);
    }
  }
  if (parsed.some(p => p.named)) {
    try {
      await resolveNames(parsed);
    } catch (e) {
      return A.toast(`Could not match company names to tickers: ${e.message}`);
    }
  }
  const ids = new Set(parsed.map(p => p.clientId).filter(Boolean));
  if (ids.size > 1 || (account.clientId && [...ids].some(c => c !== account.clientId))) {
    return A.toast('These files belong to a different client ID.');
  }
  account.clientId ||= [...ids][0] ?? '';
  const known = new Set(A.S.trades.filter(t => t.accountId === account.id).map(t => t.id));
  const tradeKey = t => `${account.id}:${t.symbol}:${t.date}:${t.exchange}:${t.tradeId}`;
  const fresh = [];
  let skipped = 0;
  for (const p of parsed) {
    skipped += p.skipped ?? 0;
    for (const t of p.trades ?? []) {
      const id = tradeKey(t);
      if (known.has(id)) continue;
      known.add(id);
      fresh.push({ ...t, id, accountId: account.id, updatedAt: Date.now() });
    }
  }
  A.S.trades.push(...fresh);
  await db.putMany('trades', fresh);
  // The latest file wins, as a contract's status changes over its life.
  const contracts = parsed.flatMap(p => p.contracts ?? []).map(c => ({ ...c, id: `${account.id}:${c.contract}`, accountId: account.id, updatedAt: Date.now() }));
  const newIds = new Set(contracts.map(c => c.id));
  A.S.earnContracts = [...A.S.earnContracts.filter(c => !newIds.has(c.id)), ...contracts];
  await db.putMany('earnContracts', contracts);
  // Fees are kept by their row, so loading a file again updates rather than repeats.
  const fees = parsed.flatMap(p => p.fees ?? []).map(({ key, trade, ...f }) => ({
    coin: '', qty: 0, amount: 0, ...f, id: `${account.id}:${key}:${f.kind}`, accountId: account.id, tradeId: trade ? tradeKey(trade) : '', updatedAt: Date.now(),
  }));
  const feeIds = new Set(fees.map(f => f.id));
  A.S.brokerFees = [...A.S.brokerFees.filter(f => !feeIds.has(f.id)), ...fees];
  await db.putMany('brokerFees', fees);
  const statements = parsed.filter(p => p.kind === 'holdings').sort((a, b) => a.asOf.localeCompare(b.asOf));
  const latest = statements.at(-1);
  if (latest && latest.asOf >= (holdingsOf(account.id)?.asOf ?? '')) {
    const rec = { id: account.id, asOf: latest.asOf, rows: latest.holdings, updatedAt: Date.now() };
    A.S.brokerHoldings = [...A.S.brokerHoldings.filter(h => h.id !== account.id), rec];
    await db.put('brokerHoldings', rec);
  }
  await linkFunds(account);
  account.updatedAt = Date.now();
  await A.persist('brokerAccounts', account);
  invalidate();
  A.toast(`Loaded ${A.plural(fresh.length, 'new trade')}${latest ? ` and holdings as on ${day(latest.asOf)}` : ''}${skipped ? `, skipped ${skipped} other rows` : ''}`);
  refreshMarket();
}

/* ---------- holdings table ---------- */

const sortDirLabel = () => (columnOf(V.sort).text
  ? (V.dir > 0 ? 'A to Z ▲' : 'Z to A ▼')
  : (V.dir > 0 ? 'Low to high ▲' : 'High to low ▼'));

const linesInView = c => c.lines.filter(l => V.asset === 'all' || ASSETS[V.asset].groups.includes(l.group));

function rowsToShow(c) {
  const q = V.q.trim().toLowerCase();
  const rows = linesInView(c)
    .filter(l => (V.show === 'sold' ? l.qty <= EPS : V.show === 'current' ? l.qty > EPS : true))
    .filter(l => !q || `${l.symbol} ${l.name}`.toLowerCase().includes(q));
  const col = columnOf(V.sort);
  return rows.sort((a, b) => {
    if (col.text) return (a[col.key] || '').localeCompare(b[col.key] || '') * V.dir;
    return ((a[col.key] ?? -Infinity) - (b[col.key] ?? -Infinity)) * V.dir;
  });
}

function holdingsTable(account, c) {
  const rows = rowsToShow(c);
  if (!rows.length) return `<div class="empty">${icon('card')}<p>${V.q ? 'No holdings match.' : 'No holdings here. Load a tradebook or add a transaction.'}</p></div>`;
  return bucketsOf(rows)
    .map(([g, list]) => `<section class="pf-group"><h2>${A.esc(g)} (${list.length})</h2>${groupTable(account, list)}</section>`)
    .join('');
}

function bucketsOf(rows) {
  const key = groupKey();
  const names = key === 'asset'
    ? GROUPS.filter(g => rows.some(r => r.group === g))
    : orderBands(key, new Set(rows.map(r => bandOf(key, r))));
  const inGroup = key === 'asset' ? (r, g) => r.group === g : (r, g) => bandOf(key, r) === g;
  return names.map(g => [g, rows.filter(r => inGroup(r, g))]);
}

// One line a bucket. Sold holdings count too, so the total ties to the cards above.
function summaryTable(c) {
  const rows = linesInView(c);
  if (!rows.length) return `<div class="empty">${icon('card')}<p>No holdings here.</p></div>`;
  const all = summarizeAll(rows);
  const line = (s, list) => `<td class="num">${list.filter(l => l.qty > EPS).length}</td>
    <td class="num">${money(s.cost)}</td>
    <td class="num">${money(s.value)}</td>
    <td class="num">${all.value ? plainPct(s.value / all.value * 100) : '–'}</td>
    <td class="num ${tone(s.dayGain)}">${money(s.dayGain, true)}<small>${pct(s.dayPct)}</small></td>
    <td class="num ${tone(s.gain)}">${money(s.gain, true)}<small>${pct(s.gainPct)}</small></td>
    <td class="num ${tone(s.xirr)}">${pct(s.xirr)}</td>
    <td class="num">${money(s.dividends)}</td>
    <td class="num ${tone(s.realized)}">${money(s.realized, true)}<small>${pct(s.realizedPct)}</small></td>`;
  return `<div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>${A.esc(GROUPINGS[groupKey()].label)}</th>${['Holdings', 'Invested', 'Market value', 'Share', 'Day gain', 'Total gain', 'XIRR', 'Dividends', 'Realized gain'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
    <tbody>${bucketsOf(rows).map(([g, list]) => `<tr><th scope="row">${A.esc(g)}</th>${line(summarizeAll(list), list)}</tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th>${line(all, rows)}</tr></tfoot>
  </table></div>`;
}

const groupKey = () => {
  const key = A.ls.get('pfGroupBy', 'asset');
  return GROUPINGS[key] ? key : 'asset';
};

function columnHeader(col) {
  const on = V.sort === col.key;
  return `<th${col.text ? '' : ' class="num"'} aria-sort="${on ? (V.dir > 0 ? 'ascending' : 'descending') : 'none'}"><span class="pf-th"><button data-sort="${col.key}">${col.label}${on ? (V.dir > 0 ? ' ▲' : ' ▼') : ''}</button>${col.src ? info(col.src) : ''}</span></th>`;
}

function groupTable(account, rows) {
  const total = summarizeAll(rows);
  const COLS = columns();
  const cell = (col, r) => {
    const v = r[col.key];
    if (col.links) return `<td class="pf-name" title="${A.esc(v)}">${r.holders.map(a => `<a class="pf-link" href="${accountPath(a.id)}/h/${encodeURIComponent(r.symbol)}">${A.esc(a.name)}</a>`).join(', ')}</td>`;
    if (col.text) return `<td class="pf-name" title="${A.esc(v)}">${A.esc(v) || '–'}</td>`;
    const sub = col.sub?.(r);
    return `<td class="num ${col.tone ? tone(v) : ''}">${col.f(v, r)}${sub ? `<small>${sub}</small>` : ''}</td>`;
  };
  const totals = { xirr: total.xirr, cost: total.cost, value: total.value, dividends: total.dividends, dayGain: total.dayGain, dayPct: total.dayPct, gain: total.gain, gainPct: total.gainPct, realized: total.realized, realizedPct: total.realizedPct };
  return `<div class="holdings-wrap"><table class="holdings">
    <thead><tr>${COLS.map(columnHeader).join('')}</tr></thead>
    <tbody>${rows.map(r => {
      const owners = account ? [account] : r.holders;
      const details = owners.map(a => reviewDetails(a, r.symbol)).filter(Boolean).join(' · ');
      const locked = owners.map(a => lockedLine(a, r.symbol)).filter(Boolean).join(' · ');
      return `<tr>
      <th scope="row"><a href="${accountPath(owners[0].id)}/h/${encodeURIComponent(r.symbol)}">${A.esc(r.symbol)}</a></th>
      ${COLS.slice(1).map(col => cell(col, r)).join('')}
    </tr>${details ? `<tr class="lot-note"><td colspan="${COLS.length}">${icon('check')}${A.esc(details)}</td></tr>` : ''}${locked ? `<tr class="lot-note"><td colspan="${COLS.length}">${icon('lock')}${A.esc(locked)}</td></tr>` : ''}`;
    }).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th>${COLS.slice(1).map(col => (col.key in totals ? `<td class="num ${col.tone ? tone(totals[col.key]) : ''}">${col.f(totals[col.key], total)}${col.sub?.(total) ? `<small>${col.sub(total)}</small>` : ''}</td>` : '<td></td>')).join('')}</tr></tfoot>
  </table></div>`;
}

function reconChip(account, c) {
  if (!c.recon) return '';
  const bad = c.recon.filter(x => x.status !== 'ok').length;
  const label = bad ? `${bad} to reconcile` : 'Reconciled';
  return `<a class="btn sm" href="${accountPath(account.id)}/reconcile">${icon(bad ? 'alert' : 'check')}<span>${label}</span></a>`;
}

// The holdings page shared by each broker and the consolidated view, where account is null.
function holdingsBody(account, c, { filter = '', notes = '', tools = '', summary = false }) {
  const tabs = Object.entries(ASSETS).filter(([, a]) => c.lines.some(l => a.groups.includes(l.group)));
  if (!tabs.some(([k]) => k === V.asset)) V.asset = 'all';
  if (!columns().some(col => col.key === V.sort)) V.sort = 'value';
  const inView = linesInView(c);
  const open = inView.filter(l => l.qty > EPS).length;
  const sold = inView.length - open;
  return `
      ${filter}
      ${tabs.length > 1 ? `<div class="seg pf-assets" role="group" aria-label="Asset type">
        ${[['all', 'All'], ...tabs.map(([k, a]) => [k, a.label])].map(([k, l]) => `<button data-asset="${k}" aria-pressed="${V.asset === k}">${l}</button>`).join('')}
      </div>` : ''}
      ${summaryStats(summarizeAll(inView))}
      <div class="status" id="pf-status">${statusLine()}</div>
      ${notes}
      <div class="period">
        ${summary ? '' : `<div class="seg" role="group" aria-label="Which holdings">
          ${[['current', `Current (${open})`], ['sold', `Sold (${sold})`], ['all', 'All']].map(([k, l]) => `<button data-show="${k}" aria-pressed="${V.show === k}">${l}</button>`).join('')}
        </div>`}
        ${tools}
      </div>
      ${summary ? '' : `<label class="search flush">${icon('search')}<input type="search" id="pf-q" placeholder="Search holdings" value="${A.esc(V.q)}" autocomplete="off"></label>
      <div class="pf-sort">
        <label for="pf-sort">Sort by</label>
        <select class="select" id="pf-sort">${columns().map(col => `<option value="${col.key}"${col.key === V.sort ? ' selected' : ''}>${col.label}</option>`).join('')}</select>
        <button class="btn sm" id="pf-dir">${sortDirLabel()}</button>
      </div>`}
      <div class="pf-sort">
        <label for="pf-group">Group by</label>
        <select class="select" id="pf-group">${Object.entries(GROUPINGS).map(([k, g]) => `<option value="${k}"${k === groupKey() ? ' selected' : ''}>${g.label}</option>`).join('')}</select>
        ${summary ? '' : `<button class="btn sm" data-act="pf-columns">${icon('columns')}<span>Columns</span></button>`}
      </div>
      <div id="pf-table">${summary ? summaryTable(c) : holdingsTable(account, c)}</div>`;
}

function bindHoldings(table, again) {
  const draw = () => {
    A.$('#pf-table').innerHTML = table();
    if (!A.$('#pf-sort')) return;
    A.$('#pf-sort').value = V.sort;
    A.$('#pf-dir').textContent = sortDirLabel();
  };
  const sortBy = key => {
    V.sort = key;
    V.dir = columnOf(key).text ? 1 : -1;
    draw();
  };
  A.$('#pf-sort')?.addEventListener('change', e => sortBy(e.target.value));
  A.$('#pf-group').addEventListener('change', e => { A.ls.set('pfGroupBy', e.target.value); draw(); });
  A.$('#pf-dir')?.addEventListener('click', () => { V.dir = -V.dir; draw(); });
  A.$('#pf-q')?.addEventListener('input', e => { V.q = e.target.value; draw(); });
  A.view.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => { V.show = b.dataset.show; again(); }));
  A.view.querySelectorAll('[data-asset]').forEach(b => b.addEventListener('click', () => { V.asset = b.dataset.asset; again(); }));
  A.$('#pf-table').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    if (V.sort !== b.dataset.sort) return sortBy(b.dataset.sort);
    V.dir = -V.dir;
    draw();
  });
}

function accountView(r) {
  const account = accountById(r.id);
  const c = computed(account);
  const tools = `${reconChip(account, c)}
        <button class="btn sm" data-act="pf-refresh">${icon('restore')}<span>Refresh</span></button>
        <label class="btn sm">${icon('upload')}<span>Load files</span><input id="pf-files" type="file" multiple accept=".xlsx,.xls,.csv" hidden></label>`;
  A.view.innerHTML = `
    ${hero(account.name, `${account.broker} · ${KINDS[account.kind]}${account.clientId ? ` · ${account.clientId}` : ''}`, HOME,
      `<button class="icon-btn" data-act="pf-menu" data-id="${account.id}" aria-label="Account options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      ${holdingsBody(account, c, { tools })}
      ${feesPanel(account, c)}
    </div></div>
    <a class="fab" href="${accountPath(account.id)}/trade" aria-label="Add transaction">${icon('plus')}</a>`;
  bindHoldings(() => holdingsTable(account, computed(account)), () => accountView(r));
  A.$('#pf-files').addEventListener('change', async e => {
    const files = e.target.files;
    if (files.length) await loadFiles(account, files);
    A.refresh();
  });
}

/* ---------- consolidated ---------- */

const summaryOnly = () => A.ls.get('pfConsolidatedView', 'summary') === 'summary';

function brokerFilter(list) {
  const chosen = list.filter(a => pickedBrokers.has(a.id));
  const button = (id, name, on) => `<button data-broker="${id}" aria-pressed="${on}">${A.esc(name)}</button>`;
  return `<div class="seg pf-assets" role="group" aria-label="View">
        ${[['summary', 'Summary', summaryOnly()], ['detailed', 'Detailed', !summaryOnly()]].map(([k, l, on]) => `<button data-view="${k}" aria-pressed="${on}">${l}</button>`).join('')}
      </div>
      <div class="seg pf-assets" role="group" aria-label="Brokers">
        ${button('all', 'All brokers', !chosen.length)}${list.map(a => button(a.id, a.name, pickedBrokers.has(a.id))).join('')}
      </div>`;
}

function consolidatedView() {
  const list = accounts();
  const c = { lines: consolidatedLines() };
  const held = c.lines.filter(l => l.qty > EPS).length;
  const count = new Set(c.lines.flatMap(l => l.holders.map(a => a.id))).size;
  const tools = `<button class="btn sm" data-act="pf-refresh">${icon('restore')}<span>Refresh</span></button>`;
  const summary = summaryOnly();
  A.view.innerHTML = `
    ${hero('Consolidated portfolio', `${A.plural(held, 'holding')} · ${A.plural(count, 'broker')}`, HOME)}
    <div class="scroll"><div class="pay-page pf-page">
      ${holdingsBody(null, c, { filter: brokerFilter(list), notes: fxNote(list), tools, summary })}
    </div></div>`;
  bindHoldings(() => (summary ? summaryTable(c) : holdingsTable(null, c)), consolidatedView);
  A.view.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { A.ls.set('pfConsolidatedView', b.dataset.view); consolidatedView(); }));
  A.view.querySelectorAll('[data-broker]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.broker;
    if (id === 'all') pickedBrokers.clear();
    else if (!pickedBrokers.delete(id)) pickedBrokers.add(id);
    if (pickedBrokers.size === list.length) pickedBrokers.clear();
    consolidatedView();
  }));
}

async function chooseColumns() {
  const picked = new Set(chosenColumns().map(c => c.key));
  const v = await formDialog('Columns', `<div class="pf-columns">${OPTIONAL.map(g => `<fieldset><legend>${g.group}</legend>
    ${g.cols.map(c => `<label class="switch"><input type="checkbox" name="${c.key}"${picked.has(c.key) ? ' checked' : ''}><span>${c.label}</span></label>`).join('')}
  </fieldset>`).join('')}</div>`, 'Apply');
  if (!v) return;
  A.ls.set('pfColumns', OPTIONAL_COLUMNS.filter(c => v[c.key] === 'on').map(c => c.key));
  if (!columns().some(c => c.key === V.sort)) V.sort = 'value';
  A.refresh();
}

function showSource(id) {
  const point = DATA_POINTS.find(d => d.id === id);
  const names = [...new Set(point.sources.map(s => SOURCES[s].name))].join(', ');
  A.toast(`Source: ${names}`, { label: 'Disclosure', fn: () => A.go('#/disclosure') });
}

export function disclosureView() {
  const used = Object.entries(SOURCES);
  const rules = Object.values(GROUPINGS).filter(g => g.rule);
  A.view.innerHTML = `
    <header class="topbar">${A.upButton('#/')}<div class="titles"><h1>Data disclosure</h1><p>Where every outside figure comes from</p></div>${A.menuButton}</header>
    <div class="scroll"><div class="pay-page pf-page">
      <p class="muted">Figures are for your own tracking, not investment advice. Free sources can be late, wrong or stop working, so check anything important against your broker. Only ticker symbols and fund or coin names are sent to these sources, never your quantities or amounts.</p>
      <section class="panel"><h2>Data sources (${used.length})</h2><div class="holdings-wrap"><table class="holdings lots pf-disclosure">
        <thead><tr><th>Source</th><th>Format</th><th>Timing</th><th>Notes</th></tr></thead>
        <tbody>${used.map(([, s]) => `<tr><td>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${A.esc(s.name)}</a>` : A.esc(s.name)}</td><td>${A.esc(s.format)}</td><td>${A.esc(s.timing)}</td><td>${A.esc(s.note)}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="panel"><h2>Data points (${DATA_POINTS.length})</h2><div class="holdings-wrap"><table class="holdings lots pf-disclosure">
        <thead><tr><th>Figure</th><th>Source</th><th>Format</th><th>Timing</th><th>How it's worked out</th></tr></thead>
        <tbody>${DATA_POINTS.map(d => {
          const list = d.sources.map(s => SOURCES[s]);
          const unique = key => [...new Set(list.map(s => s[key]))].map(A.esc).join('<br>');
          return `<tr><td>${A.esc(d.label)}</td><td>${unique('name')}</td><td>${unique('format')}</td><td>${unique('timing')}</td><td>${A.esc(d.how ?? '')}</td></tr>`;
        }).join('')}</tbody>
      </table></div></section>
      <section class="panel"><h2>How holdings are grouped</h2><dl class="facts pf-rules">${rules.map(g => `<div><dt>${g.label}</dt><dd>${A.esc(g.rule)}</dd></div>`).join('')}</dl></section>
    </div></div>`;
}

/* ---------- reports ---------- */

const R = { broker: 'all', year: 'all' };
const REPORTS = { dividends: 'Dividends', gains: 'Capital gains', earn: 'Crypto earnings', fees: 'Fees' };

// Indian financial years run April to March, named by the year they start.
const fyStart = date => Number(date.slice(0, 4)) - (date.slice(5, 7) < '04' ? 1 : 0);
const fyName = y => `FY${y}-${String(y + 1).slice(2)}`;
const monthKey = date => date.slice(0, 7);
const monthText = (key, opts) => A.fmt(new Date(`${key}-01T00:00:00`), opts);

// Each broker's positions, with a rate to bring its money into what's on screen.
function reportBrokers() {
  const list = accounts().filter(a => R.broker === 'all' || a.id === R.broker);
  shown = R.broker !== 'all' && list[0]?.currency === 'USD' ? 'USD' : CONFIG.currency;
  return list.map(a => ({ account: a, c: computed(a), rate: shown === CONFIG.currency && isUsd(a) ? fxRate() ?? 0 : 1 }));
}

function reportFilters(years, extra = '') {
  const year = years.includes(Number(R.year)) ? R.year : 'all';
  R.year = year;
  return `<div class="pf-sort pf-filters">
    <label for="r-broker">Broker</label>
    <select class="select" id="r-broker"><option value="all">All brokers</option>${accounts().map(a => `<option value="${a.id}"${a.id === R.broker ? ' selected' : ''}>${A.esc(a.name)}</option>`).join('')}</select>
    <label for="r-year">Year</label>
    <select class="select" id="r-year"><option value="all">All years</option>${years.map(y => `<option value="${y}"${String(y) === String(year) ? ' selected' : ''}>${fyName(y)}</option>`).join('')}</select>
    <span class="pf-checks">${extra}<label class="switch pf-detail"><input type="checkbox" id="r-detail"${detailed() ? ' checked' : ''}><span>Detailed report</span></label></span>
  </div>`;
}

const detailed = () => A.ls.get('pfReportDetail', false);
const payersOnly = () => A.ls.get('pfPayersOnly', false);

const inYear = date => R.year === 'all' || fyStart(date) === Number(R.year);

// One bar a month: April to March for a year, every month since the first for All.
function monthBars(amounts) {
  let keys;
  if (R.year === 'all') {
    const known = [...amounts.keys()].sort();
    if (!known.length) return '';
    keys = [];
    for (let k = known[0]; k <= known.at(-1);) {
      keys.push(k);
      const [y, m] = k.split('-').map(Number);
      k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  } else {
    const y = Number(R.year);
    keys = Array.from({ length: 12 }, (_, i) => `${i < 9 ? y : y + 1}-${String((i + 3) % 12 + 1).padStart(2, '0')}`);
  }
  const max = Math.max(...keys.map(k => amounts.get(k) ?? 0));
  if (!max) return '';
  const peak = keys.find(k => amounts.get(k) === max);
  const long = keys.length > 12;
  return `<section class="panel">
    <h2>Dividends by month</h2>
    <p class="muted small chart-note">Highest: ${monthText(peak, { month: 'long', year: 'numeric' })}, ${money(max)}</p>
    <div class="months${long ? ' long' : ''}">${keys.map(k => {
      const v = amounts.get(k) ?? 0;
      const text = `${monthText(k, { month: 'short', year: 'numeric' })}: ${money(v)}`;
      const label = !long ? monthText(k, { month: 'short' }) : k.endsWith('-01') ? k.slice(0, 4) : '';
      return `<button class="month" tabindex="-1" data-tip="${text}" aria-label="${text}"><span class="month-plot">${v ? `<span class="bar paid" style="height:${v / max * 100}%"></span>` : ''}</span><span class="month-name">${label}</span></button>`;
    }).join('')}</div>
  </section>`;
}

function dividendReport() {
  const brokers = reportBrokers();
  const all = brokers.flatMap(({ account, c, rate }) => [...c.positions.values()].flatMap(p => p.dividendEvents.map(d => ({ ...d, amount: d.amount * rate, symbol: p.symbol, account }))));
  const years = [...new Set(all.map(d => fyStart(d.date)))].sort((a, b) => b - a);
  const filters = reportFilters(years, `<label class="switch pf-detail"><input type="checkbox" id="r-payers"${payersOnly() ? ' checked' : ''}><span>Paying stocks only</span></label>`);
  const rows = all.filter(d => inYear(d.date));
  const total = rows.reduce((n, d) => n + d.amount, 0);
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${Number(R.year) + 1}-03-31`;
  const end = R.year === 'all' || yearEnd > today ? today : yearEnd;
  const byMonth = new Map();
  rows.forEach(d => byMonth.set(monthKey(d.date), (byMonth.get(monthKey(d.date)) ?? 0) + d.amount));
  const byStock = new Map();
  for (const d of rows) {
    const key = `${d.account.id}:${d.symbol}`;
    const row = byStock.get(key) ?? { symbol: d.symbol, account: d.account, amount: 0, count: 0 };
    row.amount += d.amount;
    row.count++;
    if (d.date > (row.last ?? '')) row.last = d.date;
    byStock.set(key, row);
  }
  // What was invested in a stock by the period's end. One sold before then still
  // earned its dividends, so it counts at what was held when it last paid.
  const baseOf = row => {
    const { c, rate } = brokers.find(b => b.account === row.account);
    const p = c.positions.get(row.symbol);
    if (!p) return 0;
    return (costHeldAt(p, end) || (row.last ? costHeldAt(p, row.last) : 0)) * rate;
  };
  const payers = [...byStock.values()];
  // What was held at the period's end. Only stocks and stock ETFs count, as the rest mostly pay nothing.
  const stocks = brokers.flatMap(({ account, c }) => c.lines
    .filter(l => ASSETS.equity.groups.includes(l.group) && costHeldAt(c.positions.get(l.symbol), end) > 0)
    .map(l => ({ symbol: l.symbol, account, amount: 0, count: 0 })));
  const quiet = stocks.filter(s => !byStock.has(`${s.account.id}:${s.symbol}`));
  const payingCost = payers.reduce((n, p) => n + baseOf(p), 0);
  const heldAtEnd = brokers.reduce((n, { c, rate }) => n + [...c.positions.values()].reduce((m, p) => m + costHeldAt(p, end) * rate, 0), 0);
  // Payers sold before the end count in the overall base too, so it covers the same dividends.
  const allCost = heldAtEnd + payers.reduce((n, p) => {
    const { c } = brokers.find(b => b.account === p.account);
    return n + (costHeldAt(c.positions.get(p.symbol), end) ? 0 : baseOf(p));
  }, 0);
  const yieldText = (amount, base) => (base ? `${(amount / base * 100).toFixed(2)}%` : '–');
  const list = [...payers, ...(payersOnly() ? [] : quiet)].sort((a, b) => b.amount - a.amount);
  return `${filters}
    <div class="stats">
      ${stat(`Total dividends${info('dividends')}`, money(total), A.plural(rows.length, 'payment'))}
      ${stat(`Yield at cost: paying / overall${info('yieldOnCost')}`, `${yieldText(total, payingCost)} / ${yieldText(total, allCost)}`, R.year === 'all' ? 'All years together' : 'For this year')}
      ${stat('Stocks that paid / total stocks', `${payers.length} / ${payers.length + quiet.length}`, `Held by ${day(end)}, plus any sold that paid`)}
      ${payersOnly()
        ? stat('Cumulative invested in payers', money(payingCost), `To ${day(end)}, base for the paying yield`)
        : stat('Cumulative invested', money(allCost), `To ${day(end)}, base for the overall yield`)}
    </div>
    ${monthBars(byMonth)}
    ${!list.length ? `<div class="empty">${icon('file')}<p>No dividends for this selection.</p></div>` : !detailed() ? '' : `<section class="panel"><h2>By stock</h2><div class="holdings-wrap"><table class="holdings lots">
      <thead><tr><th>Stock</th><th>Broker</th><th class="num">Payments</th><th class="num">Dividends</th><th class="num">Yield at cost</th></tr></thead>
      <tbody>${list.map(row => {
        const base = baseOf(row);
        return `<tr><td><a class="pf-link" href="${accountPath(row.account.id)}/h/${encodeURIComponent(row.symbol)}">${A.esc(row.symbol)}</a></td><td>${A.esc(row.account.name)}</td><td class="num">${row.count}</td><td class="num">${money(row.amount)}</td><td class="num">${base ? `${(row.amount / base * 100).toFixed(2)}%` : '–'}</td></tr>`;
      }).join('')}</tbody>
    </table></div></section>`}
    <p class="muted small">Before tax. Worked out from Yahoo Finance dividend history and what you held on each ex-date, so it may differ slightly from what reached your bank. Yield is on the cumulative amount invested up to the end of the selected period, net of shares sold by then.</p>`;
}

// Over 12 months is long term, or over 24 for shares held abroad.
function gainType(sale, us) {
  if (sale.intraday) return 'Intraday';
  const limit = `${Number(sale.buyDate.slice(0, 4)) + (us ? 2 : 1)}${sale.buyDate.slice(4)}`;
  return sale.sellDate > limit ? 'Long term' : 'Short term';
}

function gainsReport() {
  const brokers = reportBrokers();
  const all = brokers.flatMap(({ account, c, rate }) => [...c.positions.values()].flatMap(p => p.realized.map(s => ({
    ...s, symbol: p.symbol, account, type: gainType(s, isUsd(account)),
    proceeds: s.qty * s.price * rate, costBasis: s.qty * s.cost * rate, gain: s.qty * (s.price - s.cost) * rate,
  }))));
  const years = [...new Set(all.map(s => fyStart(s.sellDate)))].sort((a, b) => b - a);
  const filters = reportFilters(years);
  const rows = all.filter(s => inYear(s.sellDate)).sort((a, b) => b.sellDate.localeCompare(a.sellDate));
  const sum = (list, key) => list.reduce((n, s) => n + s[key], 0);
  const ofType = t => sum(rows.filter(s => s.type === t), 'gain');
  const total = sum(rows, 'gain');
  const costBasis = sum(rows, 'costBasis');
  const byStock = new Map();
  for (const s of rows) {
    const key = `${s.account.id}:${s.symbol}`;
    const row = byStock.get(key) ?? { symbol: s.symbol, account: s.account, proceeds: 0, 'Short term': 0, 'Long term': 0, Intraday: 0, gain: 0 };
    row.proceeds += s.proceeds;
    row.gain += s.gain;
    row[s.type] += s.gain;
    byStock.set(key, row);
  }
  const cellGain = v => `<td class="num ${tone(v)}">${v ? money(v, true) : '–'}</td>`;
  return `${filters}
    <div class="stats">
      ${stat(`Total realized gain${info('capitalGains')}`, money(total, true), costBasis ? pct(total / costBasis * 100) : '', tone(total))}
      ${stat('Short term', money(ofType('Short term'), true), '', tone(ofType('Short term')))}
      ${stat('Long term', money(ofType('Long term'), true), '', tone(ofType('Long term')))}
      ${stat('Intraday', money(ofType('Intraday'), true), '', tone(ofType('Intraday')))}
    </div>
    ${!rows.length ? `<div class="empty">${icon('file')}<p>No sales for this selection.</p></div>` : !detailed() ? '' : `<section class="panel"><h2>By stock</h2><div class="holdings-wrap"><table class="holdings lots">
      <thead><tr><th>Stock</th><th>Broker</th><th class="num">Sold for</th><th class="num">Short term</th><th class="num">Long term</th><th class="num">Intraday</th><th class="num">Total</th></tr></thead>
      <tbody>${[...byStock.values()].sort((a, b) => b.gain - a.gain).map(row => `<tr><td><a class="pf-link" href="${accountPath(row.account.id)}/h/${encodeURIComponent(row.symbol)}">${A.esc(row.symbol)}</a></td><td>${A.esc(row.account.name)}</td><td class="num">${money(row.proceeds)}</td>${cellGain(row['Short term'])}${cellGain(row['Long term'])}${cellGain(row.Intraday)}${cellGain(row.gain)}</tr>`).join('')}</tbody>
    </table></div></section>
    <details class="panel pf-details"><summary>Every sale (${rows.length})</summary><div class="holdings-wrap"><table class="holdings lots">
      <thead><tr><th>Sold</th><th>Bought</th><th>Stock</th><th>Type</th><th class="num">Shares</th><th class="num">Buy price</th><th class="num">Sell price</th><th class="num">Gain</th></tr></thead>
      <tbody>${rows.map(s => `<tr><td>${day(s.sellDate)}</td><td>${day(s.buyDate)}</td><td>${A.esc(s.symbol)}</td><td>${s.type}</td><td class="num">${qtyText(s.qty)}</td><td class="num">${perShare(s.costBasis / s.qty)}</td><td class="num">${perShare(s.proceeds / s.qty)}</td>${cellGain(s.gain)}</tr>`).join('')}</tbody>
    </table></div></details>`}
    <p class="muted small">Sells are matched to buys oldest first. Long term means held over 12 months, or over 24 for US shares. Excludes charges, and doesn't apply every tax rule, such as debt fund treatment, so check with your broker's tax statement before filing.</p>`;
}

// Interest from Earn contracts plus older rewards, by coin. Both are in coins, so
// rupee values use today's price, not the price on the day they were credited.
function earnReport() {
  const brokers = reportBrokers().filter(b => b.account.kind === 'crypto');
  const ids = new Set(brokers.map(b => b.account.id));
  const contracts = A.S.earnContracts.filter(c => ids.has(c.accountId));
  const rewards = A.S.trades.filter(t => ids.has(t.accountId) && t.note === 'Reward');
  const dates = [...contracts.map(c => c.start), ...rewards.map(t => t.date)];
  const filters = reportFilters([...new Set(dates.map(fyStart))].sort((a, b) => b - a));
  if (!brokers.length) return `${filters}<div class="empty">${icon('file')}<p>No crypto broker in this selection.</p></div>`;
  const inPeriod = contracts.filter(c => inYear(c.start));
  const paid = rewards.filter(t => inYear(t.date));
  const priceOf = (accountId, coin) => brokers.find(b => b.account.id === accountId)?.c.lines.find(l => l.symbol === coin)?.price ?? 0;
  const coins = new Map();
  const rowFor = (accountId, coin) => {
    const key = `${accountId}:${coin}`;
    if (!coins.has(key)) coins.set(key, { coin, price: priceOf(accountId, coin), locked: 0, earned: 0, rewards: 0, contracts: 0 });
    return coins.get(key);
  };
  for (const c of inPeriod) {
    const row = rowFor(c.accountId, c.coin);
    row.contracts++;
    row.earned += c.earned;
    if (c.status === 'Active') row.locked += c.principal;
  }
  // Rewards paid before a coin swap count under the coin held now.
  const coinNow = s => CORPORATE_ACTIONS.find(a => a.type === 'rename' && a.symbol === s)?.to ?? s;
  for (const t of paid) rowFor(t.accountId, coinNow(t.symbol)).rewards += t.qty;
  const list = [...coins.values()];
  const valueOf = key => list.reduce((n, r) => n + r[key] * r.price, 0);
  const active = inPeriod.filter(c => c.status === 'Active');
  const coinQty = v => (v ? v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : '–');
  return `${filters}
    <div class="stats">
      ${stat(`Locked in Earn now${info('earn')}`, money(valueOf('locked')), A.plural(active.length, 'active contract'))}
      ${stat(`Earn interest${info('earn')}`, money(valueOf('earned')), 'At today\'s price')}
      ${stat('Rewards', money(valueOf('rewards')), 'At today\'s price')}
      ${stat('Contracts', String(inPeriod.length), R.year === 'all' ? 'All years' : 'Started this year')}
    </div>
    ${!list.length ? `<div class="empty">${icon('file')}<p>No earnings for this selection.</p></div>` : !detailed() ? '' : `<section class="panel"><h2>By coin</h2><div class="holdings-wrap"><table class="holdings lots">
      <thead><tr><th>Coin</th><th class="num">Locked</th><th class="num">Earn interest</th><th class="num">Rewards</th><th class="num">Value earned</th></tr></thead>
      <tbody>${list.map(r => `<tr><td>${A.esc(r.coin)}</td><td class="num">${isPrivate() ? MASK : coinQty(r.locked)}</td><td class="num">${isPrivate() ? MASK : coinQty(r.earned)}</td><td class="num">${isPrivate() ? MASK : coinQty(r.rewards)}</td><td class="num">${money((r.earned + r.rewards) * r.price)}</td></tr>`).join('')}</tbody>
    </table></div></section>
    <section class="panel"><h2>Contracts (${inPeriod.length})</h2><div class="holdings-wrap"><table class="holdings lots">
      <thead><tr><th>Coin</th><th>Started</th><th>Matures</th><th>Rate</th><th>Status</th><th class="num">Principal</th><th class="num">Earned</th></tr></thead>
      <tbody>${[...inPeriod].sort((a, b) => b.start.localeCompare(a.start)).map(c => `<tr><td>${A.esc(c.coin)}</td><td>${day(c.start)}</td><td>${day(c.maturity)}</td><td>${A.esc(c.rate)}</td><td>${A.esc(c.status)}</td><td class="num">${isPrivate() ? MASK : coinQty(c.principal)}</td><td class="num">${isPrivate() ? MASK : coinQty(c.earned)}</td></tr>`).join('')}</tbody>
    </table></div></section>`}
    <p class="muted small">Coins locked in Earn stay in your holdings. Interest on active contracts is what has accrued so far. Rupee values use today's price, not the price when credited, so this isn't a tax figure.</p>`;
}

/* ---------- fees ---------- */

const coinText = v => (isPrivate() ? MASK : v ? v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : '–');
const TRADING_FEES = ['Trading fee', 'Commission', 'Brokerage', 'Brokerage and charges', 'Exchange charges', 'Other charges'];
const TAXES = ['GST', 'TDS', 'STT', 'Stamp duty'];

// What coins taken as a fee had cost you, from the lots that left with them.
function feeCost(f) {
  if (!f.coin) return f.amount;
  const sent = outEvent(f.accountId, f.coin, f.tradeId);
  if (!sent) return 0;
  const link = transferOf(f.tradeId);
  const { restCost, restQty } = splitTaken(sent.taken, link ? link.received : -sent.qty - coinsFeeOn(f.tradeId));
  return restQty ? restCost * f.qty / restQty : 0;
}

// Network fees come from the transfers, and sit inside the withdrawal fee, so
// they're shown but not added to the totals.
function feeRows(brokers) {
  return brokers.flatMap(({ account, rate }) => {
    const charged = A.S.brokerFees.filter(f => f.accountId === account.id).map(f => ({ ...f, account, cost: feeCost(f) * rate }));
    const network = A.S.transfers.filter(x => x.fromAccountId === account.id && x.networkFee > 0).map(x => {
      const sent = outEvent(account.id, x.coin, x.tradeId);
      const unit = sent?.taken.length ? splitTaken(sent.taken, -sent.qty).keptCost / -sent.qty : 0;
      return { date: x.date, kind: 'Network fee', coin: x.coin, qty: x.networkFee, amount: 0, account, cost: x.networkFee * unit * rate, inside: true };
    });
    return [...charged, ...network];
  });
}

function feeTable(rows) {
  const kinds = new Map();
  for (const f of rows) {
    const row = kinds.get(f.kind) ?? { n: 0, cost: 0, coins: new Map(), inside: f.inside };
    row.n++;
    row.cost += f.cost;
    if (f.coin) row.coins.set(f.coin, (row.coins.get(f.coin) ?? 0) + f.qty);
    kinds.set(f.kind, row);
  }
  return `<div class="holdings-wrap"><table class="holdings lots">
    <thead><tr><th>Type</th><th class="num">Entries</th><th>Coins deducted</th><th class="num">Amount</th></tr></thead>
    <tbody>${[...kinds].sort((a, b) => b[1].cost - a[1].cost).map(([kind, k]) => `<tr><td>${A.esc(kind)}${k.inside ? ' (inside withdrawal fees)' : ''}</td><td class="num">${k.n}</td><td>${[...k.coins].map(([c, q]) => `${coinText(q)} ${A.esc(c)}`).join(', ') || '–'}</td><td class="num">${money(k.cost)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function feesPanel(account, c) {
  const rows = feeRows([{ account, c, rate: 1 }]);
  if (!rows.length) return '';
  const total = rows.filter(f => !f.inside).reduce((n, f) => n + f.cost, 0);
  return `<section class="panel"><div class="panel-head"><h2>Fees and charges: ${money(total)}</h2><button class="btn sm" data-act="pf-fees" data-id="${account.id}">${icon('file')}<span>Report</span></button></div>${feeTable(rows)}</section>`;
}

function feesReport() {
  const brokers = reportBrokers();
  const all = feeRows(brokers);
  const filters = reportFilters([...new Set(all.map(f => fyStart(f.date)))].sort((a, b) => b - a));
  const rows = all.filter(f => inYear(f.date));
  const charged = rows.filter(f => !f.inside);
  const sum = test => charged.filter(test).reduce((n, f) => n + f.cost, 0);
  const missing = brokers.filter(b => !all.some(f => f.account.id === b.account.id) && !/Wallet/.test(b.account.broker)).map(b => b.account.name);
  const network = rows.filter(f => f.inside);
  const taken = charged.filter(f => f.coin);
  return `${filters}
    <div class="stats">
      ${stat(`Total fees${info('fees')}`, money(sum(() => true)), `${charged.length} ${charged.length === 1 ? 'entry' : 'entries'}`)}
      ${stat('Trading fees', money(sum(f => TRADING_FEES.includes(f.kind))), 'Brokerage and exchange fees')}
      ${stat('Taxes', money(sum(f => !f.coin && TAXES.includes(f.kind))), 'GST, STT, stamp duty and TDS')}
      ${stat('Bank charges', money(sum(f => f.kind === 'Bank charge')), 'Deposits and withdrawals')}
      ${stat('Coins deducted', money(sum(f => !!f.coin)), `${A.plural(taken.length, 'deduction')}, at what they cost you`)}
      ${stat('Network fees', money(network.reduce((n, f) => n + f.cost, 0)), 'Inside withdrawal fees, not added again')}
    </div>
    ${!rows.length ? `<div class="empty">${icon('file')}<p>No fees for this selection.</p></div>` : `<section class="panel"><h2>By type</h2>${feeTable(rows)}</section>${!detailed() ? '' : `<section class="panel"><h2>Entries (${rows.length})</h2><div class="holdings-wrap"><table class="holdings lots">
      <thead><tr><th>Date</th><th>Broker</th><th>Type</th><th>Coins</th><th class="num">Amount</th></tr></thead>
      <tbody>${[...rows].sort((a, b) => b.date.localeCompare(a.date)).map(f => `<tr><td>${day(f.date)}</td><td>${A.esc(f.account.name)}</td><td>${A.esc(f.kind)}</td><td>${f.coin ? `${coinText(f.qty)} ${A.esc(f.coin)}` : '–'}</td><td class="num">${money(f.cost)}</td></tr>`).join('')}</tbody>
    </table></div></section>`}`}
    <p class="muted small">Zebpay, Vested and Aionion Capital fees are already in your cost per share, while HDFC Securities costs use the market price, without them. Coins deducted are valued at what they cost you.${missing.length ? ` ${A.esc(missing.join(' and '))} files don't show charges, so they aren't included.` : ''}</p>`;
}

/* ---------- transfers page ---------- */

function transfersView() {
  const rows = sends().sort((a, b) => b.date.localeCompare(a.date)).map(t => {
    const link = transferOf(t.id);
    const fee = coinsFeeOn(t.id);
    const arrived = link ? link.received : t.qty - fee;
    const sent = outEvent(t.accountId, t.symbol, t.id);
    return { t, link, fee, arrived, gap: t.qty - fee - arrived, cost: splitTaken(sent?.taken ?? [], arrived).keptCost, from: accountById(t.accountId), to: link && accountById(link.toAccountId) };
  });
  const open = rows.filter(r => !r.link);
  const inbound = A.S.trades.filter(t => t.side === 'buy' && t.note === 'Received').sort((a, b) => b.date.localeCompare(a.date));
  const moved = A.S.portfolioActions.filter(a => a.type === 'allot' && a.issue === 'transfer').sort((a, b) => b.date.localeCompare(a.date));
  const place = r => (r.to ? `<a href="${accountPath(r.to.id)}">${A.esc(r.to.name)}</a>` : r.link ? 'Left your portfolio' : '<span class="down">Not linked</span>');
  A.view.innerHTML = `${hero('Transfers', 'Coins and shares moved between accounts', HOME)}
    <div class="scroll"><div class="pay-page pf-page">
      <div class="stats">
        ${stat('Transfers out', String(rows.length), `${rows.filter(r => r.to).length} now in another account`)}
        ${stat('Not linked', String(open.length), open.length ? 'These coins are missing from holdings' : 'All accounted for', open.length ? 'down' : '')}
        ${stat('Cost moved', money(rows.filter(r => r.to).reduce((n, r) => n + r.cost, 0)), 'At the original buy cost')}
      </div>
      ${open.length ? `<div class="banner">${icon('alert')}<span>Link each send to the account that received it, and the coins appear there with their original dates and cost.</span></div>` : ''}
      <section class="panel"><h2>Sent out (${rows.length})</h2>${rows.length ? `<div class="holdings-wrap"><table class="holdings lots">
        <thead><tr><th>Date</th><th>Coin</th><th>From</th><th>Now in</th><th class="num">Sent</th><th class="num">Fee taken</th><th class="num">Network fee</th><th class="num">Received</th><th class="num">Cost moved</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${day(r.t.date)}</td><td>${A.esc(r.t.symbol)}</td><td>${A.esc(r.from.name)}</td><td>${place(r)}</td><td class="num">${coinText(r.t.qty)}</td><td class="num">${coinText(r.fee)}</td><td class="num">${coinText(r.link?.networkFee ?? 0)}</td><td class="num">${coinText(r.arrived)}</td><td class="num">${money(r.cost)}</td>
          <td><button class="btn sm" data-act="pf-link" data-id="${A.esc(r.t.id)}">${r.link ? 'Edit' : 'Link'}</button>${r.link ? ` <button class="btn sm" data-act="pf-unlink" data-id="${A.esc(r.link.id)}">Unlink</button>` : ''}</td></tr>
          ${r.link?.note || Math.abs(r.gap) > 1e-9 ? `<tr class="lot-note"><td colspan="10">${[r.link?.note, Math.abs(r.gap) > 1e-9 ? `Sent less fee differs from received by ${coinText(Math.abs(r.gap))} ${r.t.symbol}` : ''].filter(Boolean).map(A.esc).join(' · ')}</td></tr>` : ''}`).join('')}</tbody>
      </table></div>` : '<p class="muted">No coins sent out.</p>'}</section>
      ${inbound.length ? `<section class="panel"><h2>Received from outside (${inbound.length})</h2><div class="holdings-wrap"><table class="holdings lots">
        <thead><tr><th>Date</th><th>Coin</th><th>Into</th><th class="num">Received</th></tr></thead>
        <tbody>${inbound.map(t => `<tr><td>${day(t.date)}</td><td>${A.esc(t.symbol)}</td><td>${A.esc(accountById(t.accountId)?.name ?? '')}</td><td class="num">${coinText(t.qty)}</td></tr>`).join('')}</tbody>
      </table></div></section>` : ''}
      ${moved.length ? `<section class="panel"><h2>Broker transfers (${moved.length})</h2><div class="holdings-wrap"><table class="holdings lots">
        <thead><tr><th>Date</th><th>Holding</th><th>Account</th><th>Direction</th><th>Other broker</th><th class="num">Shares</th><th class="num">Cost per share</th></tr></thead>
        <tbody>${moved.map(a => `<tr><td>${day(a.date)}</td><td>${A.esc(a.symbol)}</td><td>${A.esc(accountById(a.accountId)?.name ?? '')}</td><td>${a.direction === 'out' ? 'Out' : 'In'}</td><td>${A.esc(a.party || '–')}</td><td class="num">${qtyText(a.qty)}</td><td class="num">${money(a.price)}</td></tr>`).join('')}</tbody>
      </table></div></section>` : ''}
    </div></div>`;
}

async function linkTransfer(tradeId) {
  const t = A.S.trades.find(x => x.id === tradeId);
  const from = accountById(t.accountId);
  const cur = transferOf(tradeId);
  const choices = accounts().filter(a => a.id !== from.id && a.kind === from.kind);
  const received = cur?.received ?? +(t.qty - coinsFeeOn(tradeId)).toFixed(8);
  const v = await formDialog(`${t.symbol} sent on ${day(t.date)}`, `
    <label class="f"><span>Received in</span><select name="to">${choices.map(a => `<option value="${a.id}"${a.id === cur?.toAccountId ? ' selected' : ''}>${A.esc(a.name)}</option>`).join('')}<option value=""${cur && !cur.toAccountId ? ' selected' : ''}>Left my portfolio</option></select></label>
    ${number('received', 'Coins received', received)}
    <label class="f"><span>Network fee, in coins</span><input name="networkFee" type="number" min="0" step="any" value="${cur?.networkFee || ''}"></label>
    <label class="f"><span>Comment</span><input name="note" maxlength="200" value="${A.esc(cur?.note ?? '')}"></label>`, 'Save');
  if (!v) return;
  const rec = { id: `tr:${t.id}`, tradeId: t.id, coin: t.symbol, date: t.date, fromAccountId: from.id, toAccountId: v.to, received: Number(v.received), networkFee: Number(v.networkFee) || 0, note: v.note.trim(), updatedAt: Date.now() };
  A.S.transfers = [...A.S.transfers.filter(x => x.id !== rec.id), rec];
  await A.persist('transfers', rec);
  invalidate();
  A.refresh();
  refreshMarket();
}

function reportsView(r) {
  const tab = REPORTS[r.tab] ? r.tab : 'dividends';
  const body = tab === 'gains' ? gainsReport() : tab === 'earn' ? earnReport() : tab === 'fees' ? feesReport() : dividendReport();
  A.view.innerHTML = `
    ${hero('Reports', REPORTS[tab], HOME)}
    <div class="seg tabs" role="group" aria-label="Report">
      ${Object.entries(REPORTS).map(([k, label]) => `<a href="${HOME}/reports/${k}"${k === tab ? ' aria-current="page"' : ''}><span>${label}</span></a>`).join('')}
    </div>
    <div class="scroll"><div class="pay-page pf-page">${body}</div></div>`;
  // A long chart opens on the latest months.
  const bars = A.$('.months.long');
  if (bars) bars.scrollLeft = bars.scrollWidth;
  A.$('#r-broker').addEventListener('change', e => { R.broker = e.target.value; reportsView(r); });
  A.$('#r-year').addEventListener('change', e => { R.year = e.target.value; reportsView(r); });
  A.$('#r-detail').addEventListener('change', e => { A.ls.set('pfReportDetail', e.target.checked); reportsView(r); });
  A.$('#r-payers')?.addEventListener('change', e => { A.ls.set('pfPayersOnly', e.target.checked); reportsView(r); });
}

/* ---------- one stock ---------- */

function eventLine(e, symbol) {
  const unit = e.price != null ? ` at ${money(e.price)}` : '';
  const via = e.to ? ` into ${e.to}` : e.from ? ` from ${e.from}` : '';
  const ratio = e.ratio ? ` ${e.ratio}` : '';
  const qty = e.kind === 'dividend' ? `${qtyText(e.qty)} shares${unit}`
    : e.kind === 'buy' || e.kind === 'sell' ? `${qtyText(e.qty)}${unit}${e.exchange ? ` · ${e.exchange}` : ''}`
    : `${e.qty > 0 ? '+' : ''}${qtyText(e.qty)}${(e.kind === 'adjust' || e.kind === 'allot') && e.price ? unit : ''}`;
  const flags = [
    e.intraday > EPS ? `${qtyText(e.intraday)} intraday` : '',
    e.origin && baseSymbol(e.origin) !== symbol ? `Traded as ${e.origin}` : '',
    e.unmatched ? `${qtyText(e.unmatched)} bought before the tradebooks` : '',
    e.note ?? '',
  ].filter(Boolean).join(' · ');
  const amount = e.kind === 'dividend' ? money(e.amount)
    : e.kind === 'buy' || e.kind === 'sell' || e.kind === 'allot' ? money(Math.abs(e.qty) * e.price) : '';
  return { title: `${e.source ?? EVENT_LABEL[e.kind]}${ratio}${via}`, qty, flags, amount };
}

// The system's own account of what changed a holding, oldest first.
function systemNotes(p) {
  return p.events
    .filter(e => ACTION_KINDS.has(e.kind))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => {
      const t = eventLine(e, p.symbol);
      return `${day(e.date)}: ${t.title}${e.qty ? `, ${t.qty}` : ''}${t.flags ? `. ${t.flags}` : ''}`;
    });
}

const noteId = (accountId, symbol) => `${accountId}:${symbol}`;
const noteFor = (accountId, symbol) => A.S.portfolioNotes.find(n => n.id === noteId(accountId, symbol));
const signedQty = v => (Math.abs(v) < EPS ? '–' : `${v > 0 ? '+' : ''}${qtyText(v)}`);

function entryText(f) {
  const way = f.issue === 'transfer' || f.issue === 'other' ? (f.direction === 'out' ? ' out' : ' in') : '';
  const party = f.party ? ` ${f.direction === 'out' ? 'to' : 'from'} ${f.party}` : '';
  return `${ISSUE_LABEL[f.issue]}${way}${party}: ${qtyText(f.qty)} at ${money(f.price)} on ${day(f.date)}${f.note ? `. ${f.note}` : ''}`;
}

// What a reviewed holding shows under its row in the holdings table: your own
// entries if it has any, else the system's account, then your comment.
function reviewDetails(account, symbol) {
  const note = noteFor(account.id, symbol);
  if (!note?.reviewed) return '';
  const own = A.S.portfolioActions.filter(a => a.accountId === account.id && a.type === 'allot' && a.symbol === symbol);
  const p = computed(account).positions.get(symbol);
  const parts = own.length ? own.map(entryText) : p ? systemNotes(p) : [];
  return [...parts, note.comment].filter(Boolean).join(' · ') || 'Reviewed';
}

function reviewBlock(account, symbol, p) {
  const note = noteFor(account.id, symbol);
  const system = p ? systemNotes(p) : [];
  return `<ul class="pf-notes">${system.map(s => `<li>${A.esc(s)}</li>`).join('')}</ul>
    ${note?.comment ? `<p class="pf-comment">${icon('edit')}<span>${A.esc(note.comment)}</span></p>` : ''}
    <div class="pf-review">
      ${note?.reviewed ? `<span class="chip paid">${icon('check')}Reviewed</span>` : '<span class="chip">Not reviewed</span>'}
      <button class="btn sm" data-act="pf-note" data-id="${account.id}" data-symbol="${A.esc(symbol)}">${icon('edit')}<span>Review</span></button>
      ${p?.events.some(e => e.kind === 'allot' && e.qty > 0 && /^(Rights|IPO)/.test(e.source)) ? `<button class="btn sm" data-act="pf-allot" data-kind="rights" data-id="${account.id}" data-symbol="${A.esc(symbol)}">Override allotment</button>` : ''}
    </div>`;
}

function stockView(r) {
  const account = accountById(r.id);
  const c = computed(account);
  const p = c.positions.get(r.symbol);
  const line = c.lines.find(l => l.symbol === r.symbol) ?? summarizePosition(p, null);
  const price = line.price;
  const history = [...p.events].sort((a, b) => b.date.localeCompare(a.date));
  A.view.innerHTML = `
    <header class="topbar">${A.upButton(accountPath(account.id))}<div class="titles"><h1>${A.esc(r.symbol)}</h1><p>${A.esc(line.name || account.name)}</p></div>${privacyButton()}${A.menuButton}</header>
    <div class="scroll"><div class="pay-page">
      <div class="stats">
        ${stat('Shares', qtyText(line.qty), `Cost per share ${money(line.avg)}`)}
        ${stat('Market value', money(line.value), `Last price ${money(price)}`)}
        ${stat('Total gain', money(line.gain, true), pct(line.gainPct), tone(line.gain))}
        ${stat(`XIRR${info('xirr')}`, pct(line.xirr), 'Annual return', tone(line.xirr))}
        ${stat('Day gain', money(line.dayGain, true), pct(line.dayPct), tone(line.dayGain))}
        ${stat('Realized gain', money(line.realized, true), pct(line.realizedPct), tone(line.realized))}
        ${stat('Dividend income', money(line.dividends), A.plural(p.dividendEvents.length, 'payment'))}
      </div>
      ${p.lots.length ? `<section class="panel"><h2>Open lots</h2><div class="holdings-wrap"><table class="holdings lots">
        <thead><tr><th>Bought</th><th class="num">Original shares</th><th class="num">Change</th><th class="num">Current shares</th><th class="num">Cost per share</th><th class="num">Total cost</th><th class="num">Gain</th><th class="num">Gain %</th></tr></thead>
        <tbody>${[...p.lots].sort((a, b) => b.date.localeCompare(a.date)).map(l => {
          const gain = price == null ? null : l.qty * (price - l.price);
          const original = originalShares(l);
          const why = [...(l.source ? [l.source] : []), ...(l.steps ?? [])].join(' · ');
          return `<tr><td>${day(l.date)}</td><td class="num">${qtyText(original)}</td><td class="num">${signedQty(l.qty - original)}</td><td class="num">${qtyText(l.qty)}</td><td class="num">${money(l.price)}</td><td class="num">${money(l.qty * l.price)}</td>
            <td class="num ${tone(gain)}">${money(gain, true)}</td><td class="num ${tone(gain)}">${pct(gain == null || !l.price ? null : (price - l.price) / l.price * 100)}</td></tr>
            ${why ? `<tr class="lot-note"><td colspan="8">${A.esc(why)}</td></tr>` : ''}`;
        }).join('')}</tbody>
      </table></div></section>` : ''}
      ${line.marketCap != null ? `<section class="panel"><h2>Fundamentals${info('fundamentals')}</h2><dl class="facts">${OPTIONAL_COLUMNS.filter(c => line[c.key] != null).map(c => `<div><dt>${c.label}</dt><dd>${c.text ? A.esc(line[c.key]) : c.f(line[c.key], line)}</dd></div>`).join('')}</dl></section>` : ''}
      <section class="panel"><h2>Reconciliation notes</h2>${reviewBlock(account, r.symbol, p)}</section>
      <section class="panel">
        <h2>Transactions and actions</h2>
        <div class="events">${history.map(e => {
          const t = eventLine(e, r.symbol);
          const gain = e.kind === 'sell' ? `<span class="${tone(e.gain)}">${money(e.gain, true)}</span>` : '';
          const del = e.manual ? `<button class="icon-btn sm" data-act="pf-del-trade" data-id="${A.esc(e.tradeId)}" aria-label="Delete transaction">${icon('trash')}</button>` : '';
          return `<div class="event ${e.kind}">
            <div class="event-date">${day(e.date)}</div>
            <div class="event-main"><span class="card-title">${A.esc(t.title)}</span><span class="card-meta">${A.esc(t.qty)}${t.flags ? ` · ${A.esc(t.flags)}` : ''}</span></div>
            <div class="pay-side"><span class="pay-amount">${t.amount}</span>${gain}</div>${del}
          </div>`;
        }).join('')}</div>
      </section>
    </div></div>`;
}

/* ---------- reconcile ---------- */

const WHY = {
  qty: 'Quantity differs, and no published rights issue or IPO explains it.',
  cost: 'Quantity matches but the cost differs.',
  missing: 'In the holdings file but not in any tradebook or published allotment. Likely bought in a year with no tradebook, or transferred in.',
  extra: 'The tradebooks show units the broker no longer lists. A sale or redemption may be missing, or an allotment may still be pending.',
};

// Indian financial years with no trades at all, between the first trade and the
// holdings date. A year can be genuinely quiet, so these are only pointers.
function quietYears(trades, asOf) {
  const fy = date => Number(date.slice(0, 4)) - (date.slice(5, 7) < '04' ? 1 : 0);
  const years = new Set(trades.map(t => fy(t.date)));
  if (!years.size) return [];
  const out = [];
  for (let y = Math.min(...years); y <= fy(asOf); y++) {
    if (!years.has(y)) out.push(`FY${y}-${String(y + 1).slice(2)}`);
  }
  return out;
}

// What a share with no recorded cost is valued at: what you paid on average
// for the rest of the holding, else today's price so it shows no gain.
const fallbackCost = x => (x.avg > 0 ? x.avg : x.close);

function reconcileView(r) {
  const account = accountById(r.id);
  const c = computed(account);
  const file = holdingsOf(account.id);
  if (!c.recon) {
    A.view.innerHTML = `${hero('Reconcile', account.name, accountPath(account.id))}<div class="scroll"><div class="empty">${icon('file')}<p>Load the broker's holdings file to compare it with the tradebooks.</p></div></div>`;
    return;
  }
  const bad = c.recon.filter(x => x.status !== 'ok');
  const good = c.recon.length - bad.length;
  const fixes = A.S.portfolioActions.filter(a => a.accountId === account.id);
  const quiet = quietYears(A.S.trades.filter(t => t.accountId === account.id && t.kind !== 'mf'), file.asOf);
  // A quiet year only matters if a fund doesn't add up.
  const fundGap = bad.some(x => file.rows.some(h => h.kind === 'mf' && baseSymbol(h.symbol) === x.symbol) || c.lines.some(l => l.symbol === x.symbol && l.mutualFund));
  const quietFunds = fundGap ? quietYears(A.S.trades.filter(t => t.accountId === account.id && t.kind === 'mf'), file.asOf) : [];
  const acted = [...c.positions.values()].filter(p => systemNotes(p).length).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const done = acted.filter(p => noteFor(account.id, p.symbol)?.reviewed).length;
  const orphans = [...c.positions.values()].filter(p => p.unmatched > EPS);
  const noCost = file.rows.every(h => !h.avg);
  A.view.innerHTML = `${hero('Reconcile', `${good} of ${c.recon.length} match · holdings as on ${day(file.asOf)}`, accountPath(account.id))}
    <div class="scroll"><div class="pay-page">
      <div class="status" id="pf-status">${statusLine()}</div>
      ${job.running ? '<p class="muted">Wait for splits and dividends to finish loading: until then many stocks look wrong.</p>' : ''}
      ${noCost ? `<p class="muted">This broker's holdings file has no cost, so only quantities are compared.</p>` : ''}
      ${quiet.length ? `<div class="banner">${icon('alert')}<span>No trades found for ${quiet.join(', ')}. If you traded then, load those tradebooks before matching.</span></div>` : ''}
      ${quietFunds.length ? `<div class="banner">${icon('alert')}<span>No mutual fund orders found for ${quietFunds.join(', ')}. If you invested then, load those reports before matching.</span></div>` : ''}
      ${orphans.length ? `<section class="panel"><h2>Sells with no matching buy (${orphans.length})</h2>
        <p class="muted">The buys are not in any tradebook, so these sells are left out of realized gains.</p>
        <div class="rows">${orphans.map(p => `<a class="sub pf-account" href="${accountPath(account.id)}/h/${encodeURIComponent(p.symbol)}"><span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(p.symbol)}</span><span class="card-meta">${qtyText(p.unmatched)} sold without a buy</span></span></span></a>`).join('')}</div>
      </section>` : ''}
      ${bad.length ? `<section class="panel">
        <div class="panel-head"><h2>Differences (${bad.length})</h2><button class="btn sm primary" data-act="pf-match-all" data-id="${account.id}"${job.running ? ' disabled' : ''}>Match broker for all</button></div>
        <div class="rows">${bad.map(x => `<div class="sub pay-row"><div class="sub-main"><span class="sub-text">
            <a class="card-title" href="${accountPath(account.id)}/h/${encodeURIComponent(x.symbol)}">${A.esc(x.symbol)}</a>
            <span class="card-meta">Tradebooks ${qtyText(x.qty)} at ${money(x.avg)} · Broker ${qtyText(x.fileQty)}${x.fileAvg ? ` at ${money(x.fileAvg)}` : ''}</span>
            <span class="card-meta">${WHY[x.status]}</span>
            ${noteFor(account.id, x.symbol)?.comment ? `<span class="card-meta">Your note: ${A.esc(noteFor(account.id, x.symbol).comment)}</span>` : ''}
          </span></div>
          <div class="pf-actions">
            <button class="btn sm" data-act="pf-match" data-id="${account.id}" data-symbol="${A.esc(x.symbol)}"${job.running ? ' disabled' : ''}>Match broker</button>
            ${[['rights', 'Rights / IPO'], ['transfer', 'Broker Transfer'], ['other', 'Other']].map(([kind, label]) => `<button class="btn sm" data-act="pf-allot" data-kind="${kind}" data-id="${account.id}" data-symbol="${A.esc(x.symbol)}">${label}</button>`).join('')}
          </div>
        </div>`).join('')}</div>
      </section>` : `<section class="panel"><h2>All holdings match</h2><p class="muted">Quantity and cost per share agree with the broker's file.</p></section>`}
      ${acted.length ? `<details class="panel pf-details"><summary>System notes on stock actions (${done} of ${acted.length} reviewed)</summary>
        <div class="rows">${acted.map(p => `<div class="pf-acted"><a class="card-title" href="${accountPath(account.id)}/h/${encodeURIComponent(p.symbol)}">${A.esc(p.symbol)}</a>${reviewBlock(account, p.symbol, p)}</div>`).join('')}</div>
      </details>` : ''}
      ${fixes.length ? `<section class="panel"><h2>Your overrides (${fixes.length})</h2>
        <div class="rows">${fixes.map(f => `<div class="sub pay-row"><div class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(f.symbol)}</span><span class="card-meta">${f.type === 'allot'
          ? A.esc(entryText(f))
          : `Set to ${qtyText(f.qty)}${f.avg != null ? ` at ${money(f.avg)}` : f.price ? `, added shares at ${money(f.price)}` : ''} on ${day(f.date)}`}</span></span></div>
          <button class="btn sm" data-act="pf-unmatch" data-id="${f.id}">Remove</button></div>`).join('')}</div></section>` : ''}
    </div></div>`;
}

// A form in the shared dialog. Resolves to the form's values, or null.
function formDialog(title, fields, okLabel) {
  const d = A.$('#modal');
  d.className = 'modal';
  d.innerHTML = `<form method="dialog"><h2>${A.esc(title)}</h2>${fields}
    <div class="actions">
      <button value="ok" class="btn ok primary">${A.esc(okLabel)}</button>
      <button value="" class="btn ghost" formnovalidate>Cancel</button>
    </div></form>`;
  return new Promise(resolve => {
    const form = d.querySelector('form');
    // Saved on submit: a closed dialog's close event can arrive late, or be lost
    // when the next dialog takes over.
    form.addEventListener('submit', e => { if (e.submitter?.value) resolve(Object.fromEntries(new FormData(form))); });
    d.onclose = () => resolve(null);
    d.onclick = e => { if (e.target === d) d.close(''); };
    d.returnValue = '';
    d.showModal();
  });
}

async function reviewNote(account, symbol) {
  const p = computed(account).positions.get(symbol);
  const cur = noteFor(account.id, symbol);
  const system = p ? systemNotes(p) : [];
  const v = await formDialog(`Review ${symbol}`, `
    ${system.length ? `<ul class="pf-notes">${system.map(s => `<li>${A.esc(s)}</li>`).join('')}</ul>` : '<p>The system has no notes on this holding.</p>'}
    <label class="f"><span>Your comment</span><textarea name="comment" rows="3" maxlength="2000">${A.esc(cur?.comment)}</textarea></label>
    <label class="switch"><input type="checkbox" name="reviewed"${cur?.reviewed ? ' checked' : ''}><span>I have reviewed this</span></label>`, 'Save');
  if (!v) return;
  const note = { id: noteId(account.id, symbol), accountId: account.id, symbol, reviewed: v.reviewed === 'on', comment: v.comment.trim(), updatedAt: Date.now() };
  A.S.portfolioNotes = [...A.S.portfolioNotes.filter(n => n.id !== note.id), note];
  await A.persist('portfolioNotes', note);
  A.refresh();
}

const number = (name, label, value) => `<label class="f"><span>${label}</span><input name="${name}" type="number" min="0" step="any" required value="${value ?? ''}"></label>`;

// The form for one reconciling entry. `kind` is rights, transfer or other. A
// rights or IPO entry replaces the published terms, or records an issue they
// lack; transfers and others add up, as a holding can have several.
async function reconcileEntry(account, symbol, kind) {
  const c = computed(account);
  const line = c.recon?.find(x => x.symbol === symbol);
  const cur = kind === 'rights' ? c.positions.get(symbol)?.events.find(e => e.kind === 'allot' && /^(Rights|IPO)/.test(e.source)) : null;
  const gap = line ? +Math.abs(line.fileQty - line.qty).toFixed(3) : 0;
  const out = !!line && line.fileQty < line.qty;
  const date = cur?.date ?? holdingsOf(account.id)?.asOf ?? '';
  const way = (inLabel, outLabel) => `<label class="f"><span>Direction</span><select name="direction"><option value="in"${out ? '' : ' selected'}>${inLabel}</option><option value="out"${out ? ' selected' : ''}>${outLabel}</option></select></label>`;
  const dateField = label => `<label class="f"><span>${label}</span><input name="date" type="date" required value="${date}"></label>`;
  const comment = label => `<label class="f"><span>${label}</span><input name="note" maxlength="200"></label>`;
  const forms = {
    rights: [`Rights issue or IPO: ${symbol}`, `
      <label class="f"><span>Type</span><select name="issue"><option value="rights">Rights issue</option><option value="ipo"${cur?.source === ISSUE_LABEL.ipo ? ' selected' : ''}>IPO allotment</option></select></label>
      ${number('qty', 'Shares allotted, in the units of that date', cur?.qty ?? (gap || ''))}
      ${number('price', 'Price per share', cur?.price)}
      ${dateField('Allotment date')}${comment('Comment')}`],
    transfer: [`Broker transfer: ${symbol}`, `
      ${way('Transferred in', 'Transferred out')}
      <label class="f"><span>Other broker</span><input name="party" maxlength="80" placeholder="e.g. ICICI Direct"></label>
      ${number('qty', 'Shares, in the units of that date', gap || '')}
      ${number('price', 'Cost per share', '')}
      ${dateField('Date bought, to keep the holding period, or date moved')}${comment('Comment')}
      <p>A transfer out takes the shares and their cost away, with no gain or loss.</p>`],
    other: [`Other: ${symbol}`, `
      ${way('Shares added', 'Shares removed')}
      ${number('qty', 'Shares, in the units of that date', gap || '')}
      ${number('price', 'Price per share', '')}
      ${dateField('Date')}${comment('What happened')}
      <p>Removing shares at a price above zero counts as a sale, with a realized gain or loss.</p>`],
  };
  const v = await formDialog(...forms[kind], 'Save');
  if (!v) return;
  const t = Date.now();
  const action = {
    id: A.uid(), accountId: account.id, type: 'allot', issue: v.issue ?? kind, direction: v.direction ?? 'in', party: v.party?.trim() ?? '',
    symbol, date: v.date, qty: Number(v.qty), price: Number(v.price), avg: null, note: v.note.trim(), createdAt: t, updatedAt: t,
  };
  if (kind === 'rights') {
    const old = A.S.portfolioActions.filter(a => a.accountId === account.id && a.type === 'allot' && a.symbol === symbol && (a.issue === 'rights' || a.issue === 'ipo'));
    for (const a of old) await db.del('portfolioActions', a.id);
    A.S.portfolioActions = A.S.portfolioActions.filter(a => !old.includes(a));
  }
  A.S.portfolioActions.push(action);
  await A.persist('portfolioActions', action);
  // Entering the details is the review, so they show in holdings straight away.
  const cur2 = noteFor(account.id, symbol);
  const note = { id: noteId(account.id, symbol), accountId: account.id, symbol, comment: cur2?.comment ?? '', reviewed: true, updatedAt: t };
  A.S.portfolioNotes = [...A.S.portfolioNotes.filter(n => n.id !== note.id), note];
  await A.persist('portfolioNotes', note);
  invalidate();
  A.refresh();
}

async function matchBroker(account, items) {
  const asOf = holdingsOf(account.id).asOf;
  const t = Date.now();
  const added = items.map(x => ({
    id: A.uid(), accountId: account.id, type: 'adjust', symbol: x.symbol, date: asOf,
    qty: x.fileQty, avg: x.fileAvg || null, price: x.price ?? fallbackCost(x),
    note: x.fileAvg ? 'Matched to the broker' : 'Matched to the broker, cost estimated', createdAt: t, updatedAt: t,
  }));
  const replaced = A.S.portfolioActions.filter(a => a.accountId === account.id && a.type === 'adjust' && items.some(x => x.symbol === a.symbol));
  for (const a of replaced) await db.del('portfolioActions', a.id);
  A.S.portfolioActions = [...A.S.portfolioActions.filter(a => !replaced.includes(a)), ...added];
  await db.putMany('portfolioActions', added);
  A.markDirty();
  invalidate();
  A.toast(`Matched ${A.plural(added.length, 'holding')} to the broker`);
  A.refresh();
}

/* ---------- add a transaction ---------- */

function tradeView(r) {
  const account = accountById(r.id);
  const back = accountPath(account.id);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  A.view.innerHTML = `
    <header class="topbar">${A.upButton(back)}<div class="titles"><h1>Add transaction</h1><p>${A.esc(account.name)}</p></div>${A.menuButton}</header>
    <div class="scroll"><form class="pay-form" id="pf-trade" novalidate>
      <label class="f wide"><span>${account.kind === 'mf' ? 'Fund name' : account.kind === 'crypto' ? 'Coin symbol' : 'Symbol'}</span><input name="symbol" required maxlength="120" placeholder="${account.kind === 'mf' ? 'e.g. Parag Parikh Flexi Cap Fund - Direct Plan' : account.kind === 'crypto' ? 'e.g. BTC' : 'e.g. INFY'}" autocomplete="off"></label>
      <label class="f"><span>Type</span><select name="side"><option value="buy">Buy</option><option value="sell">Sell</option>${account.kind === 'crypto' ? '<option value="out">Sent out</option>' : ''}</select></label>
      <label class="f"><span>Date</span><input name="date" type="date" required max="${today}" value="${today}"></label>
      <label class="f"><span>Quantity</span><input name="qty" type="number" inputmode="decimal" min="0.00000001" step="any" required></label>
      <label class="f"><span>Price per unit</span><input name="price" type="number" inputmode="decimal" min="0" step="any" required></label>
      <label class="f wide"><span>Note (optional)</span><input name="note" maxlength="80" placeholder="e.g. Moved from another broker. Use the date and cost of the original buy." autocomplete="off"></label>
      <div class="f-actions wide"><button class="btn primary" type="submit">Add transaction</button><a class="btn ghost" href="${back}">Cancel</a></div>
    </form></div>`;
  const form = A.$('#pf-trade');
  form.elements.side.addEventListener('change', e => { form.elements.price.required = e.target.value !== 'out'; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form));
    const symbol = d.symbol.trim();
    if (!symbol) return A.toast('Enter a symbol.');
    const trade = {
      id: A.uid(), accountId: account.id, manual: true, isin: '', exchange: '', series: '', tradeId: '', time: '',
      symbol: account.kind === 'mf' ? symbol : symbol.toUpperCase(), date: d.date, side: d.side, qty: Number(d.qty), price: Number(d.price) || 0, note: d.side === 'out' ? `Sent out${d.note.trim() ? `: ${d.note.trim()}` : ''}` : d.note.trim(), updatedAt: Date.now(),
    };
    A.S.trades.push(trade);
    await A.persist('trades', trade);
    invalidate();
    A.toast('Transaction added');
    A.go(back, true);
    refreshMarket();
  });
}

/* ---------- actions ---------- */

async function accountMenu(id) {
  const account = accountById(id);
  const k = await A.choose(account.name, [
    { icon: 'edit', label: 'Rename account' },
    { icon: 'trash', label: 'Delete account', danger: true },
  ]);
  if (k === 0) {
    const name = (await A.ask('Rename account', account.name))?.trim();
    if (!name) return;
    Object.assign(account, { name, updatedAt: Date.now() });
    await A.persist('brokerAccounts', account);
    A.refresh();
  } else if (k === 1) {
    const trades = A.S.trades.filter(t => t.accountId === id);
    if (!await A.confirmDlg(`Delete “${account.name}”?`, `Its ${A.plural(trades.length, 'trade')} and holdings file are removed from this device. This cannot be undone.`, 'Delete')) return;
    for (const t of trades) await db.del('trades', t.id);
    for (const a of A.S.portfolioActions.filter(x => x.accountId === id)) await db.del('portfolioActions', a.id);
    for (const c of A.S.earnContracts.filter(x => x.accountId === id)) await db.del('earnContracts', c.id);
    A.S.earnContracts = A.S.earnContracts.filter(c => c.accountId !== id);
    for (const f of A.S.brokerFees.filter(x => x.accountId === id)) await db.del('brokerFees', f.id);
    A.S.brokerFees = A.S.brokerFees.filter(f => f.accountId !== id);
    for (const x of A.S.transfers.filter(y => y.fromAccountId === id || y.toAccountId === id)) await db.del('transfers', x.id);
    A.S.transfers = A.S.transfers.filter(x => x.fromAccountId !== id && x.toAccountId !== id);
    for (const n of A.S.portfolioNotes.filter(x => x.accountId === id)) await db.del('portfolioNotes', n.id);
    A.S.portfolioNotes = A.S.portfolioNotes.filter(n => n.accountId !== id);
    await db.del('brokerHoldings', id);
    await db.del('brokerAccounts', id);
    A.S.trades = A.S.trades.filter(t => t.accountId !== id);
    A.S.portfolioActions = A.S.portfolioActions.filter(a => a.accountId !== id);
    A.S.brokerHoldings = A.S.brokerHoldings.filter(h => h.id !== id);
    A.S.brokerAccounts = A.S.brokerAccounts.filter(a => a.id !== id);
    A.markDirty();
    invalidate();
    A.toast('Account deleted');
    A.go(HOME, true);
  }
}

export async function portfolioAction(b) {
  const { act, id, symbol } = b.dataset;
  switch (act) {
    case 'pf-menu': return accountMenu(id);
    case 'pf-refresh': return refreshMarket(true);
    case 'pf-backup': return saveBackup();
    case 'pf-info': return showSource(id);
    case 'pf-privacy':
      A.ls.set('pfPrivate', !isPrivate());
      return A.refresh();
    case 'pf-columns': return chooseColumns();
    case 'pf-link': return linkTransfer(id);
    case 'pf-unlink':
      A.S.transfers = A.S.transfers.filter(x => x.id !== id);
      await db.del('transfers', id);
      A.markDirty();
      invalidate();
      return A.refresh();
    case 'pf-fees':
      R.broker = id;
      return A.go(`${HOME}/reports/fees`);
    case 'pf-note': return reviewNote(accountById(id), symbol);
    case 'pf-allot': return reconcileEntry(accountById(id), symbol, b.dataset.kind);
    case 'pf-match': {
      const account = accountById(id);
      const x = computed(account).recon.find(i => i.symbol === symbol);
      if (x.fileAvg || x.fileQty <= x.qty) return matchBroker(account, [x]);
      const typed = await A.ask(`Cost per share for ${qtyText(x.fileQty - x.qty)} added ${symbol}`, String(+fallbackCost(x).toFixed(2)), 'Cost per share');
      if (typed == null) return;
      const price = Number(typed);
      if (!(price >= 0)) return A.toast('Enter a cost per share.');
      return matchBroker(account, [{ ...x, price }]);
    }
    case 'pf-match-all': {
      const account = accountById(id);
      const items = computed(account).recon.filter(x => x.status !== 'ok');
      const estimated = items.some(x => !x.fileAvg && x.fileQty > x.qty);
      const cost = estimated ? ' The broker gives no cost, so added shares use your average cost, or today\'s price if there is none. Their gains are estimates.' : '';
      if (!await A.confirmDlg('Match broker for all?', `${A.plural(items.length, 'holding')} will take the broker's quantity and cost.${cost} You can remove any of them later.`, 'Match all', false)) return;
      return matchBroker(account, items);
    }
    case 'pf-unmatch':
      A.S.portfolioActions = A.S.portfolioActions.filter(a => a.id !== id);
      await db.del('portfolioActions', id);
      A.markDirty();
      invalidate();
      return A.refresh();
    case 'pf-del-trade':
      if (!await A.confirmDlg('Delete transaction?', 'This cannot be undone.', 'Delete')) return;
      A.S.trades = A.S.trades.filter(t => t.id !== id);
      await db.del('trades', id);
      A.markDirty();
      invalidate();
      return A.go(accountPath(A.S.route.id), true);
  }
}

export function portfolioView(r) {
  shown = (r.id && accountById(r.id)?.currency) || CONFIG.currency;
  mergedPage = r.page === 'consolidated';
  if (r.page === 'add') addView();
  else if (mergedPage) consolidatedView();
  else if (r.page === 'reports') reportsView(r);
  else if (r.page === 'transfers') transfersView();
  else if (r.page === 'account') accountView(r);
  else if (r.page === 'stock') stockView(r);
  else if (r.page === 'reconcile') reconcileView(r);
  else if (r.page === 'trade') tradeView(r);
  else homeView(r);
  if (!A.S.brokerAccounts.length || !firstVisit) return;
  // Once per launch: picks up a stale market, or a load cut short by closing the app.
  firstVisit = false;
  const unnamed = accounts().some(a => computed(a).held.some(l => !l.name || (l.group === 'Stocks' && l.marketCap == null)));
  if (unnamed || Date.now() - A.ls.get('pfQuotedAt', 0) > QUOTE_MAX_AGE) refreshMarket();
  else refreshEvents();
}

// Data arrived from a backup, so earlier results no longer hold.
export const portfolioChanged = invalidate;
