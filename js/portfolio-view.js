import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import { ISSUE_LABEL, xirr, costHeldAt, baseSymbol, allActions, buildPositions, summarizePosition, summarizeAll, reconcile, originalShares, splitTaken, cleanAccount, cleanTrade, cleanHoldingsFile, cleanAdjustment, cleanContract, cleanTransfer, cleanFee, cleanNote, cleanMarket } from './portfolio.js';
import { parseBrokerFile } from './portfolio-import.js';
import { stockQuotes, usQuotes, usdInr, stockEvents, monthlyPrices, indexValuations, monthEndValuations, sectorPes, fundMonths, fundQuote, fundCodes, fundNav, cryptoQuotes, listedSecurities, setOffline, EVENT_GAP_MS } from './market.js';
import { mergeMonths, publicFiles, applyPublicFiles, publicSummary, zipFiles, unzipFiles } from './public-data.js';
import { CORPORATE_ACTIONS } from './corporate-actions.js';
import { tickerFor, companyPart } from './tickers.js';
import { SOURCES, DATA_POINTS, BACKUP_FILES, BACKUP_CONTENTS, BACKUP_LEAVES_OUT, BACKUP_NEEDS_NOTHING } from './disclosures.js';
import { GROUPINGS, bandOf, orderBands, RATING_SCALES, momentumRating, growthRating, valuationRating, profitabilityRating, verdictRating } from './ratings.js';

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
const job = { running: false, done: 0, total: 0, failed: 0, what: '' };
let firstVisit = true;

let A;
export function initPortfolio(helpers) {
  A = helpers;
  setOffline(dataMode() === 'backup');
}

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
  ...(accounts().length ? [{ id: 'brokers', name: 'Brokers', icon: 'briefcase', children: accounts().map(a => ({ id: a.id, name: a.name, icon: a.kind === 'crypto' ? 'cloud' : a.kind === 'mf' ? 'chart' : 'card', href: accountPath(a.id) })) }] : []),
  { id: 'data', name: 'Data sources', icon: 'settings', href: `${HOME}/data`, foot: true },
  { id: 'disclosure', name: 'Data disclosure', icon: 'info', href: `${HOME}/disclosure`, foot: true },
];

