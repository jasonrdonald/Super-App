import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import { baseSymbol, buildPositions, summarizePosition, summarizeAll, reconcile, originalShares, cleanAccount, cleanTrade, cleanHoldingsFile, cleanAdjustment, cleanNote, cleanMarket } from './portfolio.js';
import { parseBrokerFile } from './portfolio-import.js';
import { stockQuotes, stockEvents, fundQuote, fundCodes, fundNav, cryptoQuotes, listedSecurities, EVENT_GAP_MS } from './market.js';
import { tickerFor, companyPart } from './tickers.js';

const KINDS = { stock: 'Stocks', mf: 'Mutual funds', crypto: 'Crypto' };
const BROKERS = ['Zerodha', 'HDFC Securities', 'Other'];
const isTicker = s => /^[A-Z0-9&_-]+$/.test(s);
const HOME = '#/s/portfolio';
const QUOTE_MAX_AGE = 6 * 60 * 60 * 1000;
const EVENTS_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const EPS = 1e-6;

const COLUMNS = [
  { key: 'symbol', label: 'Ticker', text: true },
  { key: 'name', label: 'Stock name', text: true },
  { key: 'qty', label: 'Shares', f: v => qtyText(v) },
  { key: 'avg', label: 'Cost per share', f: v => money(v) },
  { key: 'price', label: 'Last price', f: v => money(v) },
  { key: 'cost', label: 'Total cost', f: v => money(v) },
  { key: 'value', label: 'Market value', f: v => money(v) },
  { key: 'dividends', label: 'Total div income', f: v => money(v) },
  { key: 'dayPct', label: 'Day gain %', f: v => pct(v), tone: true },
  { key: 'dayGain', label: 'Day gain', f: v => money(v, true), tone: true },
  { key: 'gainPct', label: 'Total gain %', f: v => pct(v), tone: true },
  { key: 'gain', label: 'Total gain', f: v => money(v, true), tone: true },
  { key: 'realizedPct', label: 'Realized gain %', f: v => pct(v), tone: true },
  { key: 'realized', label: 'Realized gain', f: v => money(v, true), tone: true },
];

const GROUPS = ['Stocks', 'ETFs', 'Mutual funds', 'Crypto'];

const EVENT_LABEL = {
  buy: 'Bought', sell: 'Sold', split: 'Split', bonus: 'Bonus', merger: 'Merger', rename: 'Renamed',
  demerger: 'Demerger', dividend: 'Dividend', adjust: 'Broker adjustment', allot: 'Allotment',
};

const ACTION_KINDS = new Set(['split', 'bonus', 'merger', 'rename', 'demerger', 'allot', 'adjust']);

const V = { sort: 'value', dir: -1, show: 'current', asset: 'all', q: '' };
const job = { running: false, done: 0, total: 0, failed: 0 };
let firstVisit = true;

let A;
export function initPortfolio(helpers) { A = helpers; }

const cache = new Map();
const invalidate = () => cache.clear();

const accountById = id => A.S.brokerAccounts.find(a => a.id === id);
const accounts = () => [...A.S.brokerAccounts].sort((a, b) => a.createdAt - b.createdAt);
const holdingsOf = id => A.S.brokerHoldings.find(h => h.id === id);
const accountPath = id => `${HOME}/a/${id}`;

const formatter = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(v, signed) {
  if (v == null) return '–';
  const text = formatter.format(v);
  return signed && v > 0 ? `+${text}` : text;
}
const pct = v => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const qtyText = v => new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 3 }).format(v);
const tone = v => (v == null || Math.abs(v) < 0.005 ? '' : v > 0 ? 'up' : 'down');
const day = s => A.fmt(new Date(`${s}T00:00:00`), { dateStyle: 'medium' });

/* ---------- derived data ---------- */

