// Portfolio arithmetic, without any UI. Trades and corporate actions replay in
// date order into FIFO lots, which is how Indian brokers and tax rules match
// sells to buys. Dates are 'YYYY-MM-DD' strings. Quantities and prices are in the
// units current at each point of the replay, so a split rewrites open lots.

import { CORPORATE_ACTIONS, PUBLIC_ISSUES } from './corporate-actions.js';

const EPS = 1e-6;

export const ISSUE_LABEL = { rights: 'Rights issue', ipo: 'IPO allotment', transfer: 'Broker transfer', other: 'Other' };

/* ---------- symbols ---------- */

// Zerodha adds the trading series to some holdings symbols, e.g. GOLDBEES-E.
export const baseSymbol = s => s.replace(/-(E|BL|BE|F|SM|ST|BZ|T)$/, '');

// Trades keep the symbol of their day, so a later rename shows up as a different
// symbol on the same ISIN. The holdings file has today's name for that ISIN.
export function symbolMap(trades, holdings) {
  const byIsin = new Map(holdings.filter(h => h.isin).map(h => [h.isin, baseSymbol(h.symbol)]));
  const map = new Map();
  for (const t of trades) {
    const to = byIsin.get(t.isin);
    if (to && to !== baseSymbol(t.symbol)) map.set(t.symbol, to);
  }
  return map;
}

/* ---------- lots ---------- */

const qtyOf = lots => lots.reduce((n, l) => n + l.qty, 0);
const costOf = lots => lots.reduce((n, l) => n + l.qty * l.price, 0);

// Whole shares only, so a holding rounds down. Brokers keep the full cost through
// a split or bonus, but in a merger the fraction leaves with its share of the
// cost, because it is paid out in cash.
// Each lot remembers how its shares changed: `factor` gives back the shares
// originally bought, and `steps` says why.
function rescale(lots, ratio, keepCost, step) {
  const before = qtyOf(lots);
  if (!before) return lots;
  const target = Math.floor(before * ratio + EPS);
  if (!target) return [];
  const k = target / before;
  return lots.map(l => ({
    ...l, qty: l.qty * k, price: l.price / (keepCost ? k : ratio),
    factor: (l.factor ?? 1) * k, steps: [...(l.steps ?? []), step],
  }));
}

export const originalShares = lot => lot.qty / (lot.factor ?? 1);

function takeFifo(p, want, onTake) {
  let left = want;
  while (left > EPS && p.lots.length) {
    const lot = p.lots[0];
    const take = Math.min(lot.qty, left);
    onTake?.(lot, take);
    lot.qty -= take;
    left -= take;
    if (lot.qty <= EPS) p.lots.shift();
  }
  return left;
}

const newPosition = symbol => ({ symbol, lots: [], realized: [], events: [], unmatched: 0, dividends: 0, dividendEvents: [] });

function positionOf(state, symbol) {
  if (!state.has(symbol)) state.set(symbol, newPosition(symbol));
  return state.get(symbol);
}

/* ---------- replay ---------- */