export function portfolioRouteValid(r) {
  if (['home', 'add', 'reports', 'transfers', 'consolidated', 'data', 'disclosure'].includes(r.page)) return true;
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
  if (stock.size) {
    const years = [];
    (await stockQuotes([...stock])).forEach(({ epsYears, ...q }, s) => {
      apply(s, q);
      if (Object.keys(epsYears).length) years.push({ symbol: epsKey(s), months: Object.fromEntries(Object.entries(epsYears).map(([k, eps]) => [k, [eps, 0]])), at: t });
    });
    const ids = new Set(years.map(m => m.symbol));
    A.S.priceMonths = [...A.S.priceMonths.filter(m => !ids.has(m.symbol)), ...years];
    await db.putMany('priceMonths', years);
  }
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
  if (t - (A.S.market.find(m => m.symbol === benchmarkKey('nifty50'))?.quotedAt ?? 0) > QUOTE_MAX_AGE) {
    const closes = await indexValuations().catch(() => null);
    for (const [id, name] of Object.entries(NSE_INDICES)) {
      const row = closes?.get(name);
      if (row?.close != null) apply(benchmarkKey(id), { price: row.close, name, f: { pe: row.pe, pb: row.pb, divYield: row.divYield, asOf: row.date } });
    }
  }
  if (t - (A.S.market.find(m => m.symbol === SECTOR_PE_KEY)?.quotedAt ?? 0) > QUOTE_MAX_AGE) {
    const sectors = await sectorPes().catch(() => null);
    if (sectors) apply(SECTOR_PE_KEY, { price: 0, name: 'Median P/E by sector', f: sectors });
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
const dataMode = () => A.ls.get('pfDataSource', 'internet');
const recentMonths = () => A.ls.get('pfDataRecent', 12);

// Hybrid mode's first internet month. Earlier months come from the backup.
function recentCutoff() {
  if (dataMode() !== 'hybrid') return null;
  const now = new Date();
  const month = now.getFullYear() * 12 + now.getMonth() - recentMonths();
  return `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`;
}

async function refreshEvents() {
  if (job.running || dataMode() === 'backup') return;
  const list = eventSymbols();
  if (!list.length) return refreshMonthly();
  Object.assign(job, { running: true, done: 0, total: list.length, failed: 0, what: 'splits and dividends' });
  showStatus();
  for (const [symbol, from] of list) {
    const started = Date.now();
    try {
      // History starts well before the first trade, so nothing near it is missed.
      const us = symbol.startsWith(US_PREFIX);
      const rec = A.S.market.find(m => m.symbol === symbol);
      const cut = recentCutoff();
      const since = cut && rec?.eventsAt ? `${cut}-01` : null;
      const events = await stockEvents(us ? symbol.slice(US_PREFIX.length) : symbol, since ?? `${Number(from.slice(0, 4)) - 1}-01-01`, us);
      const older = list => (since ? (list ?? []).filter(x => x.date < since) : []);
      await db.put('market', saveMarket(symbol, { splits: [...older(rec?.splits), ...(events?.splits ?? [])], dividends: [...older(rec?.dividends), ...(events?.dividends ?? [])], eventsAt: Date.now() }));
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
  refreshMonthly();
}

const showMarketHistory = () => A.ls.get('pfTimelineMarket', false);

const BENCHMARKS = {
  nifty50: ['Nifty 50', '^NSEI'],
  next50: ['Nifty Next 50', '^NSMIDCP'],
  mid150: ['Nifty Midcap 150', 'NIFTYMIDCAP150.NS'],
  nasdaq100: ['Nasdaq 100', '^NDX'],
  sp500: ['S&P 500', '^GSPC'],
  small250: ['Nifty Smallcap 250', 'NIFTYSMLCAP250.NS'],
  nifty500: ['Nifty 500', '^CRSLDX'],
};
const benchmarkKey = id => `IX:${id}`;
const SECTOR_PE_KEY = 'IX:sectorpe';
// Named as in NSE's closing file. Microcap 250 has a P/E there but no monthly history.
const NSE_INDICES = { nifty50: 'Nifty 50', next50: 'Nifty Next 50', mid150: 'Nifty Midcap 150', small250: 'Nifty Smallcap 250', micro250: 'Nifty Microcap 250', nifty500: 'Nifty 500' };

// The indices, then everything ever held that has a price series, biggest first,
// as a first load takes minutes. Holdings only load for the Past market value switch.
function monthlySymbols() {
  const t = Date.now();
  const all = new Map(Object.entries(BENCHMARKS).map(([id, [, ticker]]) => [benchmarkKey(id), { key: benchmarkKey(id), symbol: ticker, kind: 'index', from: '2017-01-01', cost: Infinity }]));
  for (const a of showMarketHistory() ? accounts() : []) {
    const c = computed(a);
    for (const line of c.lines) {
      const p = c.positions.get(line.symbol);
      const key = marketPrefix(a) + line.symbol;
      const code = line.mutualFund ? A.S.market.find(m => m.symbol === line.symbol)?.schemeCode : null;
      if (line.mutualFund ? !code : !isTicker(line.symbol.replace('.', '')) || line.symbol.endsWith('-RE')) continue;
      const from = p.events.reduce((d, e) => (e.date < d ? e.date : d), '9999');
      const kind = line.mutualFund ? 'fund' : a.kind === 'crypto' ? 'crypto' : isUsd(a) ? 'us' : 'stock';
      const known = all.get(key);
      all.set(key, { key, symbol: line.symbol, kind, code, from: known && known.from < from ? known.from : from, cost: (known?.cost ?? 0) + line.cost + line.soldCost });
    }
  }
  return [...all.values()]
    .filter(x => t - (A.S.priceMonths.find(m => m.symbol === x.key)?.at ?? 0) > EVENTS_MAX_AGE)
    .sort((a, b) => b.cost - a.cost);
}

async function refreshMonthly() {
  if (job.running || dataMode() === 'backup') return;
  const list = monthlySymbols();
  if (!list.length) return;
  Object.assign(job, { running: true, done: 0, total: list.length, failed: 0, what: 'monthly prices' });
  showStatus();
  for (const x of list) {
    const started = Date.now();
    try {
      // Hybrid fetches from the cutoff, or from the backup's last month if that's older.
      const known = A.S.priceMonths.find(m => m.symbol === x.key)?.months ?? {};
      const keys = Object.keys(known).sort();
      const cut = recentCutoff();
      const since = cut && keys[0] < cut ? (keys.at(-1) < cut ? keys.at(-1) : cut) : null;
      const fresh = x.kind === 'fund' ? await fundMonths(x.code) : await monthlyPrices(x.symbol, since ? `${since}-01` : `${Number(x.from.slice(0, 4)) - 1}-01-01`, x.kind);
      const rec = { symbol: x.key, months: since ? mergeMonths(known, fresh ?? {}, since) : fresh ?? {}, at: Date.now() };
      A.S.priceMonths = [...A.S.priceMonths.filter(m => m.symbol !== x.key), rec];
      await db.put('priceMonths', rec);
    } catch {
      job.failed++;
    }
    job.done++;
    if (job.done % 10 === 0) redraw();
    else showStatus();
    if (x.kind !== 'fund') await new Promise(r => setTimeout(r, Math.max(0, EVENT_GAP_MS - (Date.now() - started))));
  }
  job.running = false;
  redraw();
  refreshPeHistory();
}

// Month-end index P/E and P/B, stored like monthly prices. Past files never change.
const peKey = id => `IX:pe:${id}`;
const epsKey = symbol => `EP:${symbol}`;
let peWanted = false, peLoaded = false;

// When the Metrics report first opens, as this means one file a month back to your first buy.
async function refreshPeHistory() {
  if (!peWanted || peLoaded || job.running || dataMode() === 'backup') return;
  const lots = accounts().filter(a => a.kind === 'stock' && !isUsd(a)).flatMap(a => [...computed(a).positions.values()].flatMap(p => p.lots));
  const first = lots.reduce((d, l) => (l.date < d ? l.date : d), '9999').slice(0, 7);
  const now = monthKey(new Date().toISOString());
  const have = A.S.priceMonths.find(m => m.symbol === peKey('nifty50'))?.months ?? {};
  const list = [];
  for (let k = first; k < now && first !== '9999'; k = nextMonth(k)) if (!have[k]) list.push(k);
  peLoaded = true;
  if (!list.length) return;
  Object.assign(job, { running: true, done: 0, total: list.length, failed: 0, what: 'index P/E history' });
  showStatus();
  for (const k of list) {
    const started = Date.now();
    const closes = await monthEndValuations(k).catch(() => null);
    if (!closes) job.failed++;
    const changed = Object.entries(NSE_INDICES).flatMap(([id, name]) => {
      const row = closes?.get(name);
      if (row?.pe == null) return [];
      const old = A.S.priceMonths.find(m => m.symbol === peKey(id));
      return [{ symbol: peKey(id), months: { ...old?.months, [k]: [row.pe, row.pb ?? 0] }, at: Date.now() }];
    });
    const ids = new Set(changed.map(m => m.symbol));
    A.S.priceMonths = [...A.S.priceMonths.filter(m => !ids.has(m.symbol)), ...changed];
    await db.putMany('priceMonths', changed);
    job.done++;
    if (job.done % 10 === 0) redraw();
    else showStatus();
    await new Promise(r => setTimeout(r, Math.max(0, EVENT_GAP_MS - (Date.now() - started))));
  }
  job.running = false;
  redraw();
}

async function refreshMarket(manual) {
  if (dataMode() === 'backup') {
    if (manual) A.toast('Public data is set to local backup, so nothing was downloaded');
    return;
  }
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
  if (dataMode() === 'backup') return `${icon('file')}<span>Using your local backup, not the internet. ${at ? `Prices as of ${A.relDate(at)}.` : 'No prices loaded yet.'}</span>`;
  const quoted = at ? `Prices updated ${A.relDate(at)}, delayed.` : 'Prices not loaded yet.';
  if (job.running) return `${icon('clock')}<span>${quoted} Loading ${job.what}: ${job.done} of ${job.total}. Figures update as they arrive.</span>`;
  if (job.failed) return `${icon('alert')}<span>${quoted} ${A.plural(job.failed, 'holding')} could not load ${job.what}; refresh to retry.</span>`;
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
  // Without the exchange lists, the tickers already in local data have to do.
  const list = dataMode() === 'backup'
    ? A.S.market.filter(m => m.name && !m.symbol.includes(':')).map(m => ({ symbol: m.symbol, name: m.name, isin: '', close: m.price ?? 0 }))
    : await listedSecurities();
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
  A.toast(`Source: ${names}`, { label: 'Disclosure', fn: () => A.go(`${HOME}/disclosure`) });
}

function disclosureView() {
  const used = Object.entries(SOURCES);
  const rules = Object.values(GROUPINGS).filter(g => g.rule);
  A.view.innerHTML = `
    <header class="topbar">${A.upButton(HOME)}<div class="titles"><h1>Data disclosure</h1><p>Where every outside figure comes from</p></div>${A.menuButton}</header>
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
const REPORTS = { timeline: 'Timeline', performance: 'Performance', metrics: 'Metrics', rating: 'Rating', dividends: 'Dividends', gains: 'Capital gains', earn: 'Crypto earnings', fees: 'Fees' };

// Indian financial years run April to March, named by the year they start.
const fyStart = date => Number(date.slice(0, 4)) - (date.slice(5, 7) < '04' ? 1 : 0);
const fyName = y => `FY${y}-${String(y + 1).slice(2)}`;
const monthKey = date => date.slice(0, 7);
const monthText = (key, opts) => A.fmt(new Date(`${key}-01T00:00:00`), opts);
const nextMonth = key => {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// Each broker's positions, with a rate to bring its money into what's on screen.
function reportBrokers() {
  const list = accounts().filter(a => R.broker === 'all' || a.id === R.broker);
  shown = R.broker !== 'all' && list[0]?.currency === 'USD' ? 'USD' : CONFIG.currency;
  return list.map(a => ({ account: a, c: computed(a), rate: shown === CONFIG.currency && isUsd(a) ? fxRate() ?? 0 : 1 }));
}

// With no years, the report covers all time and has no year or detail choices.
function reportFilters(years, extra = '') {
  const year = years?.includes(Number(R.year)) ? R.year : 'all';
  R.year = year;
  return `<div class="pf-sort pf-filters">
    <label for="r-broker">Broker</label>
    <select class="select" id="r-broker"><option value="all">All brokers</option>${accounts().map(a => `<option value="${a.id}"${a.id === R.broker ? ' selected' : ''}>${A.esc(a.name)}</option>`).join('')}</select>
    ${years ? `<label for="r-year">Year</label>
    <select class="select" id="r-year"><option value="all">All years</option>${years.map(y => `<option value="${y}"${String(y) === String(year) ? ' selected' : ''}>${fyName(y)}</option>`).join('')}</select>` : ''}
    <span class="pf-checks">${extra}${years ? `<label class="switch pf-detail"><input type="checkbox" id="r-detail"${detailed() ? ' checked' : ''}><span>Detailed report</span></label>` : ''}</span>
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
    for (let k = known[0]; k <= known.at(-1); k = nextMonth(k)) keys.push(k);
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

/* ---------- timeline ---------- */

const CLASS_NOUN = { Stocks: 'stock', ETFs: 'ETF', Commodities: 'commodity holding', Debt: 'debt holding', 'Mutual funds': 'mutual fund', Crypto: 'crypto holding' };
const ACTION_EVENTS = new Set(['split', 'bonus', 'merger', 'demerger']);
const MILESTONES = { [CONFIG.currency]: [1e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8], USD: [1e3, 1e4, 5e4, 1e5, 5e5, 1e6] };

const compact = v => (isPrivate() ? MASK : new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: shown, notation: 'compact', maximumFractionDigits: 1 }).format(v));
let growth = null;

// The money moved each year, and the running cost of what was held, from every position.
function timelineLedger(brokers) {
  const ledger = [];
  const years = new Map();
  const year = date => {
    const y = fyStart(date);
    if (!years.has(y)) years.set(y, { y, added: 0, sold: 0, gain: 0, dividends: 0, end: 0 });
    return years.get(y);
  };
  const buys = [], sales = [], paid = [], actions = [], firsts = new Map();
  for (const { c, rate } of brokers) {
    for (const p of c.positions.values()) {
      const bought = [...p.lots.map(l => [l.date, l.qty * l.price * rate]), ...p.realized.map(s => [s.buyDate, s.qty * s.cost * rate])];
      bought.forEach(([date, cost]) => { ledger.push({ date, change: cost }); year(date).added += cost; });
      for (const s of p.realized) {
        ledger.push({ date: s.sellDate, change: -s.qty * s.cost * rate });
        year(s.sellDate).sold += s.qty * s.price * rate;
        year(s.sellDate).gain += s.qty * (s.price - s.cost) * rate;
      }
      for (const d of p.dividendEvents) {
        year(d.date).dividends += d.amount * rate;
        paid.push({ date: d.date, symbol: p.symbol, amount: d.amount * rate });
      }
      for (const e of p.events) {
        if (e.kind === 'buy') buys.push({ date: e.date, symbol: p.symbol, amount: e.qty * e.price * rate });
        else if (e.kind === 'sell') sales.push({ date: e.date, symbol: p.symbol, amount: e.qty * e.price * rate, gain: (e.gain ?? 0) * rate });
        else if (ACTION_EVENTS.has(e.kind)) actions.push({ date: e.date, symbol: p.symbol, kind: e.kind, ratio: e.ratio });
      }
      const group = c.lines.find(l => l.symbol === p.symbol)?.group;
      const start = bought.map(b => b[0]).sort()[0];
      if (group && start && !(firsts.get(group)?.date <= start)) firsts.set(group, { date: start, symbol: p.symbol, group });
    }
  }
  ledger.sort((a, b) => a.date.localeCompare(b.date));
  return { ledger, years, year, buys, sales, paid, actions, firsts };
}

// Estimated value at each month's open and close. Yahoo's prices are in today's
// share units, as open lots are, while a sold lot stays in the units of its sale
// and so is scaled up by later splits. A holding with no price for a month is
// taken as moving steadily from its cost to today's price, so it doesn't jump
// at the end. One sold counts at cost, as nothing says what it was worth.
function monthlyValues(brokers, months, only) {
  const values = new Map(months.map(k => [k, { open: 0, close: 0, heldClose: 0 }]));
  const records = new Map(A.S.priceMonths.map(m => [m.symbol, m.months]));
  let priced = 0, total = 0;
  for (const { account, c, rate } of brokers) {
    const actions = allActions(marketFor(account)).filter(a => a.type === 'split' || a.type === 'bonus');
    for (const p of c.positions.values()) {
      const prices = records.get(marketPrefix(account) + p.symbol) ?? {};
      if ((!p.lots.length && !p.realized.length) || (only && !only.has(`${account.id}:${p.symbol}`))) continue;
      total++;
      if (Object.keys(prices).length) priced++;
      const later = date => actions.filter(a => a.symbol === p.symbol && a.date > date).reduce((n, a) => n * a.num / a.den, 1);
      const lots = [
        ...p.lots.map(l => ({ from: l.date, to: '9999', qty: l.qty, cost: l.qty * l.price })),
        ...p.realized.map(s => ({ from: s.buyDate, to: s.sellDate, qty: s.qty * later(s.sellDate), cost: s.qty * s.cost })),
      ];
      const latest = c.lines.find(l => l.symbol === p.symbol)?.price;
      for (const lot of lots) {
        const bought = Date.parse(lot.from);
        const guess = date => {
          if (lot.to !== '9999' || latest == null) return lot.cost;
          const part = (Date.parse(date) - bought) / ((Date.now() - bought) || 1);
          return lot.cost + (lot.qty * latest - lot.cost) * Math.min(Math.max(part, 0), 1);
        };
        for (const k of months) {
          const row = values.get(k), first = `${k}-01`, last = `${k}-31`;
          const [open, close] = prices[k] ?? [];
          const atClose = (close == null ? guess(`${k}-28`) : lot.qty * close) * rate;
          // Lots held from the start show what the market did, apart from new money.
          if (lot.from < first && lot.to >= first) {
            row.open += (open == null ? guess(first) : lot.qty * open) * rate;
            row.heldClose += atClose;
          }
          if (lot.from <= last && lot.to > last) row.close += atClose;
        }
      }
    }
  }
  return { values, priced, total };
}

// Everything worth a card. Keyed so one event shows once, with its biggest claim.
function timelineHighlights(brokers, data) {
  const marks = new Map();
  const add = (key, h) => { if (!marks.has(key)) marks.set(key, h); };
  const record = (key, major, h) => add(key, { ...h, major });
  const best = (list, score) => list.reduce((a, b) => (score(b) > score(a) ? b : a), list[0]);
  const ofYear = list => Object.values(Object.groupBy(list, x => fyStart(x.date)));
  const buyCard = (b, title, major) => record(`buy:${b.date}:${b.symbol}`, major, { date: b.date, kind: 'buy', title, detail: `Bought ${b.symbol}`, amount: money(b.amount) });
  const saleCard = (s, title, major) => record(`sale:${s.date}:${s.symbol}`, major, { date: s.date, kind: 'sale', title, detail: `Sold ${s.symbol} for ${money(s.amount)}`, amount: money(s.gain, true), cls: tone(s.gain) });
  const payCard = (d, title, major) => record(`paid:${d.date}:${d.symbol}`, major, { date: d.date, kind: 'paid', title, detail: `From ${d.symbol}`, amount: money(d.amount) });

  for (const f of data.firsts.values()) record(`first:${f.group}`, true, { date: f.date, kind: 'first', title: `First ${CLASS_NOUN[f.group]}`, detail: f.symbol });
  for (const { account } of brokers) {
    const start = A.S.trades.filter(t => t.accountId === account.id).map(t => t.date).sort()[0];
    if (start) record(`broker:${account.id}`, true, { date: start, kind: 'broker', title: `Started with ${account.name}`, detail: KINDS[account.kind] });
  }
  const ids = new Set(brokers.map(b => b.account.id));
  for (const x of A.S.transfers.filter(y => ids.has(y.fromAccountId) || ids.has(y.toAccountId))) {
    record(`transfer:${x.id}`, true, { date: x.date, kind: 'transfer', title: `Moved ${x.coin} to ${accountById(x.toAccountId)?.name ?? 'another account'}`, detail: `From ${accountById(x.fromAccountId)?.name ?? 'another account'}`, amount: isPrivate() ? MASK : `${qtyText(x.received)} ${x.coin}` });
  }

  let running = 0;
  const steps = [...MILESTONES[shown]];
  for (const { date, change } of data.ledger) {
    running += change;
    data.year(date).end = running;
    while (steps.length && running >= steps[0]) {
      const step = steps.shift();
      record(`mile:${step}`, true, { date, kind: 'mile', title: `Invested passed ${compact(step)}`, detail: 'Cost of what you held' });
    }
  }

  if (data.buys.length) buyCard(best(data.buys, b => b.amount), 'Largest purchase', true);
  if (data.sales.length) {
    saleCard(best(data.sales, s => s.gain), 'Best sale', true);
    saleCard(best(data.sales, s => -s.gain), 'Toughest sale', true);
  }
  if (data.paid.length) {
    payCard(best(data.paid, d => -new Date(d.date)), 'First dividend', true);
    payCard(best(data.paid, d => d.amount), 'Largest dividend', true);
  }
  // The rest of the record, a year at a time, for the detailed report.
  ofYear(data.buys).forEach(list => buyCard(best(list, b => b.amount), 'Year\'s largest purchase', false));
  ofYear(data.sales).forEach(list => saleCard(best(list, s => s.gain), 'Year\'s best sale', false));
  ofYear(data.paid).forEach(list => payCard(best(list, d => d.amount), 'Year\'s largest dividend', false));
  // A merger shows on both companies, and a stock held at two brokers shows twice.
  for (const list of Object.values(Object.groupBy(data.actions, a => `${a.date}:${a.kind}:${a.ratio}`))) {
    const [a] = list;
    add(`act:${a.date}:${a.kind}:${a.ratio}`, { date: a.date, kind: 'action', title: `${EVENT_LABEL[a.kind]}: ${[...new Set(list.map(x => x.symbol))].join(', ')}`, detail: a.ratio ?? '', major: false });
  }
  return [...marks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const TIMELINE_ICON = { first: 'pie', broker: 'briefcase', transfer: 'swap', mile: 'chart', buy: 'plus', sale: 'check', paid: 'calendar', action: 'restore', today: 'clock' };

function timelineCard(h) {
  return `<li class="tl-item${h.major ? ' major' : ''}">
    <span class="tl-dot">${icon(TIMELINE_ICON[h.kind])}</span>
    <div class="tl-card">
      <time datetime="${h.date}">${day(h.date)}</time>
      <strong>${A.esc(h.title)}</strong>
      ${h.detail ? `<span class="tl-detail">${A.esc(h.detail)}</span>` : ''}
      ${h.amount ? `<span class="tl-amount ${h.cls ?? ''}">${h.amount}</span>` : ''}
    </div>
  </li>`;
}

function timelineReport() {
  const brokers = reportBrokers();
  const data = timelineLedger(brokers);
  const marks = timelineHighlights(brokers, data);
  const list = [...data.years.keys()].sort((a, b) => b - a);
  const history = showMarketHistory();
  const filters = reportFilters(list, `<label class="switch pf-detail"><input type="checkbox" id="r-market"${history ? ' checked' : ''}><span>Past market value</span></label>`);
  growth = null;
  if (!data.ledger.length) return `${filters}<div class="empty">${icon('chart')}<p>No trades for this selection.</p></div>`;

  const rows = brokers.flatMap(({ c, rate }) => (rate === 1 ? c.lines : c.lines.map(l => inRupees(l, rate))));
  const s = summarizeAll(rows);
  const held = rows.filter(l => l.qty > EPS && l.value != null);
  const largest = held.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
  const gainer = held.reduce((a, b) => (!a || (b.gain ?? 0) > (a.gain ?? 0) ? b : a), null);
  const today = new Date().toISOString().slice(0, 10);
  const first = data.ledger[0].date;
  const banked = s.realized + s.dividends;
  const span = (Date.now() - new Date(first)) / (365.25 * 864e5);

  // Month by month from the ledger, carrying the last figure through quiet months.
  const keys = [];
  for (let k = monthKey(first); k <= monthKey(today); k = nextMonth(k)) keys.push(k);
  const priced = history ? monthlyValues(brokers, keys) : null;
  const closeOf = k => (k >= keys.at(-1) ? s.value : priced.values.get(k).close);
  if (priced) {
    data.years.forEach(r => { r.value = closeOf(`${r.y + 1}-03`); });
    const past = keys.slice(0, -1);
    const peak = past.reduce((a, b) => (closeOf(b) > closeOf(a) ? b : a), past[0]);
    // Early months hold so little that one stock would decide these.
    const moves = past.map(k => ({ k, ...priced.values.get(k) })).filter(m => m.open >= closeOf(peak) * 0.02).map(m => ({ k: m.k, pct: (m.heldClose / m.open - 1) * 100 }));
    const card = (k, title, detail, amount, cls) => marks.push({ date: `${k}-28`, kind: 'mile', major: true, title, detail, amount, cls });
    if (peak) card(peak, 'Highest month-end value', 'Estimated from month-end prices', money(closeOf(peak)));
    if (moves.length) {
      const up = moves.reduce((a, b) => (b.pct > a.pct ? b : a));
      const down = moves.reduce((a, b) => (b.pct < a.pct ? b : a));
      card(up.k, 'Best month', 'Holdings from open to close', pct(up.pct), tone(up.pct));
      card(down.k, 'Toughest month', 'Holdings from open to close', pct(down.pct), tone(down.pct));
    }
  }
  const points = [];
  let at = 0, running = 0;
  for (const k of keys) {
    while (at < data.ledger.length && monthKey(data.ledger[at].date) === k) running += data.ledger[at++].change;
    const notes = marks.filter(h => h.major && monthKey(h.date) === k).map(h => h.title);
    const open = priced?.values.get(k).open;
    points.push({ date: `${k}-15`, label: monthText(k, { month: 'short', year: 'numeric' }), value: running, text: money(running), notes, ...(priced && { market: closeOf(k), marketText: money(closeOf(k)), openText: money(open) }) });
  }
  growth = { points, value: s.value, valueText: money(s.value), market: !!priced };

  const nowCard = { date: today, kind: 'today', major: true, title: 'Today', detail: [largest && `Largest holding ${largest.symbol}`, gainer && `Biggest gain ${gainer.symbol}`, `XIRR ${pct(s.xirr)}`].filter(Boolean).join(' · '), amount: money(s.value) };
  const cards = [...marks.filter(h => detailed() || h.major), nowCard].filter(h => inYear(h.date)).sort((a, b) => b.date.localeCompare(a.date));
  const groups = Object.entries(Object.groupBy(cards, h => fyStart(h.date))).sort(([a], [b]) => b - a);
  const chartNote = priced
    ? `Market value is an estimate from monthly closes, with ${priced.priced} of ${A.plural(priced.total, 'holding')} priced${job.running ? ' so far' : ''}. The rest are estimated between their cost and today's price.`
    : 'The cost of what you held each month. Only the last point is a market value, unless Past market value is on.';
  return `${filters}
    <div class="stats five">
      ${stat(`Value today${info('timeline')}`, money(s.value), s.unpriced ? `${s.unpriced} unpriced left out` : `${pct(s.gainPct)} on cost`)}
      ${stat(`Invested now${info('timeline')}`, money(s.cost), `Since ${day(first)}, ${span.toFixed(1)} years`)}
      ${stat('Gains banked', money(banked, true), 'Realized gains and dividends', tone(banked))}
      ${stat(`XIRR${info('xirr')}`, pct(s.xirr), 'Annual return', tone(s.xirr))}
    </div>
    <section class="panel">
      <h2>${priced ? 'Portfolio growth' : 'Money invested over time'}${info('timeline')}</h2>
      <p class="muted small chart-note">${chartNote}</p>
      ${priced ? `<div class="status" id="pf-status">${statusLine()}</div>
      <div class="g-legend"><span><i class="g-key market"></i>Market value</span><span><i class="g-key invested"></i>Invested</span></div>` : ''}
      <div class="pf-growth" id="pf-growth" role="img" aria-label="Line chart of money invested each month, ending at today's market value. The table below has the figures."></div>
    </section>
    <details class="panel pf-details"${detailed() ? ' open' : ''}>
      <summary>Year by year</summary>
      <div class="holdings-wrap"><table class="holdings lots">
        <thead><tr><th>Year</th><th class="num">Added</th><th class="num">Sold for</th><th class="num">Realized gain</th><th class="num">Dividends</th><th class="num">Invested at year end</th>${priced ? '<th class="num">Market value at year end</th>' : ''}</tr></thead>
        <tbody>${list.map(y => { const r = data.years.get(y); return `<tr><th scope="row">${fyName(y)}</th><td class="num">${money(r.added)}</td><td class="num">${money(r.sold)}</td><td class="num ${tone(r.gain)}">${money(r.gain, true)}</td><td class="num">${money(r.dividends)}</td><td class="num">${money(r.end)}</td>${priced ? `<td class="num">${money(r.value)}</td>` : ''}</tr>`; }).join('')}</tbody>
      </table></div>
    </details>
    <section class="pf-timeline" aria-label="Investment highlights">
      ${groups.map(([y, items]) => {
        const r = data.years.get(Number(y));
        return `<div class="tl-year"><h2>${fyName(Number(y))}</h2>${r ? `<p>Added ${money(r.added)} · Dividends ${money(r.dividends)} · Invested at year end ${money(r.end)}${priced ? ` · Market value ${money(r.value)}` : ''}</p>` : ''}</div>
          <ol class="tl-list">${items.map(timelineCard).join('')}</ol>`;
      }).join('')}
    </section>`;
}

// Drawn to the panel's real width, so the text stays the same size on a phone.
function drawGrowth() {
  const box = A.$('#pf-growth');
  if (!box || !growth) return;
  const { points, value, market } = growth;
  const w = box.clientWidth;
  const narrow = w < 560;
  const h = narrow ? 230 : 300;
  const m = { l: 56, r: narrow ? 16 : 118, t: 26, b: 26 };
  const time = s => new Date(`${s}T00:00:00`).getTime();
  const start = time(points[0].date);
  const x = s => m.l + (time(s) - start) / ((time(points.at(-1).date) - start) || 1) * (w - m.l - m.r);
  const peak = Math.max(value, ...points.map(p => Math.max(p.value, p.market ?? 0))) || 1;
  const unit = 10 ** Math.floor(Math.log10(peak));
  const top = Math.ceil(peak / unit * 2) / 2 * unit;
  const y = v => m.t + (1 - v / top) * (h - m.t - m.b);
  const ticks = [0, 1, 2, 3, 4].map(i => top * i / 4);
  const years = [...new Set(points.map(p => p.date.slice(0, 4)))];
  const every = Math.ceil(years.length / (narrow ? 4 : 9));
  const pathOf = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
  const path = pathOf('value');
  const last = points.at(-1);
  const endX = x(last.date);
  const apart = Math.abs(y(value) - y(last.value)) > 34;
  const side = narrow ? `text-anchor="end" x="${endX - 8}"` : `x="${endX + 10}"`;
  box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${ticks.map(t => `<line class="g-grid" x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="g-axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('')}
    ${years.filter((_, i) => i % every === 0).map(d => `<text class="g-axis" x="${x(`${d}-01-01`) < m.l ? m.l : x(`${d}-01-01`)}" y="${h - 8}" text-anchor="middle">${d}</text>`).join('')}
    <path class="g-area" d="${market ? pathOf('market') : path}L${endX.toFixed(1)} ${y(0)}L${m.l} ${y(0)}Z"/>
    ${market ? `<path class="g-line invested" d="${path}"/><path class="g-line" d="${pathOf('market')}"/>` : `<path class="g-line" d="${path}"/>
    <line class="g-gap" x1="${endX}" x2="${endX}" y1="${y(last.value)}" y2="${y(value)}"/>`}
    ${points.filter(p => p.notes.length).map(p => `<circle class="g-mark" cx="${x(p.date)}" cy="${y(p.market ?? p.value)}" r="4"/>`).join('')}
    <circle class="g-today" cx="${endX}" cy="${y(value)}" r="6"/>
    <text class="g-label" ${side} y="${y(value) + (narrow ? -12 : 4)}">Today ${compact(value)}</text>
    ${apart ? `<text class="g-axis" ${side} y="${y(last.value) + (narrow ? 18 : 4)}">Invested ${compact(last.value)}</text>` : ''}
    <line class="g-cross" id="g-cross" y1="${m.t}" y2="${h - m.b}" hidden/>
  </svg><div class="g-tip" id="g-tip" hidden></div>`;
  const tip = A.$('#g-tip'), cross = A.$('#g-cross');
  box.onpointermove = e => {
    const px = e.clientX - box.getBoundingClientRect().left;
    const p = points.reduce((a, b) => (Math.abs(x(b.date) - px) < Math.abs(x(a.date) - px) ? b : a));
    cross.setAttribute('x1', x(p.date));
    cross.setAttribute('x2', x(p.date));
    cross.removeAttribute('hidden');
    tip.hidden = false;
    const worth = market ? `<span>Opened at ${p.openText}</span><span>Closed at ${p.marketText}</span>` : p === last ? `<span>Market value ${growth.valueText}</span>` : '';
    tip.innerHTML = `<strong>${p.label}</strong><span>Invested ${p.text}</span>${worth}${p.notes.map(n => `<span>${A.esc(n)}</span>`).join('')}`;
    tip.style.left = `${Math.min(Math.max(x(p.date) - tip.offsetWidth / 2, 0), w - tip.offsetWidth)}px`;
  };
  box.onpointerleave = () => { tip.hidden = true; cross.setAttribute('hidden', ''); };
}

/* ---------- performance ---------- */

const PERF_GROUPS = { type: 'Instrument type', cap: 'Market cap', sector: 'Sector' };
const INDIA_INDICES = ['nifty50', 'next50', 'mid150'];
const US_INDICES = ['nasdaq100', 'sp500'];
const perfGroup = () => { const key = A.ls.get('pfPerfGroup', 'type'); return PERF_GROUPS[key] ? key : 'type'; };

// Skips commodities and crypto. Funds of US shares count as US, wherever they're held.
function perfType(account, line) {
  if (line.group === 'Commodities' || line.group === 'Crypto') return null;
  if (line.group === 'Debt') return 'Debt';
  const fund = line.mutualFund || line.group === 'ETFs';
  if (isUsd(account)) return fund ? 'US MF' : 'US stocks';
  if (fund && /\b(nasdaq|s\s*(&|and)\s*p\s*500|u\.?\s?s\.?|american?)(?=\W|$)/i.test(`${line.symbol} ${line.name}`)) return 'US MF';
  return line.mutualFund ? 'Mutual funds' : 'Indian stocks';
}

// An index's level on a date, read between that month's open and close.
function indexLevel(months, keys, date) {
  const key = date.slice(0, 7);
  const candle = months[key];
  if (candle) return candle[0] + (candle[1] - candle[0]) * Math.min(Number(date.slice(8)), 30) / 30;
  const before = keys.filter(k => k < key).at(-1);
  return before ? months[before][1] : months[keys[0]][0];
}

// What the same money, in and out on the same dates, would have made in the index.
function benchmarkXirr(lines, id) {
  const months = A.S.priceMonths.find(m => m.symbol === benchmarkKey(id))?.months;
  const keys = Object.keys(months ?? {}).sort();
  if (!keys.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const flows = lines.flatMap(l => (l.flows ?? []).filter(f => !(f.date === today && f.amount === l.value)));
  if (!flows.length) return null;
  const units = flows.reduce((n, f) => n - f.amount / indexLevel(months, keys, f.date), 0);
  return xirr([...flows, { date: today, amount: units * months[keys.at(-1)][1] }]);
}

function indexCell(lines, id, yours) {
  const theirs = benchmarkXirr(lines, id);
  if (theirs == null) return '<td class="num">–</td>';
  const gap = yours == null ? null : yours - theirs;
  return `<td class="num">${pct(theirs)}${gap == null ? '' : `<small class="${tone(gap)}">${Math.abs(gap).toFixed(2)} pts ${gap >= 0 ? 'ahead' : 'behind'}</small>`}</td>`;
}

// Month-end value of the same money in each index, beside your own value.
function perfGrowth(rows, indices, brokers) {
  const today = new Date().toISOString().slice(0, 10);
  const flows = rows.flatMap(l => (l.flows ?? []).filter(f => !(f.date === today && f.amount === l.value))).sort((a, b) => a.date.localeCompare(b.date));
  if (!flows.length) return null;
  const keys = [];
  for (let k = monthKey(flows[0].date); k <= monthKey(today); k = nextMonth(k)) keys.push(k);
  const walk = fn => {
    let at = 0, total = 0;
    return keys.map(k => {
      while (at < flows.length && monthKey(flows[at].date) === k) total += fn(flows[at++]);
      return total;
    });
  };
  const series = indices.flatMap(id => {
    const months = A.S.priceMonths.find(m => m.symbol === benchmarkKey(id))?.months;
    const known = Object.keys(months ?? {}).sort();
    if (!known.length) return [];
    return [{ id, label: BENCHMARKS[id][0], units: walk(f => -f.amount / indexLevel(months, known, f.date)), levels: keys.map(k => indexLevel(months, known, `${k}-30`)) }];
  });
  const history = showMarketHistory();
  const held = history ? monthlyValues(brokers, keys, new Set(rows.map(l => `${l.account.id}:${l.symbol}`))).values : null;
  const net = walk(f => -f.amount);
  const yours = keys.map((k, i) => (held ? held.get(k).close : net[i]));
  yours[yours.length - 1] = summarizeAll(rows).value;
  return {
    labels: keys.map(k => monthText(k, { month: 'short', year: 'numeric' })),
    dates: keys,
    series: [{ id: 'you', label: history ? 'Your value' : 'Your net money in, then value today', values: yours }, ...series],
  };
}

const PERF_RANGES = { 1: '1M', 3: '3M', 6: '6M', 12: '1Y', 60: '5Y', all: 'All time' };
const perfRange = () => { const key = A.ls.get('pfPerfRange', 'all'); return PERF_RANGES[key] ? String(key) : 'all'; };

// The chosen period. Each index restarts from your value on its first month, then
// follows your money from there, so the lines show that period alone.
function inRange(chart) {
  const range = perfRange();
  const start = range === 'all' ? 0 : Math.max(chart.dates.length - 1 - Number(range), 0);
  const [you, ...others] = chart.series;
  const series = [{ ...you, values: you.values.slice(start) }, ...others.map(s => {
    const base = start ? you.values[start] / s.levels[start] : s.units[0];
    return { ...s, values: s.levels.map((level, i) => (base + s.units[i] - s.units[start]) * level).slice(start) };
  })];
  return { dates: chart.dates.slice(start), labels: chart.labels.slice(start), series };
}

const perfCharts = [];
const chartSlot = chart => {
  if (!chart) return '';
  perfCharts.push(chart);
  return `<div class="pf-growth pf-chart" data-chart="${perfCharts.length - 1}"></div>`;
};
const chartLegend = (ids, you) => `<div class="g-legend">${you ? `<span><i class="g-key s-you"></i>${A.esc(you)}</span>` : ''}${ids.map(id => `<span><i class="g-key s-${id}"></i>${BENCHMARKS[id][0]}</span>`).join('')}</div>`;

function drawLines(box, chart) {
  const { series, dates, labels } = chart;
  const w = box.clientWidth, narrow = w < 560, h = narrow ? 230 : 300;
  const m = { l: 56, r: narrow ? 14 : 96, t: 14, b: 26 };
  const x = i => m.l + i / Math.max(dates.length - 1, 1) * (w - m.l - m.r);
  const peak = Math.max(...series.flatMap(s => s.values)) || 1;
  const unit = 10 ** Math.floor(Math.log10(peak));
  const top = Math.ceil(peak / unit * 2) / 2 * unit;
  const y = v => m.t + (1 - Math.max(v, 0) / top) * (h - m.t - m.b);
  // Months for a short period, years for a long one.
  const short = dates.length <= 25;
  const years = [...new Set(dates.map(d => d.slice(0, 4)))];
  const every = Math.ceil((short ? dates.length : years.length) / (narrow ? 4 : short ? 7 : 9));
  const ticks = short
    ? dates.map((_, i) => i).filter(i => i % every === 0).map(i => [i, labels[i]])
    : years.filter((_, i) => i % every === 0).map(yr => [Math.max(dates.indexOf(`${yr}-01`), 0), yr]);
  // Lines finishing close together keep only the legend, so labels don't pile up.
  let lastY = -Infinity;
  const ends = narrow ? [] : [...series].sort((a, b) => y(a.values.at(-1)) - y(b.values.at(-1))).filter(s => {
    const at = y(s.values.at(-1));
    if (at - lastY < 15) return false;
    lastY = at;
    return true;
  });
  box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${[0, 1, 2, 3, 4].map(i => { const t = top * i / 4; return `<line class="g-grid" x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="g-axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`; }).join('')}
    ${ticks.map(([i, text]) => `<text class="g-axis" x="${x(i)}" y="${h - 8}" text-anchor="${i ? 'middle' : 'start'}">${text}</text>`).join('')}
    ${[...series].reverse().map(s => `<path class="g-series s-${s.id}" d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}"/>`).join('')}
    ${series.map(s => `<circle class="g-end s-${s.id}" cx="${x(dates.length - 1)}" cy="${y(s.values.at(-1))}" r="4"/>`).join('')}
    ${ends.map(s => `<text class="g-axis" x="${x(dates.length - 1) + 9}" y="${y(s.values.at(-1)) + 4}">${compact(s.values.at(-1))}</text>`).join('')}
    <line class="g-cross" y1="${m.t}" y2="${h - m.b}" hidden/>
  </svg><div class="g-tip" hidden></div>`;
  const tip = box.querySelector('.g-tip'), cross = box.querySelector('.g-cross');
  box.onpointermove = e => {
    const px = e.clientX - box.getBoundingClientRect().left;
    const i = Math.round(Math.min(Math.max((px - m.l) / (w - m.l - m.r), 0), 1) * (dates.length - 1));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.removeAttribute('hidden');
    tip.hidden = false;
    tip.innerHTML = `<strong>${labels[i]}</strong>${[...series].sort((a, b) => b.values[i] - a.values[i]).map(s => `<span><i class="g-key s-${s.id}"></i> ${A.esc(s.label)} ${money(s.values[i])}</span>`).join('')}`;
    tip.style.left = `${Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), w - tip.offsetWidth)}px`;
  };
  box.onpointerleave = () => { tip.hidden = true; cross.setAttribute('hidden', ''); };
}

function drawHistogram(box, { bins, edges }) {
  const w = box.clientWidth, h = 230;
  const m = { l: 10, r: 10, t: 22, b: 26 };
  const slot = (w - m.l - m.r) / bins.length;
  const peak = Math.max(...bins.map(b => b.count)) || 1;
  const y = v => h - m.b - v / peak * (h - m.t - m.b);
  const bar = Math.min(24, slot * 0.7);
  box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <line class="g-grid" x1="${m.l}" x2="${w - m.r}" y1="${y(0)}" y2="${y(0)}"/>
    ${edges.map((edge, i) => `<text class="g-axis" x="${m.l + slot * (i + 1)}" y="${h - 8}" text-anchor="middle">${edge}%</text>`).join('')}
    ${bins.map((b, i) => {
      if (!b.count) return '';
      const left = m.l + slot * i + (slot - bar) / 2, top = y(b.count), r = Math.min(4, y(0) - top);
      return `<path class="g-bar ${b.loss ? 'loss' : 'up'}" d="M${left} ${y(0)}V${top + r}Q${left} ${top} ${left + r} ${top}H${left + bar - r}Q${left + bar} ${top} ${left + bar} ${top + r}V${y(0)}Z"/>
        <text class="g-label" x="${left + bar / 2}" y="${top - 6}" text-anchor="middle">${b.count}</text>`;
    }).join('')}
  </svg><div class="g-tip" hidden></div>`;
  const tip = box.querySelector('.g-tip');
  box.onpointermove = e => {
    const rect = box.getBoundingClientRect();
    const b = bins[Math.floor((e.clientX - rect.left - m.l) / slot)];
    tip.hidden = !b;
    if (!b) return;
    tip.innerHTML = `<strong>${b.label}</strong><span>${A.plural(b.count, 'stock')}, ${b.share.toFixed(1)}% of stock value</span>${b.names ? `<span>${A.esc(b.names)}</span>` : ''}`;
    tip.style.left = `${Math.min(Math.max(e.clientX - rect.left - tip.offsetWidth / 2, 0), w - tip.offsetWidth)}px`;
  };
  box.onpointerleave = () => { tip.hidden = true; };
}

const drawChart = box => {
  const chart = perfCharts[box.dataset.chart];
  if (chart?.bins) drawHistogram(box, chart);
  else if (chart) drawLines(box, inRange(chart));
};

/* ---------- top and worst stocks ---------- */

const TOP_SIZES = [10, 20, 30];
const topSize = () => { const n = A.ls.get('pfPerfTop', 10); return TOP_SIZES.includes(n) ? n : 10; };
const RETURN_EDGES = [-50, -25, 0, 25, 50, 100, 200];

// Stocks held today, one row a ticker across brokers. Return counts price gain,
// realized gain and dividends against all the money ever put in.
function heldByTicker(rows) {
  const byTicker = new Map();
  for (const line of rows.filter(l => l.group === 'Stocks' && l.qty > EPS && l.value != null)) {
    const key = marketPrefix(line.account) + line.symbol;
    byTicker.set(key, [...(byTicker.get(key) ?? []), { account: line.account, line }]);
  }
  return [...byTicker.values()];
}

function stockReturns(rows) {
  return heldByTicker(rows).map(mergeLines).map(l => {
    const put = l.cost + l.soldCost;
    const made = (l.gain ?? 0) + l.realized + l.dividends;
    return { ...l, put, made, ret: put > 0 ? made / put * 100 : null };
  }).filter(l => l.ret != null).sort((a, b) => b.ret - a.ret);
}

function returnBins(stocks) {
  const total = stocks.reduce((n, l) => n + l.value, 0);
  const lows = [-Infinity, ...RETURN_EDGES];
  return lows.map((low, i) => {
    const high = lows[i + 1] ?? Infinity;
    const list = stocks.filter(l => l.ret >= low && l.ret < high);
    const label = low === -Infinity ? `Below ${high}%` : high === Infinity ? `${low}% or more` : `${low}% to ${high}%`;
    const names = list.slice(0, 5).map(l => l.symbol).join(', ') + (list.length > 5 ? ` and ${list.length - 5} more` : '');
    return { label, loss: high <= 0, count: list.length, share: total ? list.reduce((n, l) => n + l.value, 0) / total * 100 : 0, names };
  });
}

function performerRows(list) {
  return `<div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>Ticker</th><th>Stock name</th><th>Brokers</th>${['Money put in', 'Market value', 'Total return', 'Return', 'XIRR'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
    <tbody>${list.map(l => `<tr>
      <th scope="row"><a href="${accountPath(l.holders[0].id)}/h/${encodeURIComponent(l.symbol)}">${A.esc(l.symbol)}</a></th>
      <td class="pf-name" title="${A.esc(l.name)}">${A.esc(l.name) || '–'}</td>
      <td class="pf-name" title="${A.esc(l.brokers)}">${A.esc(l.brokers)}</td>
      <td class="num">${money(l.put)}</td>
      <td class="num">${money(l.value)}</td>
      <td class="num ${tone(l.made)}">${money(l.made, true)}</td>
      <td class="num ${tone(l.ret)}">${pct(l.ret)}</td>
      <td class="num ${tone(l.xirr)}">${pct(l.xirr)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function performersPanel(rows) {
  const stocks = stockReturns(rows);
  if (!stocks.length) return '';
  const size = topSize();
  const n = Math.min(size, Math.floor(stocks.length / 2));
  const top = stocks.slice(0, n), worst = stocks.slice(stocks.length - n).reverse();
  const rest = stocks.slice(n, stocks.length - n);
  const sum = (list, key) => list.reduce((t, l) => t + l[key], 0);
  const whole = { made: sum(stocks, 'made'), value: sum(stocks, 'value') };
  const line = (label, list) => {
    const put = sum(list, 'put'), made = sum(list, 'made'), value = sum(list, 'value');
    return `<tr><th scope="row">${label}</th><td class="num">${list.length}</td><td class="num">${money(put)}</td><td class="num">${money(value)}</td>
      <td class="num ${tone(made)}">${money(made, true)}</td><td class="num ${tone(made)}">${pct(put ? made / put * 100 : null)}</td>
      <td class="num">${plainPct(whole.value ? value / whole.value * 100 : null)}</td>
      <td class="num ${tone(made)}">${whole.made ? pct(made / whole.made * 100) : '–'}</td></tr>`;
  };
  const up = stocks.filter(l => l.ret > 0).length;
  const middle = stocks[Math.floor(stocks.length / 2)].ret;
  return `<section class="panel"><h2>Top and worst performers${info('performers')}</h2>
    <p class="muted small chart-note">Stocks held today, ranked by total return: price gain, realized gain and dividends, on all the money put in, including shares sold since. ETFs, funds, debt, commodities and crypto are left out.</p>
    <div class="seg pf-assets" role="group" aria-label="How many stocks">${TOP_SIZES.map(k => `<button data-top="${k}" aria-pressed="${k === size}">Top and worst ${k}</button>`).join('')}</div>
    ${n < size ? `<p class="muted small chart-note">Only ${A.plural(stocks.length, 'stock')} here, so this shows ${n} each way.</p>` : ''}
    <h3 class="g-title">Top ${n} and worst ${n} against total returns</h3>
    <div class="holdings-wrap"><table class="holdings pf-summary">
      <thead><tr><th>Stocks</th>${['Count', 'Money put in', 'Market value', 'Total return', 'Return', 'Share of value', 'Share of total return'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
      <tbody>${line(`Top ${n}`, top)}${line(`Worst ${n}`, worst)}${rest.length ? line('All others', rest) : ''}</tbody>
      <tfoot>${line('Total', stocks)}</tfoot>
    </table></div>
    <h3 class="g-title">How your stocks' returns are spread</h3>
    <p class="muted small chart-note">${up} of ${A.plural(stocks.length, 'stock')} are up. The middle stock has returned ${pct(middle)}.</p>
    ${chartSlot({ bins: returnBins(stocks), edges: RETURN_EDGES })}
    <h3 class="g-title">Top ${n}</h3>
    ${performerRows(top)}
    <h3 class="g-title">Worst ${n}</h3>
    ${performerRows(worst)}
  </section>`;
}

function perfTable(title, groups, indices, noIndex = [], growth = null, growthNote = '') {
  if (!groups.length) return '';
  const all = groups.flatMap(([, list]) => list);
  const line = (list, compare) => {
    const s = summarizeAll(list);
    return `<td class="num">${list.filter(l => l.qty > EPS).length}</td>
      <td class="num">${money(s.cost)}</td>
      <td class="num">${money(s.value)}</td>
      <td class="num ${tone(s.gain)}">${money(s.gain, true)}<small>${pct(s.gainPct)}</small></td>
      <td class="num ${tone(s.xirr)}">${pct(s.xirr)}</td>
      ${indices.map(id => (compare ? indexCell(list, id, s.xirr) : '<td class="num">–</td>')).join('')}`;
  };
  return `<section class="panel"><h2>${title}</h2>
    ${growth ? `<h3 class="g-title">Same money in each index</h3>
      <p class="muted small chart-note">${growthNote}</p>
      <div class="seg pf-assets" role="group" aria-label="Period">${Object.entries(PERF_RANGES).map(([k, label]) => `<button data-range="${k}" aria-pressed="${k === perfRange()}">${label}</button>`).join('')}</div>
      ${chartLegend(growth.series.slice(1).map(s => s.id), growth.series[0].label)}
      ${chartSlot(growth)}` : ''}
    <div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>${PERF_GROUPS[perfGroup()]}</th>${['Holdings', 'Invested', 'Market value', 'Total gain', 'XIRR', ...indices.map(id => BENCHMARKS[id][0])].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
    <tbody>${groups.map(([name, list]) => `<tr><th scope="row">${A.esc(name)}</th>${line(list, !noIndex.includes(name))}</tr>`).join('')}</tbody>
    ${groups.length > 1 ? `<tfoot><tr><th scope="row">Total</th>${line(all, !noIndex.length)}</tr></tfoot>` : ''}
  </table></div></section>`;
}

function performanceReport() {
  const brokers = reportBrokers();
  const rows = brokers.flatMap(({ account, c, rate }) => c.lines.flatMap(l => {
    const type = perfType(account, l);
    return type ? [{ ...(rate === 1 ? l : inRupees(l, rate)), type, account }] : [];
  }));
  perfCharts.length = 0;
  const key = perfGroup();
  const filters = reportFilters(null, `<label for="r-perf">Group by</label><select class="select" id="r-perf">${Object.entries(PERF_GROUPS).map(([k, label]) => `<option value="${k}"${k === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`);
  if (!rows.length) return `${filters}<div class="empty">${icon('chart')}<p>Nothing to compare for this selection.</p></div>`;
  const byType = (...types) => types.map(t => [t, rows.filter(l => l.type === t)]).filter(([, list]) => list.length);
  const bands = list => orderBands(key, new Set(list.map(l => bandOf(key, l)))).map(b => [b, list.filter(l => bandOf(key, l) === b)]);
  const shareLike = l => l.group === 'Stocks' || l.group === 'ETFs';
  const indian = rows.filter(l => l.type === 'Indian stocks');
  const american = rows.filter(l => l.type.startsWith('US') && (key === 'type' || shareLike(l)));
  const growthNote = name => `${name}: each index starts from your value on the period's first month, then takes the same money in and out as you did. Prices are monthly, so 1M runs from the last month-end.${showMarketHistory() ? '' : ' Turn on Past market value in the Timeline report to plot your value month by month.'}`;
  const india = perfGrowth(indian, INDIA_INDICES, brokers);
  const us = perfGrowth(american, US_INDICES, brokers);
  const tables = key === 'type'
    ? [perfTable('India', byType('Indian stocks', 'Debt', 'Mutual funds'), INDIA_INDICES, ['Debt'], india, growthNote('Indian stocks')), perfTable('US', byType('US stocks', 'US MF'), US_INDICES, [], us, growthNote('US stocks and funds'))]
    : [perfTable('Indian stocks', bands(indian), INDIA_INDICES, [], india, growthNote('Indian stocks')), perfTable('US stocks', bands(american), US_INDICES, [], us, growthNote('US stocks and ETFs'))];
  const s = summarizeAll(rows);
  return `${filters}
    <div class="stats">
      ${stat(`Value covered${info('performance')}`, money(s.value), 'Commodities and crypto left out')}
      ${stat('Invested', money(s.cost), s.unpriced ? `${s.unpriced} unpriced left out` : '')}
      ${stat('Total gain', money(s.gain, true), pct(s.gainPct), tone(s.gain))}
      ${stat(`XIRR${info('xirr')}`, pct(s.xirr), 'Annual return, all time', tone(s.xirr))}
    </div>
    <div class="status" id="pf-status">${statusLine()}</div>
    ${tables.join('')}
    ${performersPanel(rows)}
    <p class="muted small chart-note">Each index column shows the annual return if the same money had gone in and out of that index on the same dates. Indices leave out dividends, and US indices are in dollars, so they leave out rupee moves.</p>`;
}

/* ---------- metrics ---------- */

const CAP_PE_INDICES = { 'Large cap': ['nifty50', 'next50'], 'Mid cap': ['mid150'], 'Small cap': ['small250'], 'Micro cap': ['micro250'] };
const CAP_RETURN_INDEX = { 'Large cap': 'nifty50', 'Mid cap': 'mid150', 'Small cap': 'small250', 'Micro cap': 'small250' };
const VOL_INDICES = ['nifty50', 'next50', 'mid150', 'small250', 'nifty500'];
const VOL_PERIODS = [[12, '1Y'], [36, '3Y'], [60, '5Y']];

const indexFigures = id => A.S.market.find(m => m.symbol === benchmarkKey(id))?.f;

// A holding's share of earnings, so a loss-maker counts against the total.
function earningsOf(l) {
  if (l.eps != null && l.price) return l.value * l.eps / l.price;
  return l.pe > 0 ? l.value / l.pe : null;
}

// Total value over total earnings, the P/E of the holdings taken as one company.
function weightedPe(list) {
  const known = list.filter(l => earningsOf(l) != null);
  const earnings = known.reduce((n, l) => n + earningsOf(l), 0);
  return earnings > 0 ? known.reduce((n, l) => n + l.value, 0) / earnings : null;
}

const medianPe = list => {
  const known = list.map(l => l.pe).filter(v => v > 0).sort((a, b) => a - b);
  return known.length ? known[Math.floor(known.length / 2)] : null;
};

function peTable(bands, merged) {
  const total = merged.reduce((n, l) => n + l.value, 0);
  const row = (label, list, indices, cls = '') => indices.map((id, i) => {
    const yours = weightedPe(list), theirs = indexFigures(id)?.pe;
    const gap = yours != null && theirs ? (yours / theirs - 1) * 100 : null;
    return `<tr class="${cls}"><th scope="row">${i ? '' : label}</th>
      <td class="num">${i ? '' : list.length}</td>
      <td class="num">${i ? '' : money(list.reduce((n, l) => n + l.value, 0))}</td>
      <td class="num">${i ? '' : plainPct(total ? list.reduce((n, l) => n + l.value, 0) / total * 100 : null)}</td>
      <td class="num">${i ? '' : ratio(yours)}</td>
      <td class="num">${i ? '' : ratio(medianPe(list))}</td>
      <td>${NSE_INDICES[id]}</td><td class="num">${ratio(theirs)}</td>
      <td class="num">${gap == null ? '–' : `${Math.abs(gap).toFixed(1)}% ${gap >= 0 ? 'above' : 'below'}`}</td></tr>`;
  }).join('');
  return `<div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>Market cap</th><th class="num">Stocks</th><th class="num">Market value</th><th class="num">Share</th><th class="num">Your P/E</th><th class="num">Middle stock's P/E</th><th>Index</th><th class="num">Index P/E</th><th class="num">You against index</th></tr></thead>
    <tbody>${bands.map(([name, list]) => row(name, list, CAP_PE_INDICES[name] ?? ['nifty500'])).join('')}</tbody>
    <tfoot>${row('All Indian stocks', merged, ['nifty500'])}</tfoot>
  </table></div>`;
}

const annualVol = returns => {
  if (returns.length < 6) return null;
  const mean = returns.reduce((n, r) => n + r, 0) / returns.length;
  return Math.sqrt(returns.reduce((n, r) => n + (r - mean) ** 2, 0) / (returns.length - 1) * 12) * 100;
};

// Monthly moves, open to close, of what was held at each month's start, so new
// money doesn't look like volatility. The month in progress is left out.
function volatilityTable(brokers, indian) {
  if (!showMarketHistory()) {
    return `<p class="muted small chart-note">This needs monthly prices for your holdings.</p>
      ${dataMode() === 'backup' ? '' : `<button class="btn sm" id="r-load-history">${icon('download')}<span>Load monthly prices</span></button>`}`;
  }
  const keys = [];
  const now = monthKey(new Date().toISOString());
  for (let k = monthKey(new Date(Date.now() - 66 * 30.5 * 864e5).toISOString()); k < now; k = nextMonth(k)) keys.push(k);
  const { values } = monthlyValues(brokers, keys, new Set(indian.map(l => `${l.account.id}:${l.symbol}`)));
  const recent = (list, n) => list.slice(-n);
  const yours = keys.map(k => values.get(k)).filter(v => v.open > 0).map(v => v.heldClose / v.open - 1);
  const line = (label, returns, bold) => `<tr><th scope="row">${label}</th>${VOL_PERIODS.map(([n]) => {
    const v = returns.length >= n * 0.9 ? annualVol(recent(returns, n)) : null;
    return `<td class="num">${bold ? `<strong>${plainPct(v)}</strong>` : plainPct(v)}</td>`;
  }).join('')}</tr>`;
  const indexRow = id => {
    const months = A.S.priceMonths.find(m => m.symbol === benchmarkKey(id))?.months ?? {};
    return line(NSE_INDICES[id], keys.filter(k => months[k]).map(k => months[k][1] / months[k][0] - 1));
  };
  return `<div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>Annualized volatility</th>${VOL_PERIODS.map(([, label]) => `<th class="num">${label}</th>`).join('')}</tr></thead>
    <tbody>${line('Your Indian stocks', yours, true)}${VOL_INDICES.map(indexRow).join('')}</tbody>
  </table></div>`;
}

// The index's P/E when each lot still held was bought, weighted by its cost like
// the P/E of a portfolio: total cost over total earnings at those dates.
function peAtPurchase(lots, id) {
  const months = A.S.priceMonths.find(m => m.symbol === peKey(id))?.months ?? {};
  const keys = Object.keys(months).sort();
  let cost = 0, earnings = 0, total = 0;
  for (const lot of lots) {
    const paid = lot.qty * lot.price;
    const key = lot.date.slice(0, 7);
    const at = months[key] ?? months[keys.filter(k => k < key).at(-1)];
    total += paid;
    if (at?.[0] > 0) {
      cost += paid;
      earnings += paid / at[0];
    }
  }
  return { pe: earnings ? cost / earnings : null, covered: total ? cost / total * 100 : 0 };
}

const lotsOf = list => list.flatMap(l => l.parts.flatMap(p => (computed(p.account).positions.get(p.symbol)?.lots ?? []).map(lot => ({ ...lot, symbol: p.symbol }))));

// What was paid over the earnings bought, each lot at the EPS of the last financial
// year ended before it. Lot prices and EPS are both in today's share units.
function stockPeAtPurchase(lots) {
  let cost = 0, earnings = 0, total = 0;
  for (const lot of lots) {
    const paid = lot.qty * lot.price;
    const years = A.S.priceMonths.find(m => m.symbol === epsKey(lot.symbol))?.months ?? {};
    const year = Object.keys(years).sort().filter(k => k < lot.date.slice(0, 7)).at(-1);
    total += paid;
    if (year) {
      cost += paid;
      earnings += lot.qty * years[year][0];
    }
  }
  return { pe: earnings > 0 ? cost / earnings : null, loss: cost > 0 && earnings <= 0, covered: total ? cost / total * 100 : 0 };
}

const coveredNote = covered => (covered < 99 ? `<small>Covers ${covered.toFixed(0)}% of cost</small>` : '');

function entryTable(bands, merged) {
  const row = (label, list, indices) => indices.map((id, i) => {
    const lots = lotsOf(list);
    const { pe, covered } = peAtPurchase(lots, id);
    const yours = stockPeAtPurchase(lots);
    return `<tr><th scope="row">${i ? '' : label}</th>
      <td class="num">${i ? '' : money(lots.reduce((n, l) => n + l.qty * l.price, 0))}</td>
      <td class="num">${i ? '' : `${yours.loss ? 'Loss' : ratio(yours.pe)}${coveredNote(yours.covered)}`}</td>
      <td class="num">${i ? '' : ratio(weightedPe(list))}</td>
      <td>${NSE_INDICES[id]}</td>
      <td class="num">${ratio(pe)}${pe ? coveredNote(covered) : ''}</td>
      <td class="num">${ratio(indexFigures(id)?.pe)}</td></tr>`;
  }).join('');
  return `<div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>Market cap</th><th class="num">Cost of holdings</th><th class="num">Your P/E when you bought</th><th class="num">Your P/E today</th><th>Index</th><th class="num">Index P/E when you bought</th><th class="num">Index P/E today</th></tr></thead>
    <tbody>${bands.map(([name, list]) => row(name, list, CAP_PE_INDICES[name] ?? ['nifty500'])).join('')}</tbody>
    <tfoot>${row('All Indian stocks', merged, ['nifty50', 'nifty500'])}</tfoot>
  </table></div>`;
}

function entryStocks(merged) {
  const rows = merged.map(l => {
    const lots = lotsOf([l]);
    const paid = lots.reduce((n, x) => n + x.qty * x.price, 0);
    const first = lots.reduce((d, x) => (x.date < d ? x.date : d), '9999');
    return { ...l, paid, first, entry: stockPeAtPurchase(lots) };
  }).sort((a, b) => b.paid - a.paid);
  return `<div class="holdings-wrap"><table class="holdings pf-summary">
    <thead><tr><th>Ticker</th><th>Stock name</th><th class="num">Cost of holdings</th><th class="num">First bought</th><th class="num">P/E when you bought</th><th class="num">P/E today</th></tr></thead>
    <tbody>${rows.map(l => `<tr>
      <th scope="row"><a href="${accountPath(l.holders[0].id)}/h/${encodeURIComponent(l.symbol)}">${A.esc(l.symbol)}</a></th>
      <td class="pf-name" title="${A.esc(l.name)}">${A.esc(l.name) || '–'}</td>
      <td class="num">${money(l.paid)}</td>
      <td class="num">${l.first === '9999' ? '–' : day(l.first)}</td>
      <td class="num">${l.entry.loss ? 'Loss' : ratio(l.entry.pe)}${coveredNote(l.entry.covered)}</td>
      <td class="num">${l.pe > 0 ? ratio(l.pe) : l.eps < 0 ? 'Loss' : '–'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function metricsReport() {
  peWanted = true;
  const brokers = reportBrokers();
  const filters = reportFilters(null);
  const indian = brokers.flatMap(({ account, c }) => (isUsd(account) ? [] : c.lines.filter(l => l.group === 'Stocks' && perfType(account, l) === 'Indian stocks').map(l => ({ ...l, account }))));
  const groups = heldByTicker(indian);
  if (!groups.length) return `${filters}<div class="empty">${icon('chart')}<p>No Indian stocks for this selection.</p></div>`;
  const merged = groups.map(list => ({ ...mergeLines(list), parts: list.map(x => x.line) }));
  const bands = orderBands('cap', new Set(merged.map(l => bandOf('cap', l)))).map(b => [b, merged.filter(l => bandOf('cap', l) === b)]);
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const scored = merged.map(l => {
    const start = l.parts.flatMap(p => p.flows ?? []).reduce((d, f) => (f.date < d ? f.date : d), today);
    const id = CAP_RETURN_INDEX[bandOf('cap', l)] ?? 'nifty500';
    const theirs = start <= yearAgo ? benchmarkXirr(l.parts, id) : null;
    return { ...l, start, id, theirs, alpha: l.xirr != null && theirs != null ? l.xirr - theirs : null };
  });
  const rated = scored.filter(l => l.alpha != null);
  const winners = rated.filter(l => l.alpha > 0).sort((a, b) => b.alpha - a.alpha);
  const yours = weightedPe(merged), asOf = indexFigures('nifty50')?.asOf;
  // A P/E this low usually comes from a one-off gain, and it can sway a whole band.
  const odd = merged.filter(l => l.pe > 0 && l.pe < 3);
  const without = weightedPe(merged.filter(l => !odd.includes(l)));
  const allLots = lotsOf(merged);
  const entry = peAtPurchase(allLots, 'nifty50');
  const yourEntry = stockPeAtPurchase(allLots);
  return `${filters}
    <div class="stats five">
      ${stat(`Your P/E${info('metrics')}`, ratio(yours), `${A.plural(merged.length, 'stock')}, weighted by value`)}
      ${stat('Your P/E when you bought', ratio(yourEntry.pe), yourEntry.pe ? 'Weighted by what you paid' : 'Press Refresh on the Overview')}
      ${stat('Nifty 50 P/E', ratio(indexFigures('nifty50')?.pe), asOf ? `NSE, ${asOf}` : 'Not loaded yet')}
      ${stat('Nifty 50 P/E when you bought', ratio(entry.pe), entry.pe ? 'Weighted by what you paid' : 'Not loaded yet')}
      ${stat('Stocks with alpha', `${winners.length} of ${rated.length}`, 'Beat their index, held a year or more')}
    </div>
    <div class="status" id="pf-status">${statusLine()}</div>
    <section class="panel"><h2>P/E by market cap${info('metrics')}</h2>
      <p class="muted small chart-note">Your P/E is total value over total earnings for that band, so bigger holdings count for more and loss-makers lower the earnings. Index figures are from NSE's closing file${asOf ? ` of ${asOf}` : ''}.</p>
      ${odd.length ? `<p class="muted small chart-note">${odd.map(l => `${A.esc(l.symbol)} (${ratio(l.pe)})`).join(', ')} ${odd.length === 1 ? 'has' : 'have'} a P/E under 3, usually from a one-off gain. Without ${odd.length === 1 ? 'it' : 'them'}, your overall P/E is ${ratio(without)}.</p>` : ''}
      ${peTable(bands, merged)}
    </section>
    <section class="panel"><h2>P/E when you bought${info('metrics')}</h2>
      <p class="muted small chart-note">For the shares you hold today. Your P/E is what you paid over those shares' earnings for the last financial year before each purchase. The index is at its P/E at the end of the month you bought, weighted by what you paid. A P/E lower today means prices fell or earnings grew faster.</p>
      ${entryTable(bands, merged)}
      <details class="pf-details"><summary>Stock by stock</summary>${entryStocks(merged)}</details>
    </section>
    <section class="panel"><h2>Volatility${info('metrics')}</h2>
      <p class="muted small chart-note">How much monthly returns swing, as a yearly figure. Lower is steadier.</p>
      ${volatilityTable(brokers, indian)}
    </section>
    <section class="panel"><h2>Stocks with alpha${info('metrics')}</h2>
      <p class="muted small chart-note">Your XIRR on each stock less what the same money made in the index for its market cap. ${A.plural(merged.length - scored.filter(l => l.start <= yearAgo).length, 'stock')} held under a year left out, as short holdings annualize wildly.</p>
      ${winners.length ? `<div class="holdings-wrap"><table class="holdings pf-summary">
        <thead><tr><th>Ticker</th><th>Stock name</th><th>Market cap</th><th class="num">Held since</th><th class="num">Your XIRR</th><th>Index</th><th class="num">Index XIRR</th><th class="num">Alpha</th></tr></thead>
        <tbody>${winners.map(l => `<tr>
          <th scope="row"><a href="${accountPath(l.holders[0].id)}/h/${encodeURIComponent(l.symbol)}">${A.esc(l.symbol)}</a></th>
          <td class="pf-name" title="${A.esc(l.name)}">${A.esc(l.name) || '–'}</td>
          <td>${A.esc(bandOf('cap', l))}</td>
          <td class="num">${day(l.start)}</td>
          <td class="num ${tone(l.xirr)}">${pct(l.xirr)}</td>
          <td>${NSE_INDICES[l.id]}</td>
          <td class="num">${pct(l.theirs)}</td>
          <td class="num ${tone(l.alpha)}">${pct(l.alpha)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="muted small">No stocks beat their index yet${rated.length ? '' : ', or the index history hasn\'t loaded'}.</p>`}
    </section>`;
}

/* ---------- ratings ---------- */

// Colour runs from good to bad, and every icon sits beside its words.
const levelClass = rating => {
  const place = rating.step / (rating.count - 1);
  return place === 0 ? 'best' : place <= 0.25 ? 'good' : place < 0.75 ? 'mid' : place < 1 ? 'poor' : 'worst';
};

const svgIcon = body => `<svg class="rt-icon" viewBox="0 0 34 18" aria-hidden="true">${body}</svg>`;
const GROWTH_CURVES = {
  Exponential: 'M2 16C16 16 24 12 32 2', Linear: 'M2 16L32 2', Flat: 'M2 9H32',
  'Degrowth linear': 'M2 2L32 16', 'Degrowth exponential': 'M2 2C16 2 24 6 32 16',
};

const VERDICT_MARKS = { 'Must Buy': 'M12 9L17 4L22 9M12 14L17 9L22 14', Buy: 'M12 11.5L17 6.5L22 11.5', Hold: 'M12 7H22M12 11H22', Sell: 'M12 6.5L17 11.5L22 6.5', 'Must Sell': 'M12 4L17 9L22 4M12 9L17 14L22 9' };

const RATING_ICONS = {
  // A badge with arrows: two for the strongest calls, and bars to hold.
  verdict: r => svgIcon(`<circle class="rt-fill" cx="17" cy="9" r="8.5"/><path class="rt-mark" d="${VERDICT_MARKS[r.label]}"/>`),
  // A rail from low to high, with a marker where the price sits.
  momentum: r => {
    const at = 3 + (r.rank - 1) * 7;
    return svgIcon(`<line class="rt-rail" x1="3" x2="31" y1="9" y2="9"/>${[3, 10, 17, 24, 31].map(x => `<line class="rt-rail" x1="${x}" x2="${x}" y1="6" y2="12"/>`).join('')}<circle class="rt-fill" cx="${at}" cy="9" r="4.5"/>`);
  },
  // The shape of the growth itself.
  growth: r => {
    const path = GROWTH_CURVES[r.label];
    const end = path.split(/[ LHCM]/).filter(Boolean).slice(-2).map(Number);
    return svgIcon(`<path class="rt-line" d="${path}"/><circle class="rt-fill" cx="32" cy="${r.label === 'Flat' ? 9 : end[1]}" r="2"/>`);
  },
  // Three blocks, cheap to dear, with the matching one lit.
  valuation: r => svgIcon([0, 1, 2].map(i => `<rect class="${i === r.step ? 'rt-fill' : 'rt-off'}" x="${1 + i * 11}" y="5" width="10" height="8" rx="2"/>`).join('')),
  // Signal bars, or a flame when cash is going out.
  profitability: r => (r.label === 'Burning cash'
    ? svgIcon('<path class="rt-fill" d="M17 1C18 6 24 8 24 12.5A7 5 0 0 1 10 12.5C10 9.5 12 8.5 13 6C14 7.5 15 8 16 8C17 6 17 3.5 17 1Z"/>')
    : svgIcon([0, 1, 2, 3].map(i => `<rect class="${i < 4 - r.step ? 'rt-fill' : 'rt-off'}" x="${3 + i * 7}" y="${13 - i * 4}" width="5" height="${4 + i * 4}" rx="1"/>`).join(''))),
};

const ratingChip = (scale, r) => (r
  ? `<span class="rt rt-${levelClass(r)}" title="${A.esc(RATING_SCALES[scale].rule)}">${RATING_ICONS[scale](r)}<span class="rt-text"><b>${A.esc(r.label)}</b><small>${A.esc(r.note)}</small></span></span>`
  : '<span class="muted small">Not rated</span>');

const RATE_COLUMNS = [
  ['symbol', 'Ticker'], ['verdict', 'Verdict'], ['value', 'Market value'], ['perf1w', '1W'], ['perf1m', '1M'], ['perf3m', '3M'], ['perf6m', '6M'], ['perf1y', '1Y'], ['perf5y', '5Y'],
  ...Object.entries(RATING_SCALES).filter(([k]) => k !== 'verdict').map(([k, s]) => [k, s.label]),
];
const RETURN_KEYS = ['perf1w', 'perf1m', 'perf3m', 'perf6m', 'perf1y', 'perf5y'];
const rateSort = { key: 'value', dir: -1 };
const rateFilter = {};
const NOT_RATED = 'Not rated';
const returnsHidden = () => A.ls.get('pfRateHideReturns', false);
const ratingName = (l, scale) => l[scale]?.label ?? NOT_RATED;

// One dropdown a rating, with how many stocks each choice has among your stocks.
function ratingFilters(list) {
  return `<div class="pf-sort pf-filters rt-filters">
    ${Object.entries(RATING_SCALES).map(([k, s]) => {
      const choices = [...s.levels, NOT_RATED].map(level => [level, list.filter(l => ratingName(l, k) === level).length]).filter(([level, n]) => n || level === rateFilter[k]);
      return `<label><span>${s.label}</span><select class="select" data-rate-filter="${k}"><option value="">All</option>${choices.map(([level, n]) => `<option value="${level}"${level === rateFilter[k] ? ' selected' : ''}>${level} (${n})</option>`).join('')}</select></label>`;
    }).join('')}
    ${Object.values(rateFilter).some(Boolean) ? '<button class="btn sm" id="r-rate-clear">Clear filters</button>' : ''}
  </div>`;
}

function ratingLegend(scale, list) {
  const { label, levels, rule } = RATING_SCALES[scale];
  return `<div class="rt-scale"><h3>${label}</h3>
    ${levels.map((level, step) => {
      const r = { label: level, note: '', rank: levels.length - step, step, count: levels.length };
      return `<div class="rt-key rt-${levelClass(r)}">${RATING_ICONS[scale](r)}<span>${level}</span><b>${list.filter(l => l[scale]?.label === level).length}</b></div>`;
    }).join('')}
    <p class="muted small">${A.esc(rule)}</p>
  </div>`;
}

function ratingReport() {
  const brokers = reportBrokers();
  const filters = reportFilters(null, `<label class="switch pf-detail"><input type="checkbox" id="r-hide-returns"${returnsHidden() ? ' checked' : ''}><span>Hide returns</span></label>`);
  const indian = brokers.flatMap(({ account, c }) => (isUsd(account) ? [] : c.lines.filter(l => l.group === 'Stocks' && perfType(account, l) === 'Indian stocks').map(l => ({ ...l, account }))));
  const sectors = A.S.market.find(m => m.symbol === SECTOR_PE_KEY)?.f ?? {};
  const list = heldByTicker(indian).map(mergeLines).map(l => {
    const ratings = { momentum: momentumRating(l), growth: growthRating(l), valuation: valuationRating(l, sectors[l.sector]), profitability: profitabilityRating(l) };
    return { ...l, ...ratings, verdict: verdictRating(ratings) };
  });
  if (!list.length) return `${filters}<div class="empty">${icon('chart')}<p>No Indian stocks for this selection.</p></div>`;
  const sortValue = (l, key) => (RATING_SCALES[key] ? l[key]?.rank ?? -1 : l[key] ?? -Infinity);
  const hide = returnsHidden();
  if (hide && RETURN_KEYS.includes(rateSort.key)) Object.assign(rateSort, { key: 'value', dir: -1 });
  const shownColumns = RATE_COLUMNS.filter(([key]) => !hide || !RETURN_KEYS.includes(key));
  const matching = list.filter(l => Object.entries(rateFilter).every(([k, want]) => !want || ratingName(l, k) === want));
  const rows = [...matching].sort((a, b) => (rateSort.key === 'symbol' ? a.symbol.localeCompare(b.symbol) : sortValue(a, rateSort.key) - sortValue(b, rateSort.key)) * rateSort.dir);
  const head = ([key, label]) => {
    const on = rateSort.key === key;
    return `<th${key === 'symbol' || RATING_SCALES[key] ? '' : ' class="num"'} aria-sort="${on ? (rateSort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><span class="pf-th"><button data-sort="${key}" data-rate="${key}">${label}${on ? (rateSort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></span></th>`;
  };
  const stale = !list.some(l => l.allHigh != null) || !Object.keys(sectors).length;
  return `${filters}
    <div class="period"><div class="status" id="pf-status">${statusLine()}</div><button class="btn sm" data-act="pf-refresh">${icon('restore')}<span>Refresh</span></button></div>
    ${stale ? `<p class="muted small chart-note">Press Refresh to load the figures behind these ratings.</p>` : ''}
    <section class="panel"><h2>What the ratings mean${info('ratings')}</h2>
      <div class="rt-scales">${Object.keys(RATING_SCALES).map(k => ratingLegend(k, list)).join('')}</div>
    </section>
    <section class="panel"><h2>Your Indian stocks (${rows.length === list.length ? list.length : `${rows.length} of ${list.length}`})</h2>
      ${ratingFilters(list)}
      <p class="muted small chart-note">Returns are each stock's own price change, not your purchase. Verdicts and ratings are a fixed formula on public figures. They aren't investment advice, and they don't know your goals, tax or what you paid. Hover over a rating for its rule.</p>
      ${rows.length ? '' : '<p class="muted small">No stocks match these filters.</p>'}
      <div class="holdings-wrap"${rows.length ? '' : ' hidden'}><table class="holdings rt-table">
        <thead><tr>${shownColumns.map(head).join('')}</tr></thead>
        <tbody>${rows.map(l => `<tr>
          <th scope="row"><a href="${accountPath(l.holders[0].id)}/h/${encodeURIComponent(l.symbol)}" title="${A.esc(l.name)}">${A.esc(l.symbol)}</a></th>
          <td>${ratingChip('verdict', l.verdict)}</td>
          <td class="num">${money(l.value)}</td>
          ${hide ? '' : RETURN_KEYS.map(k => `<td class="num ${tone(l[k])}">${pct(l[k])}</td>`).join('')}
          ${Object.keys(RATING_SCALES).filter(k => k !== 'verdict').map(k => `<td>${ratingChip(k, l[k])}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
}

function reportsView(r) {
  const tab = REPORTS[r.tab] ? r.tab : 'dividends';
  const body = tab === 'gains' ? gainsReport() : tab === 'earn' ? earnReport() : tab === 'fees' ? feesReport() : tab === 'timeline' ? timelineReport() : tab === 'performance' ? performanceReport() : tab === 'metrics' ? metricsReport() : tab === 'rating' ? ratingReport() : dividendReport();
  A.view.innerHTML = `
    ${hero('Reports', REPORTS[tab], HOME)}
    <div class="seg tabs" role="group" aria-label="Report">
      ${Object.entries(REPORTS).map(([k, label]) => `<a href="${HOME}/reports/${k}"${k === tab ? ' aria-current="page"' : ''}><span>${label}</span></a>`).join('')}
    </div>
    <div class="scroll"><div class="pay-page pf-page">${body}</div></div>`;
  // A long chart opens on the latest months.
  const bars = A.$('.months.long');
  if (bars) bars.scrollLeft = bars.scrollWidth;
  if (tab === 'metrics') refreshPeHistory();
  const chart = A.$('#pf-growth');
  if (chart) {
    drawGrowth();
    new ResizeObserver(drawGrowth).observe(chart);
  }
  A.view.querySelectorAll('.pf-chart').forEach(box => {
    drawChart(box);
    new ResizeObserver(() => drawChart(box)).observe(box);
  });
  const inPlace = change => {
    const top = A.$('.scroll').scrollTop;
    change();
    reportsView(r);
    A.$('.scroll').scrollTop = top;
  };
  A.view.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', () => inPlace(() => {
    const key = b.dataset.rate;
    rateSort.dir = rateSort.key === key ? -rateSort.dir : key === 'symbol' ? 1 : -1;
    rateSort.key = key;
  })));
  A.view.querySelectorAll('[data-rate-filter]').forEach(s => s.addEventListener('change', () => inPlace(() => { rateFilter[s.dataset.rateFilter] = s.value; })));
  A.$('#r-rate-clear')?.addEventListener('click', () => inPlace(() => Object.keys(rateFilter).forEach(k => delete rateFilter[k])));
  A.$('#r-hide-returns')?.addEventListener('change', e => inPlace(() => A.ls.set('pfRateHideReturns', e.target.checked)));
  A.$('#r-load-history')?.addEventListener('click', () => { A.ls.set('pfTimelineMarket', true); reportsView(r); refreshMonthly(); });
  A.view.querySelectorAll('[data-top]').forEach(b => b.addEventListener('click', () => {
    const top = A.$('.scroll').scrollTop;
    A.ls.set('pfPerfTop', Number(b.dataset.top));
    reportsView(r);
    A.$('.scroll').scrollTop = top;
  }));
  A.view.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    A.ls.set('pfPerfRange', b.dataset.range);
    A.view.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', x.dataset.range === b.dataset.range));
    A.view.querySelectorAll('.pf-chart').forEach(drawChart);
  }));
  A.$('#r-broker').addEventListener('change', e => { R.broker = e.target.value; reportsView(r); });
  A.$('#r-year')?.addEventListener('change', e => { R.year = e.target.value; reportsView(r); });
  A.$('#r-detail')?.addEventListener('change', e => { A.ls.set('pfReportDetail', e.target.checked); reportsView(r); });
  A.$('#r-perf')?.addEventListener('change', e => { A.ls.set('pfPerfGroup', e.target.value); reportsView(r); });
  A.$('#r-payers')?.addEventListener('change', e => { A.ls.set('pfPayersOnly', e.target.checked); reportsView(r); });
  A.$('#r-market')?.addEventListener('change', e => { A.ls.set('pfTimelineMarket', e.target.checked); reportsView(r); refreshMonthly(); });
}

/* ---------- data sources ---------- */

const DATA_MODES = {
  internet: ['Internet', 'Prices, dividends, splits and history all download from the public sources.'],
  backup: ['Local backup', 'Nothing is downloaded. Everything comes from public data files you imported, and stops at their date.'],
  hybrid: ['Hybrid', 'Recent months and today\'s prices download. Older months come from your backup, so far less is fetched.'],
};

function dataView() {
  const rows = publicSummary(A.S.market, A.S.priceMonths);
  const mode = dataMode();
  const months = key => (key ? monthText(key, { month: 'short', year: 'numeric' }) : '–');
  const empty = !rows.some(x => x.symbols || x.withHistory);
  A.view.innerHTML = `${hero('Data sources', DATA_MODES[mode][0], HOME)}
    <div class="scroll"><div class="pay-page pf-page">
      <section class="panel">
        <h2>Where public data comes from${info('publicData')}</h2>
        <div class="pf-modes" role="radiogroup" aria-label="Public data source">
          ${Object.entries(DATA_MODES).map(([k, [label, text]]) => `<label class="pf-mode"><input type="radio" name="pf-mode" value="${k}"${k === mode ? ' checked' : ''}><span><strong>${label}</strong><small>${text}</small></span></label>`).join('')}
        </div>
        ${mode === 'hybrid' ? `<div class="pf-sort"><label for="pf-recent">Use the internet for the last</label>
          <select class="select" id="pf-recent">${[3, 6, 12, 24].map(n => `<option value="${n}"${n === recentMonths() ? ' selected' : ''}>${n} months</option>`).join('')}</select></div>` : ''}
        ${mode !== 'internet' && empty ? `<div class="status">${icon('alert')}<span>There's no public data on this device yet. Import a backup below.</span></div>` : ''}
      </section>
      <section class="panel">
        <h2>Public data on this device</h2>
        <div class="holdings-wrap"><table class="holdings pf-summary">
          <thead><tr><th>Market</th><th class="num">Tickers</th><th class="num">With monthly prices</th><th class="num">Month files</th><th class="num">From</th><th class="num">To</th><th class="num">Latest price</th></tr></thead>
          <tbody>${rows.map(x => `<tr><th scope="row">${x.label}</th><td class="num">${x.symbols}</td><td class="num">${x.withHistory}</td><td class="num">${x.files}</td><td class="num">${months(x.first)}</td><td class="num">${months(x.last)}</td><td class="num">${x.quotedAt ? A.relDate(x.quotedAt) : '–'}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel">
        <h2>Back up and restore</h2>
        <p class="muted small chart-note">One folder a market and one file a month, in a new dated folder each time. Files hold public prices and tickers only, with no quantities or amounts, though the tickers do show what you've held.${A.ls.get('pfPublicBackupAt', 0) ? ` Last backed up ${A.relDate(A.ls.get('pfPublicBackupAt', 0))}.` : ''}</p>
        <div class="btn-row">
          <button class="btn sm primary" data-act="pf-public-backup">${icon('download')}<span>Back up public data</span></button>
          <label class="btn sm">${icon('upload')}<span>Import a folder</span><input id="pf-public-folder" type="file" webkitdirectory hidden></label>
          <label class="btn sm">${icon('upload')}<span>Import files or zip</span><input id="pf-public-files" type="file" multiple accept=".json,.zip,application/json,application/zip" hidden></label>
        </div>
      </section>
      <section class="panel">
        <h2>Backup files and their sources</h2>
        <p class="muted small chart-note">Each file also names its sources inside it, and manifest.json lists them all.</p>
        <div class="holdings-wrap"><table class="holdings lots pf-disclosure">
          <thead><tr><th>File</th><th>Holds</th><th>Source</th></tr></thead>
          <tbody>${BACKUP_FILES.map(f => f.parts.map(([what, id], i) => {
            const s = SOURCES[id];
            return `<tr>${i ? '' : `<td rowspan="${f.parts.length}"><strong>${f.label}</strong><br><code>${f.id}/YYYY-MM.json</code></td>`}<td>${A.esc(what)}</td><td>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${A.esc(s.name)}</a>` : A.esc(s.name)}</td></tr>`;
          }).join('')).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel">
        <h2>What a backup contains</h2>
        <p class="muted small chart-note">Latest only means one snapshot, in the file for the month it was fetched, so past values aren't kept. In Local backup mode these figures stay as they stood on the backup date.</p>
        <div class="holdings-wrap"><table class="holdings lots pf-disclosure">
          <thead><tr><th>Data</th><th>Kept</th><th>Field in the file</th></tr></thead>
          <tbody>${BACKUP_CONTENTS.map(([what, kept, field]) => `<tr><td>${A.esc(what)}</td><td>${A.esc(kept)}</td><td><code>${A.esc(field)}</code></td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel">
        <h2>Not in a backup</h2>
        <ul class="pf-notes">${BACKUP_LEAVES_OUT.map(t => `<li>${A.esc(t)}</li>`).join('')}</ul>
        <p class="muted small chart-note">${A.esc(BACKUP_NEEDS_NOTHING)}</p>
      </section>
    </div></div>`;
  A.view.querySelectorAll('[name=pf-mode]').forEach(b => b.addEventListener('change', () => {
    A.ls.set('pfDataSource', b.value);
    setOffline(b.value === 'backup');
    dataView();
    A.refresh();
    if (b.value !== 'backup') refreshMarket();
  }));
  A.$('#pf-recent')?.addEventListener('change', e => A.ls.set('pfDataRecent', Number(e.target.value)));
  for (const id of ['#pf-public-folder', '#pf-public-files']) {
    A.$(id).addEventListener('change', e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (files.length) importPublic(files);
    });
  }
}

// A new dated folder each time, so no backup replaces an earlier one.
async function freshFolder(root, base) {
  for (let v = 1; ; v++) {
    const name = v === 1 ? base : `${base}-v${v}`;
    const taken = await root.getDirectoryHandle(name).then(() => true, () => false);
    if (!taken) return root.getDirectoryHandle(name, { create: true });
  }
}

async function backupPublic() {
  const stamp = new Date().toISOString();
  const files = publicFiles(A.S.market, A.S.priceMonths, stamp);
  const base = `superapp-public-data-${stamp.slice(0, 10)}`;
  const saved = text => {
    A.ls.set('pfPublicBackupAt', Date.now());
    A.toast(text);
    if (A.S.route?.page === 'data') dataView();
  };
  if (!window.showDirectoryPicker) {
    A.downloadFile(new File([zipFiles(files, base)], `${base}.zip`, { type: 'application/zip' }));
    return saved(`Saved ${A.plural(files.length - 1, 'month file')} as a zip`);
  }
  let root;
  try {
    root = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return;
  }
  const folder = await freshFolder(root, base);
  for (const { path, text } of files) {
    const parts = path.split('/');
    const dir = parts.length > 1 ? await folder.getDirectoryHandle(parts[0], { create: true }) : folder;
    const writer = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await writer.write(text);
    await writer.close();
  }
  saved(`Saved ${A.plural(files.length - 1, 'month file')} to ${folder.name}`);
}

async function importPublic(files) {
  try {
    const texts = [];
    for (const f of files) {
      if (f.name.endsWith('.zip')) texts.push(...(await unzipFiles(await f.arrayBuffer())).map(x => x.text));
      else if (f.name.endsWith('.json')) texts.push(await f.text());
    }
    const parsed = texts.flatMap(t => { try { return [JSON.parse(t)]; } catch { return []; } });
    const { used, market, priceMonths } = applyPublicFiles(parsed, A.S.market, A.S.priceMonths);
    if (!used) return A.toast('No public data files found there');
    const clean = market.map(cleanMarket).filter(Boolean);
    const bySymbol = new Map(clean.map(m => [m.symbol, m]));
    A.S.market = [...A.S.market.filter(m => !bySymbol.has(m.symbol)), ...clean];
    const series = new Map(priceMonths.map(m => [m.symbol, m]));
    A.S.priceMonths = [...A.S.priceMonths.filter(m => !series.has(m.symbol)), ...priceMonths];
    await db.putMany('market', clean);
    await db.putMany('priceMonths', priceMonths);
    const latest = Math.max(0, ...clean.map(m => m.quotedAt ?? 0));
    if (latest > A.ls.get('pfQuotedAt', 0)) A.ls.set('pfQuotedAt', latest);
    invalidate();
    A.refresh();
    A.toast(`Imported ${A.plural(used, 'month file')} covering ${A.plural(new Set([...bySymbol.keys(), ...series.keys()]).size, 'ticker')}`);
  } catch (e) {
    A.toast(`Could not import: ${e.message}`);
  }
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
    case 'pf-public-backup': return backupPublic();
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
  else if (r.page === 'data') dataView();
  else if (r.page === 'disclosure') disclosureView();
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