function quoteFor(symbol, rows) {
  const m = A.S.market.find(x => x.symbol === symbol);
  if (m?.price != null) return m;
  const file = rows.find(r => baseSymbol(r.symbol) === symbol);
  return file?.close ? { price: file.close, change: null } : null;
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
  const file = holdingsOf(account.id);
  const rows = file?.rows ?? [];
  const trades = A.S.trades.filter(t => t.accountId === account.id);
  const groupOf = grouper(account, rows, trades);
  const positions = buildPositions({
    trades,
    holdings: rows,
    market: A.S.market,
    own: A.S.portfolioActions.filter(a => a.accountId === account.id),
  });
  const lines = [...positions.values()]
    .filter(p => p.lots.length || p.realized.length || p.dividends)
    .map(p => {
      const group = groupOf(p.symbol);
      const known = A.S.market.find(m => m.symbol === p.symbol)?.name;
      return { ...summarizePosition(p, quoteFor(p.symbol, rows)), group, name: known ?? (group === 'Mutual funds' ? p.symbol : '') };
    });
  const held = lines.filter(l => l.qty > EPS);
  const result = {
    positions, lines, held,
    summary: summarizeAll(lines),
    recon: rows.length ? reconcile(positions, rows) : null,
  };
  cache.set(account.id, result);
  return result;
}

export function portfolioTotal() {
  return summarizeAll(accounts().flatMap(a => computed(a).lines));
}

export const portfolioNav = () => [
  { id: 'home', name: 'Overview', icon: 'pie', href: HOME },
  ...accounts().map(a => ({ id: a.id, name: a.name, icon: a.kind === 'crypto' ? 'cloud' : a.kind === 'mf' ? 'chart' : 'card', href: accountPath(a.id) })),
];