function applyAction(state, a) {
  const p = positionOf(state, a.symbol);
  const held = qtyOf(p.lots);
  const ratio = a.num && a.den ? `${a.num}:${a.den}` : '';
  const log = (pos, extra) => pos.events.push({ kind: a.type, date: a.date, ratio, note: a.note ?? '', ...extra });

  if (a.type === 'allot') {
    const source = `${ISSUE_LABEL[a.issue]}${a.party ? ` ${a.direction === 'out' ? 'to' : 'from'} ${a.party}` : ''}`;
    if (a.direction === 'out') {
      // A transfer moves shares and their cost away, so only a priced exit is a sale.
      const sold = a.issue === 'other' && a.price > 0;
      takeFifo(p, a.qty, sold ? (lot, take) => p.realized.push({ buyDate: lot.date, sellDate: a.date, qty: take, cost: lot.price, price: a.price }) : null);
      log(p, { qty: -a.qty, price: a.price, source });
      return;
    }
    p.lots.push({ qty: a.qty, price: a.price, date: a.date, origin: a.symbol, source });
    p.lots.sort((x, y) => x.date.localeCompare(y.date));
    log(p, { qty: a.qty, price: a.price, source, auto: !!a.auto });
    return;
  }
  if (a.type === 'adjust') {
    // Brings a position to what the broker reports, for what no file records.
    const delta = a.qty - held;
    // Some brokers don't report a cost, so only the shares added get one, chosen by you.
    if (a.avg == null) {
      if (delta > EPS) p.lots.push({ qty: delta, price: a.price ?? 0, date: a.date, origin: a.symbol, source: 'Broker adjustment' });
      else if (delta < -EPS) takeFifo(p, -delta);
      log(p, { qty: delta, price: a.price ?? 0 });
      return;
    }
    const target = a.qty * a.avg;
    if (delta > EPS) {
      const price = Math.max(0, (target - costOf(p.lots)) / delta);
      p.lots.push({ qty: delta, price, date: a.date, origin: a.symbol, source: 'Broker adjustment' });
      log(p, { qty: delta, price });
    } else {
      if (delta < -EPS) takeFifo(p, -delta);
      log(p, { qty: delta });
    }
    const cost = costOf(p.lots);
    if (cost > 0) p.lots.forEach(l => { l.price *= target / cost; });
    return;
  }
  if (!held) return;
  if (a.type === 'split' || a.type === 'bonus') {
    const label = a.type === 'bonus' ? 'Bonus' : 'Split';
    p.lots = rescale(p.lots, a.num / a.den, true, `${label} ${ratio} on ${a.date}${a.note ? ` (${a.note})` : ''}`);
    log(p, { qty: qtyOf(p.lots) - held });
  } else if (a.type === 'rename' || a.type === 'merger') {
    const to = positionOf(state, a.to);
    const moved = a.type === 'merger' ? rescale(p.lots, a.num / a.den, false, `Merger ${ratio} from ${a.symbol} into ${a.to} on ${a.date}`) : p.lots;
    p.lots = [];
    to.lots = [...to.lots, ...moved].sort((x, y) => x.date.localeCompare(y.date));
    log(p, { qty: -held, to: a.to });
    log(to, { qty: qtyOf(moved), from: a.symbol });
  } else if (a.type === 'demerger') {
    const to = positionOf(state, a.to);
    const share = `${(a.costShare * 100).toFixed(2)}%`;
    const split = rescale(p.lots.map(l => ({ ...l, price: l.price * a.costShare })), a.num / a.den, false, `Demerger ${ratio} from ${a.symbol} on ${a.date}, took ${share} of its cost`);
    p.lots.forEach(l => {
      l.price *= 1 - a.costShare;
      l.steps = [...(l.steps ?? []), `Demerger of ${a.to} on ${a.date}, ${share} of cost moved to it`];
    });
    to.lots = [...to.lots, ...split].sort((x, y) => x.date.localeCompare(y.date));
    log(p, { qty: 0, to: a.to });
    log(to, { qty: qtyOf(split), from: a.symbol });
  }
}

// Same-day buys and sells pair with each other first, so an intraday round trip
// never touches the delivery lots. This also covers selling before buying.
function settleDay(p, date, trades) {
  const buys = trades.filter(t => t.side !== 'sell').map(t => ({ t, left: t.qty }));
  const sells = trades.filter(t => t.side === 'sell').map(t => ({ t, left: t.qty, gain: 0, intraday: 0 }));
  let b = 0;
  for (const s of sells) {
    while (s.left > EPS && b < buys.length) {
      const take = Math.min(s.left, buys[b].left);
      p.realized.push({ buyDate: date, sellDate: date, qty: take, cost: buys[b].t.price, price: s.t.price, intraday: true });
      s.gain += take * (s.t.price - buys[b].t.price);
      s.intraday += take;
      s.left -= take;
      buys[b].left -= take;
      if (buys[b].left <= EPS) b++;
    }
  }
  for (const { t, left } of buys) {
    if (left > EPS) p.lots.push({ qty: left, price: t.price, date, origin: t.symbol });
    p.events.push({ kind: 'buy', date, qty: t.qty, price: t.price, exchange: t.exchange, origin: t.origin, tradeId: t.id, manual: t.manual, intraday: t.qty - left });
  }
  for (const s of sells) {
    const short = takeFifo(p, s.left, (lot, take) => {
      p.realized.push({ buyDate: lot.date, sellDate: date, qty: take, cost: lot.price, price: s.t.price });
      s.gain += take * (s.t.price - lot.price);
    });
    // Nothing left to match means the shares were bought before the tradebooks start.
    p.unmatched += short;
    p.events.push({ kind: 'sell', date, qty: s.t.qty, price: s.t.price, exchange: s.t.exchange, origin: s.t.origin, tradeId: s.t.id, manual: s.t.manual, gain: s.gain, intraday: s.intraday, unmatched: short > EPS ? short : 0 });
  }
}

// Yahoo quotes dividends in today's share units, so each one is multiplied back
// by the splits that came after it.
function creditDividends(state, date, divs, actions) {
  for (const d of divs) {
    const p = state.get(d.symbol);
    const held = p ? qtyOf(p.lots) : 0;
    if (held <= EPS) continue;
    const later = actions.filter(a => (a.type === 'split' || a.type === 'bonus') && a.symbol === d.symbol && a.date > date);
    const perShare = later.reduce((v, a) => v * a.num / a.den, d.amount);
    const amount = held * perShare;
    p.dividends += amount;
    p.dividendEvents.push({ date, qty: held, perShare, amount });
    p.events.push({ kind: 'dividend', date, qty: held, price: perShare, amount });
  }
}

// `dividends` is a list of { symbol, date, amount }.
export function replay(trades, actions, dividends = []) {
  const group = (list, key) => list.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map());
  const tradeDays = group(trades, t => t.date);
  const actionDays = group(actions, a => a.date);
  const divDays = group(dividends, d => d.date);
  const dates = [...new Set([...tradeDays.keys(), ...actionDays.keys(), ...divDays.keys()])].sort();
  const state = new Map();
  for (const date of dates) {
    // On an ex-date the dividend goes to whoever held the day before, and a
    // split applies before that day's trades.
    creditDividends(state, date, divDays.get(date) ?? [], actions);
    for (const a of actionDays.get(date) ?? []) applyAction(state, a);
    const bySymbol = group(tradeDays.get(date) ?? [], t => t.symbol);
    for (const [symbol, list] of bySymbol) {
      settleDay(positionOf(state, symbol), date, [...list].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')));
    }
  }
  return state;
}

/* ---------- holdings ---------- */

// The curated list plus Yahoo's splits. A curated entry wins over a Yahoo one
// for the same event.
function allActions(market) {
  const yahoo = market.flatMap(m => (m.splits ?? []).map(s => ({ type: 'split', symbol: m.symbol, date: s.date, num: s.num, den: s.den, note: 'From Yahoo Finance' })));
  const same = (a, b) => a.symbol === b.symbol && a.date === b.date && a.num === b.num && a.den === b.den;
  return [...yahoo.filter(y => !CORPORATE_ACTIONS.some(c => same(c, y))), ...CORPORATE_ACTIONS];
}

const isWhole = n => Math.abs(n - Math.round(n)) < 1e-3;

// Works out which published rights issues and IPOs explain a shortfall. Tradebooks
// miss these, so the test is strict: a rights issue must equal what the shares
// held on the record date were entitled to, and an IPO must be whole lots.
// Anything else stays a difference to review. `own` allotments replace these.
function issuesFor(named, holdings, actions, first, own) {
  const out = [];
  for (const issue of PUBLIC_ISSUES) {
    if (own.some(a => a.type === 'allot' && a.symbol === issue.symbol && a.issue === issue.kind)) continue;
    const p = first.get(issue.symbol);
    const row = holdings.find(h => baseSymbol(h.symbol) === issue.symbol);
    if (!p && !row) continue;
    // Shortfalls are in today's shares and allotments in the shares of their day.
    const later = actions
      .filter(a => (a.type === 'split' || a.type === 'bonus') && a.symbol === issue.symbol && a.date > issue.date)
      .reduce((n, a) => n * a.num / a.den, 1);
    const short = row ? (row.qty - qtyOf(p?.lots ?? [])) / later : 0;
    let qty = 0;
    if (issue.kind === 'rights') {
      const before = replay(named.filter(t => t.date <= issue.record), actions.filter(a => a.date <= issue.record));
      const held = qtyOf(before.get(issue.symbol)?.lots ?? []);
      const entitled = Math.floor(held * issue.num / issue.den + EPS);
      if (entitled && Math.abs(short - entitled) < 1e-3) qty = entitled;
    } else {
      const need = short + (p?.unmatched ?? 0);
      if (need > EPS && isWhole(need / issue.lot)) qty = need;
    }
    if (!qty) continue;
    const terms = issue.kind === 'rights' ? `${issue.num}:${issue.den} rights at ₹${issue.price}, record date ${issue.record}` : `IPO at ₹${issue.price}, lot of ${issue.lot}`;
    out.push({ type: 'allot', issue: issue.kind, symbol: issue.symbol, date: issue.date, qty, price: issue.price, auto: true, note: `${terms}, from published terms` });
  }
  return out;
}