export function portfolioRouteValid(r) {
  if (r.page === 'home' || r.page === 'add') return true;
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
  const stock = new Set(), funds = new Map(), coins = new Set();
  for (const a of accounts()) {
    const rows = holdingsOf(a.id)?.rows;
    for (const line of computed(a).lines) {
      const open = line.qty > EPS;
      // A fund the broker no longer lists was probably redeemed, so it isn't valued.
      const listed = !rows || rows.some(r => baseSymbol(r.symbol) === line.symbol);
      if (line.group === 'Crypto') { if (open) coins.add(line.symbol); }
      else if (line.group === 'Mutual funds') { if (open && listed) funds.set(line.symbol, line.symbol); }
      // Sold stocks are looked up too, for their names.
      else if (isTicker(line.symbol)) stock.add(line.symbol);
    }
  }
  const t = Date.now();
  const changed = [];
  const apply = (symbol, q) => changed.push(saveMarket(symbol, { ...q, quotedAt: t }));
  if (stock.size) (await stockQuotes([...stock])).forEach((q, s) => apply(s, q));
  if (coins.size) (await cryptoQuotes([...coins])).forEach((q, s) => apply(s, q));
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
    // Fund names vary, so a NAV far from the broker's price is the wrong plan.
    const q = await fundQuote(name).catch(() => null);
    const close = fileRow(name)?.close;
    if (q && (!close || Math.abs(q.price - close) / close < 0.2)) apply(name, q);
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
    const funds = new Set(rows.filter(r => r.kind === 'mf').map(r => baseSymbol(r.symbol)));
    c.held.forEach(l => { if (!funds.has(l.symbol)) held.add(l.symbol); });
    for (const p of c.positions.values()) {
      if (!p.events.length || funds.has(p.symbol) || p.symbol.endsWith('-RE') || !isTicker(p.symbol)) continue;
      const first = p.events.reduce((d, e) => (e.date < d ? e.date : d), '9999');
      if (first < (all.get(p.symbol) ?? '9999')) all.set(p.symbol, first);
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
      const events = await stockEvents(symbol, `${Number(from.slice(0, 4)) - 1}-01-01`);
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
    ${extra}${A.menuButton}
  </header>`;
}

function stat(label, value, note = '', cls = '') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span><span class="stat-note ${cls}">${note}</span></div>`;
}

function summaryStats(s) {
  return `<div class="stats five">
    ${stat('Total amount', money(s.value), `Invested ${money(s.cost)}${s.unpriced ? `, ${s.unpriced} unpriced left out` : ''}`)}
    ${stat('Unrealized gain/loss', money(s.gain, true), pct(s.gainPct), tone(s.gain))}
    ${stat('Realized gain/loss', money(s.realized, true), pct(s.realizedPct), tone(s.realized))}
    ${stat('Day change', money(s.dayGain, true), pct(s.dayPct), tone(s.dayGain))}
    ${stat('Total dividends', money(s.dividends))}
  </div>`;
}

/* ---------- backup ---------- */

const BACKUP_MARK = 'superapp-portfolio';

const backupButtons = (add = '') => `<div class="btn-row">
    ${add}
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

// Merges like the app-wide backup: the newer copy of each row wins and nothing
// here is deleted. Quotes and history are compared by when they were fetched.
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
  const brokers = accountsIn.map(a => a.name).join(', ');
  if (!await A.confirmDlg(`Import ${A.plural(accountsIn.length, 'broker')}?`, `${brokers}: ${A.plural(tradesIn.length, 'trade')} from “${file.name}” merge into this device. Newer versions win; nothing is deleted.`, 'Import', false)) return;

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

function homeView(r) {
  const list = accounts();
  const add = `<a class="btn sm primary" href="${HOME}/add">${icon('plus')}<span>Add broker account</span></a>`;
  const body = list.length
    ? `<div class="pay-page">
        ${summaryStats(portfolioTotal())}
        <div class="status" id="pf-status">${statusLine()}</div>
        ${backupButtons(add)}
        <div class="rows">${list.map(a => {
          const { summary: s, held } = computed(a);
          return `<a class="sub pf-account" href="${accountPath(a.id)}">
            <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
            <span class="card-meta">${A.esc(a.broker)} · ${KINDS[a.kind]} · ${A.plural(held.length, 'holding')}</span></span></span>
            <span class="pay-side"><span class="pay-amount">${money(s.value)}</span><span class="pf-delta ${tone(s.gain)}">${money(s.gain, true)} (${pct(s.gainPct)})</span></span>
          </a>`;
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
      <label class="f wide"><span>Load tradebooks and holdings</span><input name="files" type="file" multiple accept=".xlsx,.csv"></label>
      <p class="muted small wide">Pick every yearly tradebook, plus the holdings file to reconcile against. You can load more later.</p>
      <div class="f-actions wide"><button class="btn primary" type="submit">Add account</button><a class="btn ghost" href="${HOME}">Cancel</a></div>
      <div class="wide pf-or"><p class="muted small">Or import one or more brokers from a backup instead:</p>${backupButtons()}</div>
    </form></div>`;
  bindRestore();
  const form = A.$('#pf-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = new FormData(form);
    const name = d.get('name').trim();
    if (!name) return A.toast('Give the account a name.');
    const t = Date.now();
    const account = { id: A.uid(), name, broker: d.get('broker'), kind: d.get('kind'), clientId: '', createdAt: t, updatedAt: t };
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
  const fresh = [];
  let skipped = 0;
  for (const p of parsed) {
    skipped += p.skipped ?? 0;
    for (const t of p.trades ?? []) {
      const id = `${account.id}:${t.symbol}:${t.date}:${t.exchange}:${t.tradeId}`;
      if (known.has(id)) continue;
      known.add(id);
      fresh.push({ ...t, id, accountId: account.id, updatedAt: Date.now() });
    }
  }
  A.S.trades.push(...fresh);
  await db.putMany('trades', fresh);
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

const sortDirLabel = () => (COLUMNS.find(c => c.key === V.sort).text
  ? (V.dir > 0 ? 'A to Z ▲' : 'Z to A ▼')
  : (V.dir > 0 ? 'Low to high ▲' : 'High to low ▼'));

const linesInView = c => c.lines.filter(l => V.asset === 'all' || (V.asset === 'mf') === (l.group === 'Mutual funds'));

function rowsToShow(c) {
  const q = V.q.trim().toLowerCase();
  const rows = linesInView(c)
    .filter(l => (V.show === 'sold' ? l.qty <= EPS : V.show === 'current' ? l.qty > EPS : true))
    .filter(l => !q || `${l.symbol} ${l.name}`.toLowerCase().includes(q));
  const col = COLUMNS.find(x => x.key === V.sort);
  return rows.sort((a, b) => {
    if (col.text) return (a[V.sort] || '').localeCompare(b[V.sort] || '') * V.dir;
    return ((a[V.sort] ?? -Infinity) - (b[V.sort] ?? -Infinity)) * V.dir;
  });
}

function holdingsTable(account, c) {
  const rows = rowsToShow(c);
  if (!rows.length) return `<div class="empty">${icon('card')}<p>${V.q ? 'No holdings match.' : 'No holdings here. Load a tradebook or add a transaction.'}</p></div>`;
  return GROUPS
    .map(g => [g, rows.filter(r => r.group === g)])
    .filter(([, list]) => list.length)
    .map(([g, list]) => `<section class="pf-group"><h2>${g} (${list.length})</h2>${groupTable(account, list)}</section>`)
    .join('');
}

function groupTable(account, rows) {
  const total = summarizeAll(rows);
  const cell = (col, r) => {
    const v = r[col.key];
    if (col.text) return `<td class="pf-name" title="${A.esc(v)}">${A.esc(v) || '–'}</td>`;
    return `<td class="num ${col.tone ? tone(v) : ''}">${col.f(v)}</td>`;
  };
  const totals = { cost: total.cost, value: total.value, dividends: total.dividends, dayGain: total.dayGain, dayPct: total.dayPct, gain: total.gain, gainPct: total.gainPct, realized: total.realized, realizedPct: total.realizedPct };
  return `<div class="holdings-wrap"><table class="holdings">
    <thead><tr>${COLUMNS.map(col => {
      const on = V.sort === col.key;
      return `<th${col.text ? '' : ' class="num"'} aria-sort="${on ? (V.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${col.key}">${col.label}${on ? (V.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    }).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>
      <th scope="row"><a href="${accountPath(account.id)}/h/${encodeURIComponent(r.symbol)}">${A.esc(r.symbol)}</a></th>
      ${COLUMNS.slice(1).map(col => cell(col, r)).join('')}
    </tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th>${COLUMNS.slice(1).map(col => (col.key in totals ? `<td class="num ${col.tone ? tone(totals[col.key]) : ''}">${col.f(totals[col.key])}</td>` : '<td></td>')).join('')}</tr></tfoot>
  </table></div>`;
}

function reconChip(account, c) {
  if (!c.recon) return '';
  const bad = c.recon.filter(x => x.status !== 'ok').length;
  const label = bad ? `${bad} to reconcile` : 'Reconciled';
  return `<a class="btn sm" href="${accountPath(account.id)}/reconcile">${icon(bad ? 'alert' : 'check')}<span>${label}</span></a>`;
}

function accountView(r) {
  const account = accountById(r.id);
  const c = computed(account);
  const hasFunds = c.lines.some(l => l.group === 'Mutual funds');
  if (!hasFunds) V.asset = 'all';
  const inView = linesInView(c);
  const open = inView.filter(l => l.qty > EPS).length;
  const sold = inView.length - open;
  A.view.innerHTML = `
    ${hero(account.name, `${account.broker} · ${KINDS[account.kind]}${account.clientId ? ` · ${account.clientId}` : ''}`, HOME,
      `<button class="icon-btn" data-act="pf-menu" data-id="${account.id}" aria-label="Account options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      ${hasFunds ? `<div class="seg" role="group" aria-label="Asset type">
        ${[['all', 'All'], ['equity', 'Stocks & ETFs'], ['mf', 'Mutual funds']].map(([k, l]) => `<button data-asset="${k}" aria-pressed="${V.asset === k}">${l}</button>`).join('')}
      </div>` : ''}
      ${summaryStats(summarizeAll(inView))}
      <div class="status" id="pf-status">${statusLine()}</div>
      <div class="period">
        <div class="seg" role="group" aria-label="Which holdings">
          ${[['current', `Current (${open})`], ['sold', `Sold (${sold})`], ['all', 'All']].map(([k, l]) => `<button data-show="${k}" aria-pressed="${V.show === k}">${l}</button>`).join('')}
        </div>
        ${reconChip(account, c)}
        <button class="btn sm" data-act="pf-refresh">${icon('restore')}<span>Refresh</span></button>
        <label class="btn sm">${icon('upload')}<span>Load files</span><input id="pf-files" type="file" multiple accept=".xlsx,.csv" hidden></label>
      </div>
      <label class="search flush">${icon('search')}<input type="search" id="pf-q" placeholder="Search holdings" value="${A.esc(V.q)}" autocomplete="off"></label>
      <div class="pf-sort">
        <label for="pf-sort">Sort by</label>
        <select class="select" id="pf-sort">${COLUMNS.map(col => `<option value="${col.key}"${col.key === V.sort ? ' selected' : ''}>${col.label}</option>`).join('')}</select>
        <button class="btn sm" id="pf-dir">${sortDirLabel()}</button>
      </div>
      <div id="pf-table">${holdingsTable(account, c)}</div>
    </div></div>
    <a class="fab" href="${accountPath(account.id)}/trade" aria-label="Add transaction">${icon('plus')}</a>`;

  const draw = () => {
    A.$('#pf-table').innerHTML = holdingsTable(account, computed(account));
    A.$('#pf-sort').value = V.sort;
    A.$('#pf-dir').textContent = sortDirLabel();
  };
  const sortBy = key => {
    V.sort = key;
    V.dir = COLUMNS.find(c => c.key === key).text ? 1 : -1;
    draw();
  };
  A.$('#pf-sort').addEventListener('change', e => sortBy(e.target.value));
  A.$('#pf-dir').addEventListener('click', () => { V.dir = -V.dir; draw(); });
  A.$('#pf-q').addEventListener('input', e => { V.q = e.target.value; draw(); });
  A.$('#pf-files').addEventListener('change', async e => {
    const files = e.target.files;
    if (files.length) await loadFiles(account, files);
    A.refresh();
  });
  A.view.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => { V.show = b.dataset.show; accountView(r); }));
  A.view.querySelectorAll('[data-asset]').forEach(b => b.addEventListener('click', () => { V.asset = b.dataset.asset; accountView(r); }));
  A.$('#pf-table').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    if (V.sort !== b.dataset.sort) return sortBy(b.dataset.sort);
    V.dir = -V.dir;
    draw();
  });
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
    : e.kind === 'buy' || e.kind === 'sell' || e.kind === 'allot' ? money(e.qty * e.price) : '';
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

function reviewBlock(account, symbol, p) {
  const note = noteFor(account.id, symbol);
  const system = p ? systemNotes(p) : [];
  return `<ul class="pf-notes">${system.map(s => `<li>${A.esc(s)}</li>`).join('')}</ul>
    ${note?.comment ? `<p class="pf-comment">${icon('edit')}<span>${A.esc(note.comment)}</span></p>` : ''}
    <div class="pf-review">
      ${note?.reviewed ? `<span class="chip paid">${icon('check')}Reviewed</span>` : '<span class="chip">Not reviewed</span>'}
      <button class="btn sm" data-act="pf-note" data-id="${account.id}" data-symbol="${A.esc(symbol)}">${icon('edit')}<span>Review</span></button>
      ${p?.events.some(e => e.kind === 'allot') ? `<button class="btn sm" data-act="pf-allot" data-id="${account.id}" data-symbol="${A.esc(symbol)}">Override allotment</button>` : ''}
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
    <header class="topbar">${A.upButton(accountPath(account.id))}<div class="titles"><h1>${A.esc(r.symbol)}</h1><p>${A.esc(line.name || account.name)}</p></div>${A.menuButton}</header>
    <div class="scroll"><div class="pay-page">
      <div class="stats">
        ${stat('Shares', qtyText(line.qty), `Cost per share ${money(line.avg)}`)}
        ${stat('Market value', money(line.value), `Last price ${money(price)}`)}
        ${stat('Total gain', money(line.gain, true), pct(line.gainPct), tone(line.gain))}
        ${stat('Day gain', money(line.dayGain, true), pct(line.dayPct), tone(line.dayGain))}
        ${stat('Realized gain', money(line.realized, true), pct(line.realizedPct), tone(line.realized))}
        ${stat('Dividend income', money(line.dividends), A.plural(p.dividendEvents.length, 'payment'))}
      </div>
      ${p.lots.length ? `<section class="panel"><h2>Open lots</h2><div class="holdings-wrap"><table class="holdings lots">
        <thead><tr><th>Bought</th><th class="num">Original shares</th><th class="num">Change</th><th class="num">Current shares</th><th class="num">Cost per share</th><th class="num">Total cost</th><th class="num">Gain</th><th class="num">Gain %</th></tr></thead>
        <tbody>${p.lots.map(l => {
          const gain = price == null ? null : l.qty * (price - l.price);
          const original = originalShares(l);
          const why = [...(l.source ? [l.source] : []), ...(l.steps ?? [])].join(' · ');
          return `<tr><td>${day(l.date)}</td><td class="num">${qtyText(original)}</td><td class="num">${signedQty(l.qty - original)}</td><td class="num">${qtyText(l.qty)}</td><td class="num">${money(l.price)}</td><td class="num">${money(l.qty * l.price)}</td>
            <td class="num ${tone(gain)}">${money(gain, true)}</td><td class="num ${tone(gain)}">${pct(gain == null || !l.price ? null : (price - l.price) / l.price * 100)}</td></tr>
            ${why ? `<tr class="lot-note"><td colspan="8">${A.esc(why)}</td></tr>` : ''}`;
        }).join('')}</tbody>
      </table></div></section>` : ''}
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
  const fundGap = bad.some(x => file.rows.some(h => h.kind === 'mf' && baseSymbol(h.symbol) === x.symbol) || c.lines.some(l => l.symbol === x.symbol && l.group === 'Mutual funds'));
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
            <button class="btn sm" data-act="pf-allot" data-id="${account.id}" data-symbol="${A.esc(x.symbol)}">Rights / IPO</button>
            <button class="btn sm" data-act="pf-note" data-id="${account.id}" data-symbol="${A.esc(x.symbol)}">Note</button>
          </div>
        </div>`).join('')}</div>
      </section>` : `<section class="panel"><h2>All holdings match</h2><p class="muted">Quantity and cost per share agree with the broker's file.</p></section>`}
      ${acted.length ? `<details class="panel pf-details"><summary>System notes on stock actions (${done} of ${acted.length} reviewed)</summary>
        <div class="rows">${acted.map(p => `<div class="pf-acted"><a class="card-title" href="${accountPath(account.id)}/h/${encodeURIComponent(p.symbol)}">${A.esc(p.symbol)}</a>${reviewBlock(account, p.symbol, p)}</div>`).join('')}</div>
      </details>` : ''}
      ${fixes.length ? `<section class="panel"><h2>Your overrides (${fixes.length})</h2>
        <div class="rows">${fixes.map(f => `<div class="sub pay-row"><div class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(f.symbol)}</span><span class="card-meta">${f.type === 'allot'
          ? `${f.issue === 'ipo' ? 'IPO allotment' : 'Rights issue'}: ${qtyText(f.qty)} at ${money(f.price)} on ${day(f.date)}${f.note ? `. ${A.esc(f.note)}` : ''}`
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
    let values = null;
    form.addEventListener('submit', e => { if (e.submitter?.value) values = Object.fromEntries(new FormData(form)); });
    d.onclose = () => resolve(d.returnValue ? values : null);
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

// Replaces the published terms for this holding, or records an issue they lack.
async function overrideAllotment(account, symbol) {
  const p = computed(account).positions.get(symbol);
  const cur = p?.events.find(e => e.kind === 'allot');
  const issue = cur?.source === 'IPO allotment' ? 'ipo' : 'rights';
  const v = await formDialog(`Rights issue or IPO: ${symbol}`, `
    <label class="f"><span>Type</span><select name="issue"><option value="rights"${issue === 'rights' ? ' selected' : ''}>Rights issue</option><option value="ipo"${issue === 'ipo' ? ' selected' : ''}>IPO allotment</option></select></label>
    <label class="f"><span>Shares allotted, in the units of that date</span><input name="qty" type="number" min="0" step="any" required value="${cur?.qty ?? ''}"></label>
    <label class="f"><span>Price per share</span><input name="price" type="number" min="0" step="any" required value="${cur?.price ?? ''}"></label>
    <label class="f"><span>Allotment date</span><input name="date" type="date" required value="${cur?.date ?? holdingsOf(account.id)?.asOf ?? ''}"></label>
    <label class="f"><span>Comment</span><input name="note" maxlength="200" value=""></label>`, 'Save');
  if (!v) return;
  const t = Date.now();
  const action = {
    id: A.uid(), accountId: account.id, type: 'allot', issue: v.issue, symbol, date: v.date, qty: Number(v.qty), price: Number(v.price),
    avg: null, note: v.note.trim() || 'Entered by hand', createdAt: t, updatedAt: t,
  };
  const old = A.S.portfolioActions.filter(a => a.accountId === account.id && a.type === 'allot' && a.symbol === symbol);
  for (const a of old) await db.del('portfolioActions', a.id);
  A.S.portfolioActions = [...A.S.portfolioActions.filter(a => !old.includes(a)), action];
  await A.persist('portfolioActions', action);
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
      <label class="f"><span>Type</span><select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
      <label class="f"><span>Date</span><input name="date" type="date" required max="${today}" value="${today}"></label>
      <label class="f"><span>Quantity</span><input name="qty" type="number" inputmode="decimal" min="0.00000001" step="any" required></label>
      <label class="f"><span>Price per unit</span><input name="price" type="number" inputmode="decimal" min="0" step="any" required></label>
      <div class="f-actions wide"><button class="btn primary" type="submit">Add transaction</button><a class="btn ghost" href="${back}">Cancel</a></div>
    </form></div>`;
  const form = A.$('#pf-trade');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form));
    const symbol = d.symbol.trim();
    if (!symbol) return A.toast('Enter a symbol.');
    const trade = {
      id: A.uid(), accountId: account.id, manual: true, isin: '', exchange: '', series: '', tradeId: '', time: '',
      symbol: account.kind === 'mf' ? symbol : symbol.toUpperCase(), date: d.date, side: d.side, qty: Number(d.qty), price: Number(d.price), updatedAt: Date.now(),
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
    case 'pf-note': return reviewNote(accountById(id), symbol);
    case 'pf-allot': return overrideAllotment(accountById(id), symbol);
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
  if (r.page === 'add') addView();
  else if (r.page === 'account') accountView(r);
  else if (r.page === 'stock') stockView(r);
  else if (r.page === 'reconcile') reconcileView(r);
  else if (r.page === 'trade') tradeView(r);
  else homeView(r);
  if (!A.S.brokerAccounts.length || !firstVisit) return;
  // Once per launch: picks up a stale market, or a load cut short by closing the app.
  firstVisit = false;
  const unnamed = accounts().some(a => computed(a).held.some(l => !l.name));
  if (unnamed || Date.now() - A.ls.get('pfQuotedAt', 0) > QUOTE_MAX_AGE) refreshMarket();
  else refreshEvents();
}

// Data arrived from a backup, so earlier results no longer hold.
export const portfolioChanged = invalidate;