export function buildPositions({ trades, holdings = [], market = [], own = [] }) {
  const map = symbolMap(trades, holdings);
  const named = trades.map(t => {
    const symbol = map.get(t.symbol) ?? baseSymbol(t.symbol);
    return { ...t, symbol, origin: t.symbol };
  });
  const dividends = market.flatMap(m => (m.dividends ?? []).map(d => ({ symbol: m.symbol, date: d.date, amount: d.amount })));
  // The account's own adjustments run last on a date, once everything else has landed.
  const actions = [...allActions(market), ...own];
  const issues = issuesFor(named, holdings, actions, replay(named, actions), own);
  return replay(named, [...issues, ...actions], dividends);
}

// One line of the holdings table, with `quote` as { price, change, changePct }.
export function summarizePosition(p, quote) {
  const qty = qtyOf(p.lots);
  const cost = costOf(p.lots);
  const soldCost = p.realized.reduce((n, r) => n + r.qty * r.cost, 0);
  const sold = p.realized.reduce((n, r) => n + r.qty * r.price, 0);
  const price = quote?.price ?? null;
  const value = price == null ? null : qty * price;
  const gain = value == null ? null : value - cost;
  const prev = price == null || quote.change == null ? null : price - quote.change;
  const dayGain = prev == null ? null : qty * quote.change;
  return {
    symbol: p.symbol, qty, avg: qty > EPS ? cost / qty : 0, price, cost, value,
    dividends: p.dividends,
    dayGain,
    dayPct: prev ? quote.change / prev * 100 : null,
    gain,
    gainPct: gain != null && cost > 0 ? gain / cost * 100 : null,
    soldCost,
    realized: sold - soldCost,
    realizedPct: soldCost > 0 ? (sold - soldCost) / soldCost * 100 : null,
  };
}

export function summarizeAll(rows) {
  const sum = key => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
  const priced = rows.filter(r => r.value != null);
  const value = sum('value');
  const pricedCost = priced.reduce((n, r) => n + r.cost, 0);
  const gain = value - pricedCost;
  const dayGain = sum('dayGain');
  const prevValue = value - dayGain;
  const soldCost = sum('soldCost');
  return {
    realizedPct: soldCost ? sum('realized') / soldCost * 100 : null,
    // Invested covers only what has a price, so it compares with the total shown.
    value, cost: pricedCost, gain,
    gainPct: pricedCost ? gain / pricedCost * 100 : 0,
    dayGain, dayPct: prevValue ? dayGain / prevValue * 100 : 0,
    dividends: sum('dividends'), realized: sum('realized'),
    unpriced: rows.filter(r => r.qty > EPS && r.value == null).length,
  };
}

export const positionQty = p => qtyOf(p.lots);
export const positionCost = p => costOf(p.lots);

/* ---------- stored shapes ---------- */

// Backups come from outside the app, and one bad number would poison every
// total, so rows that don't fit are dropped.
const text = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = v => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);

export function cleanAccount(x) {
  if (!isId(x?.id)) return null;
  const t = Date.now();
  return {
    id: x.id, name: text(x.name, 80) || 'Broker account', broker: text(x.broker, 80) || 'Other',
    kind: ['stock', 'mf', 'crypto'].includes(x.kind) ? x.kind : 'stock', clientId: text(x.clientId, 40),
    createdAt: finite(x.createdAt, t), updatedAt: finite(x.updatedAt, t),
  };
}

export function cleanTrade(x) {
  if (typeof x?.id !== 'string' || !isId(x.accountId) || !x.symbol || !isDate(x.date)) return null;
  if (!(x.side === 'buy' || x.side === 'sell') || !(x.qty > 0) || !Number.isFinite(x.qty) || !(x.price >= 0) || !Number.isFinite(x.price)) return null;
  return {
    id: text(x.id, 300), accountId: x.accountId, symbol: text(x.symbol, 120), isin: text(x.isin, 20), date: x.date, side: x.side,
    qty: x.qty, price: x.price, exchange: text(x.exchange, 20), series: text(x.series, 20), tradeId: text(x.tradeId, 60), time: text(x.time, 30),
    kind: x.kind === 'mf' ? 'mf' : 'stock', manual: !!x.manual, updatedAt: finite(x.updatedAt, Date.now()),
  };
}

export function cleanHoldingsFile(x) {
  if (!isId(x?.id) || !isDate(x.asOf) || !Array.isArray(x.rows)) return null;
  const rows = x.rows.filter(r => r && r.symbol && Number.isFinite(r.qty)).map(r => ({
    symbol: text(r.symbol, 120), isin: text(r.isin, 20), kind: r.kind === 'mf' ? 'mf' : 'stock', sector: text(r.sector, 80),
    qty: r.qty, avg: finite(r.avg), close: finite(r.close),
  }));
  return { id: x.id, asOf: x.asOf, rows, updatedAt: finite(x.updatedAt, Date.now()) };
}

export function cleanAdjustment(x) {
  if (!isId(x?.id) || !isId(x.accountId) || !['adjust', 'allot'].includes(x.type) || !x.symbol || !isDate(x.date) || !(x.qty >= 0)) return null;
  const t = Date.now();
  return {
    id: x.id, accountId: x.accountId, type: x.type, symbol: text(x.symbol, 120), date: x.date, qty: finite(x.qty),
    avg: x.avg >= 0 && x.avg !== null ? x.avg : null, price: finite(x.price), issue: x.issue in ISSUE_LABEL ? x.issue : 'rights',
    direction: x.direction === 'out' ? 'out' : 'in', party: text(x.party, 80), note: text(x.note), createdAt: finite(x.createdAt, t), updatedAt: finite(x.updatedAt, t),
  };
}

export function cleanNote(x) {
  if (typeof x?.id !== 'string' || !isId(x.accountId) || !x.symbol) return null;
  return { id: text(x.id, 300), accountId: x.accountId, symbol: text(x.symbol, 120), reviewed: !!x.reviewed, comment: text(x.comment, 2000), updatedAt: finite(x.updatedAt, Date.now()) };
}

export function cleanMarket(x) {
  if (!x?.symbol) return null;
  const list = v => (Array.isArray(v) ? v : []);
  const out = {
    symbol: text(x.symbol, 120),
    splits: list(x.splits).filter(s => isDate(s?.date) && s.num > 0 && s.den > 0).map(s => ({ date: s.date, num: s.num, den: s.den })),
    dividends: list(x.dividends).filter(d => isDate(d?.date) && Number.isFinite(d.amount)).map(d => ({ date: d.date, amount: d.amount })),
  };
  if (x.name) out.name = text(x.name, 120);
  if (Number.isFinite(x.schemeCode)) out.schemeCode = x.schemeCode;
  if (Number.isFinite(x.eventsAt)) out.eventsAt = x.eventsAt;
  if (Number.isFinite(x.price)) Object.assign(out, { price: x.price, change: Number.isFinite(x.change) ? x.change : null, changePct: Number.isFinite(x.changePct) ? x.changePct : null, quotedAt: finite(x.quotedAt) });
  return out;
}

/* ---------- reconciliation ---------- */

// Compares the replay with the broker's holdings file, line by line.
export function reconcile(positions, holdings) {
  const out = [];
  const seen = new Set();
  for (const h of holdings) {
    const symbol = baseSymbol(h.symbol);
    seen.add(symbol);
    const p = positions.get(symbol);
    const qty = p ? qtyOf(p.lots) : 0;
    const avg = qty > EPS ? costOf(p.lots) / qty : 0;
    // Holdings files round fund units, some to two decimals.
    const qtyOk = Math.abs(qty - h.qty) < 0.006;
    // A broker that reports no cost can only be checked on quantity.
    const avgOk = !h.avg || Math.abs(avg - h.avg) / h.avg < 0.005;
    out.push({ symbol, qty, avg, fileQty: h.qty, fileAvg: h.avg, close: h.close, status: !p || !qty ? 'missing' : !qtyOk ? 'qty' : !avgOk ? 'cost' : 'ok' });
  }
  for (const [symbol, p] of positions) {
    const qty = qtyOf(p.lots);
    if (!seen.has(symbol) && qty > EPS) out.push({ symbol, qty, avg: costOf(p.lots) / qty, fileQty: 0, fileAvg: 0, status: 'extra' });
  }
  return out;
}
