// Free market data. Most sources refuse calls from a web page, so each one here
// is chosen because it answers a browser directly. Only ticker symbols and fund
// or coin names leave the device, never quantities or amounts.

const timed = (ms = 20000) => AbortSignal.timeout(ms);

// Local backup mode stops every call here, so nothing can reach the internet.
let offline = false;
export const setOffline = on => { offline = on; };
const web = (...args) => (offline ? Promise.reject(new Error('Public data is set to local backup')) : fetch(...args));

/* ---------- stock prices: TradingView's public scanner, delayed 15 minutes ---------- */

const tvTicker = (exchange, s) => `${exchange}:${s.replace(/-/g, '_')}`;

// App field to scanner columns, best first. Only some companies report trailing
// figures, so most fall back to the last full year.
const FUNDAMENTALS = {
  sector: ['sector'], industry: ['industry'], marketCap: ['market_cap_basic'], type: ['type'],
  divYield: ['dividends_yield_current'], eps: ['earnings_per_share_diluted_ttm'], pe: ['price_earnings_ttm'],
  pb: ['price_book_ratio'], ps: ['price_sales_ratio'], evEbitda: ['enterprise_value_ebitda_ttm'],
  roe: ['return_on_equity', 'return_on_equity_fy'], roce: ['return_on_capital_employed_fy'],
  roic: ['return_on_invested_capital', 'return_on_invested_capital_fy'], roa: ['return_on_assets', 'return_on_assets_fy'],
  grossMargin: ['gross_margin_ttm'], operatingMargin: ['operating_margin_ttm'], netMargin: ['net_margin_ttm'],
  debtEquity: ['debt_to_equity', 'debt_to_equity_fy'], currentRatio: ['current_ratio', 'current_ratio_fy'],
  fcf: ['free_cash_flow_ttm', 'free_cash_flow_fy'], piotroski: ['piotroski_f_score_ttm', 'piotroski_f_score_fy'],
  payout: ['dividend_payout_ratio_ttm'], beta: ['beta_1_year'],
  revenueGrowth: ['total_revenue_yoy_growth_ttm'], epsGrowth: ['earnings_per_share_diluted_yoy_growth_ttm'], profitGrowth: ['net_income_yoy_growth_ttm'],
  high52: ['price_52_week_high'], low52: ['price_52_week_low'],
  perf1w: ['Perf.W'], perf1m: ['Perf.1M'], perf3m: ['Perf.3M'], perf6m: ['Perf.6M'], perf1y: ['Perf.Y'], perf5y: ['Perf.5Y'], rsi: ['RSI'], sma200: ['SMA200'],
  allHigh: ['High.All'], allLow: ['Low.All'],
};
const PRICE_COLUMNS = ['close', 'change', 'change_abs', 'description'];
// Yearly history, newest first and adjusted for splits, is read for its growth rates only.
const HISTORY_COLUMNS = ['earnings_per_share_diluted_fy_h', 'total_revenue_fy_h', 'fiscal_period_end_fy'];
const SCAN_COLUMNS = [...PRICE_COLUMNS, ...Object.values(FUNDAMENTALS).flat(), ...HISTORY_COLUMNS];

// Yearly growth over up to five years, and over its recent and earlier parts, on
// earnings where every year made a profit and on revenue otherwise.
function growthFrom(eps, revenue) {
  const span = list => (Array.isArray(list) ? list.slice(0, 6).filter(v => v != null).reverse() : []);
  const profitable = span(eps);
  const run = profitable.length >= 4 && profitable.every(v => v > 0) ? profitable : span(revenue);
  if (run.length < 4 || run.some(v => v <= 0)) return {};
  const rate = (from, to) => ((run[to] / run[from]) ** (1 / (to - from)) - 1) * 100;
  const last = run.length - 1;
  return { gBasis: run === profitable ? 'EPS' : 'Revenue', gCagr: rate(0, last), gRecent: rate(last - 2, last), gEarly: rate(0, last - 2) };
}

// EPS by the month each financial year ended, counting back from the latest year-end.
function yearlyEps(d) {
  const list = d[SCAN_COLUMNS.indexOf(HISTORY_COLUMNS[0])];
  const end = d[SCAN_COLUMNS.indexOf(HISTORY_COLUMNS[2])];
  if (!Array.isArray(list) || !end) return {};
  const [year, month] = new Date(end * 1000).toISOString().slice(0, 7).split('-');
  return Object.fromEntries(list.flatMap((eps, i) => (eps == null ? [] : [[`${Number(year) - i}-${month}`, eps]])));
}

function fundamentalsFrom(d) {
  const value = column => d[SCAN_COLUMNS.indexOf(column)];
  const out = {};
  for (const [field, columns] of Object.entries(FUNDAMENTALS)) {
    const found = columns.map(value).find(v => v != null);
    if (found != null) out[field] = found;
  }
  return { ...out, ...growthFrom(value(HISTORY_COLUMNS[0]), value(HISTORY_COLUMNS[1])) };
}

async function scan(tickers) {
  const res = await web('https://scanner.tradingview.com/india/scan', {
    method: 'POST', signal: timed(),
    body: JSON.stringify({ symbols: { tickers }, columns: SCAN_COLUMNS }),
  });
  if (!res.ok) throw new Error(`Price service answered ${res.status}`);
  return (await res.json()).data ?? [];
}

// Resolves to a Map of symbol to { price, change, changePct, name, f }, with
// fundamentals in `f`.
export async function stockQuotes(symbols) {
  const quotes = new Map();
  const fill = (list, exchange, rows) => {
    const bySymbol = new Map(list.map(s => [tvTicker(exchange, s), s]));
    for (const { s, d } of rows) {
      if (d[0] != null) quotes.set(bySymbol.get(s), { price: d[0], changePct: d[1], change: d[2], name: d[3], f: fundamentalsFrom(d), epsYears: yearlyEps(d) });
    }
  };
  for (let i = 0; i < symbols.length; i += 300) {
    const part = symbols.slice(i, i + 300);
    fill(part, 'NSE', await scan(part.map(s => tvTicker('NSE', s))));
  }
  const rest = symbols.filter(s => !quotes.has(s));
  if (rest.length) fill(rest, 'BSE', await scan(rest.map(s => tvTicker('BSE', s))));
  return quotes;
}

// US tickers, found by name as each sits on one of several exchanges.
export async function usQuotes(symbols) {
  const res = await web('https://scanner.tradingview.com/america/scan', {
    method: 'POST', signal: timed(),
    body: JSON.stringify({ filter: [{ left: 'name', operation: 'in_range', right: symbols }], columns: SCAN_COLUMNS, range: [0, symbols.length * 2] }),
  });
  if (!res.ok) throw new Error(`Price service answered ${res.status}`);
  const quotes = new Map();
  for (const { s, d } of (await res.json()).data ?? []) {
    if (d[0] != null) quotes.set(s.split(':')[1], { price: d[0], changePct: d[1], change: d[2], name: d[3], f: fundamentalsFrom(d) });
  }
  return quotes;
}

// Rupees per US dollar.
export async function usdInr() {
  const res = await web('https://scanner.tradingview.com/forex/scan', {
    method: 'POST', signal: timed(),
    body: JSON.stringify({ symbols: { tickers: ['FX_IDC:USDINR'] }, columns: ['close'] }),
  });
  if (!res.ok) throw new Error(`Rate service answered ${res.status}`);
  return (await res.json()).data?.[0]?.d[0] ?? null;
}

let listed;

// Every security on NSE, then whatever only BSE lists, for matching names to tickers.
export async function listedSecurities() {
  if (listed) return listed;
  const fetchExchange = async exchange => {
    const res = await web('https://scanner.tradingview.com/india/scan', {
      method: 'POST', signal: timed(40000),
      body: JSON.stringify({ filter: [{ left: 'exchange', operation: 'equal', right: exchange }], columns: ['name', 'description', 'isin', 'close'], range: [0, 20000] }),
    });
    if (!res.ok) throw new Error(`Price service answered ${res.status}`);
    return ((await res.json()).data ?? []).map(({ d }) => ({ symbol: d[0], name: d[1] ?? '', isin: d[2] ?? '', close: d[3] ?? 0 }));
  };
  const nse = await fetchExchange('NSE');
  const isins = new Set(nse.map(x => x.isin));
  listed = [...nse, ...(await fetchExchange('BSE')).filter(x => !isins.has(x.isin))];
  return listed;
}

// The median P/E of each sector across NSE stocks above ₹500 Cr, with at least five to compare.
export async function sectorPes() {
  const res = await web('https://scanner.tradingview.com/india/scan', {
    method: 'POST', signal: timed(40000),
    body: JSON.stringify({ filter: [{ left: 'exchange', operation: 'equal', right: 'NSE' }, { left: 'market_cap_basic', operation: 'greater', right: 5e9 }], columns: ['sector', 'price_earnings_ttm'], range: [0, 5000] }),
  });
  if (!res.ok) throw new Error(`Price service answered ${res.status}`);
  const bySector = new Map();
  for (const { d: [sector, pe] } of (await res.json()).data ?? []) {
    if (sector && pe > 0) bySector.set(sector, [...(bySector.get(sector) ?? []), pe]);
  }
  return Object.fromEntries([...bySector].filter(([, list]) => list.length >= 5).map(([sector, list]) => [sector, list.sort((a, b) => a - b)[Math.floor(list.length / 2)]]));
}

/* ---------- splits and dividends: Yahoo Finance, through a reader that relays it ---------- */

export const EVENT_GAP_MS = 3300;

const relays = [
  async url => {
    const res = await web(`https://r.jina.ai/${url}`, { signal: timed() });
    if (res.status === 429) throw new Error('busy');
    return res.text();
  },
  async url => {
    const res = await web(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: timed(30000) });
    return (await res.json()).contents;
  },
];

const dayOf = seconds => new Date((seconds + 19800) * 1000).toISOString().slice(0, 10);

// Resolves to Yahoo's chart for a ticker, or null when it doesn't know it.
async function yahooChart(ticker, from, query) {
  const start = Math.floor(new Date(from).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${Math.floor(Date.now() / 1000)}&${query}`;
  let lastError;
  for (const relay of relays) {
    try {
      const text = await relay(url);
      const at = text.indexOf('{"chart"');
      if (at < 0) {
        if (/Not Found|404/.test(text)) return null;
        throw new Error('Unexpected answer');
      }
      return JSON.parse(text.slice(at, text.lastIndexOf('}') + 1)).chart.result?.[0] ?? null;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Yahoo writes share classes with a dash, as in BRK-B.
const stockTicker = (symbol, us) => (us ? symbol.replace('.', '-') : `${symbol}.NS`);

// Resolves to { splits, dividends }, or null when Yahoo doesn't know the ticker.
export async function stockEvents(symbol, from, us) {
  const result = await yahooChart(stockTicker(symbol, us), from, 'interval=1wk&events=div%2Csplit');
  if (!result) return null;
  const events = result.events ?? {};
  return {
    splits: Object.values(events.splits ?? {}).map(s => ({ date: dayOf(s.date), num: s.numerator, den: s.denominator })),
    dividends: Object.values(events.dividends ?? {}).map(d => ({ date: dayOf(d.date), amount: d.amount })),
  };
}

// NSE's daily closing file, which has each index's P/E, P/B and dividend yield. The
// day's file appears in the evening, and none exist for holidays, so this looks back.
export const indexValuations = () => closingBefore(new Date(), 7);

// The last file of a month, for the index P/Es at that month's end.
export function monthEndValuations(key) {
  const [year, month] = key.split('-').map(Number);
  return closingBefore(new Date(year, month, 0), 7);
}

async function closingBefore(from, days) {
  const day = new Date(from);
  for (let tries = 0; tries < days; tries++, day.setDate(day.getDate() - 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const stamp = [day.getDate(), day.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('') + day.getFullYear();
    const text = await relays[0](`https://nsearchives.nseindia.com/content/indices/ind_close_all_${stamp}.csv`).catch(() => '');
    const at = text.indexOf('Index Name,');
    if (at >= 0) {
      const rows = text.slice(at).split('\n').slice(1).map(line => line.trim().split(','));
      const value = s => (Number.isFinite(Number(s)) && s !== '' ? Number(s) : null);
      return new Map(rows.filter(r => r.length >= 13).map(r => [r[0], { date: r[1], close: value(r[5]), pe: value(r[10]), pb: value(r[11]), divYield: value(r[12]) }]));
    }
    await new Promise(r => setTimeout(r, EVENT_GAP_MS));
  }
  return null;
}

// Month to [open, close], in today's share units as Yahoo adjusts for splits.
export async function monthlyPrices(symbol, from, kind) {
  const ticker = kind === 'index' ? symbol : kind === 'crypto' ? `${symbol}-INR` : stockTicker(symbol, kind === 'us');
  const result = await yahooChart(ticker, from, 'interval=1mo');
  const quote = result?.indicators?.quote?.[0];
  if (!quote) return null;
  const months = {};
  (result.timestamp ?? []).forEach((t, i) => {
    if (quote.open[i] != null && quote.close[i] != null) months[dayOf(t).slice(0, 7)] = [quote.open[i], quote.close[i]];
  });
  return months;
}

/* ---------- mutual funds: mfapi.in ---------- */

const words = s => s.toLowerCase().replace(/[^a-z0-9& ]+/g, '').split(/\s+/).filter(Boolean);

async function searchFunds(query) {
  const res = await web(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, { signal: timed() });
  return res.json();
}

// Holdings files name a fund without its option, so this looks for the growth
// plan whose name shares the most words. Fund names vary between sources, so a
// search that finds nothing is retried on just the first two words. Plans of one
// fund can look alike, so when a recent price is known, `near` picks between them.
export async function fundQuote(name, near) {
  const plain = name.replace(/\s+-\s+.*$/, '');
  let found = await searchFunds(plain);
  if (!found.length) found = await searchFunds(words(plain).slice(0, 2).join(' '));
  const direct = /direct/i.test(name);
  const wanted = new Set(words(name));
  const score = f => words(f.schemeName).filter(w => wanted.has(w)).length;
  const ranked = found
    .filter(f => /growth/i.test(f.schemeName) && /direct/i.test(f.schemeName) === direct)
    .sort((a, b) => score(b) - score(a));
  const quotes = [];
  for (const fund of ranked.slice(0, near ? 4 : 1)) {
    const q = await fundNav(fund.schemeCode).catch(() => null);
    if (q) quotes.push({ ...q, schemeCode: fund.schemeCode });
  }
  if (!near) return quotes[0] ?? null;
  return quotes.sort((a, b) => Math.abs(a.price - near) - Math.abs(b.price - near))[0] ?? null;
}

let codes;

// ISIN to scheme code, from the full list of schemes. It is about 11 MB, so
// callers keep the code once they have it.
export async function fundCodes() {
  if (codes) return codes;
  const list = await (await web('https://api.mfapi.in/mf', { signal: timed(60000) })).json();
  codes = new Map(list.flatMap(f => [[f.isinGrowth, f.schemeCode], [f.isinDivReinvestment, f.schemeCode]]).filter(([isin]) => isin));
  return codes;
}

export async function fundNav(code) {
  const nav = await (await web(`https://api.mfapi.in/mf/${code}`, { signal: timed() })).json();
  const [latest, previous] = nav.data ?? [];
  if (!latest) return null;
  const price = Number(latest.nav);
  const change = previous ? price - Number(previous.nav) : null;
  return { price, change, changePct: change == null ? null : change / Number(previous.nav) * 100 };
}

// The first and last NAV of each month, from the daily list, which runs newest first.
export async function fundMonths(code) {
  const nav = await (await web(`https://api.mfapi.in/mf/${code}`, { signal: timed() })).json();
  const months = {};
  for (const { date, nav: value } of nav.data ?? []) {
    const [, m, y] = date.split('-');
    const key = `${y}-${m}`;
    months[key] = [Number(value), months[key]?.[1] ?? Number(value)];
  }
  return months;
}

/* ---------- crypto: CoinGecko ---------- */

// Coins with fixed ids, as a search is rate limited and short symbols are ambiguous.
const COINS = {
  BTC: ['bitcoin', 'Bitcoin'], ETH: ['ethereum', 'Ethereum'], XRP: ['ripple', 'XRP'], DOGE: ['dogecoin', 'Dogecoin'],
  LTC: ['litecoin', 'Litecoin'], BCH: ['bitcoin-cash', 'Bitcoin Cash'], TRX: ['tron', 'TRON'], BNB: ['binancecoin', 'BNB'],
  USDT: ['tether', 'Tether'], POL: ['polygon-ecosystem-token', 'Polygon'], MANA: ['decentraland', 'Decentraland'],
  BAT: ['basic-attention-token', 'Basic Attention Token'], A: ['vaulta', 'Vaulta (was EOS)'], IQ: ['everipedia', 'IQ'],
  OMG: ['omisego', 'OMG Network'],
  // The old token no longer trades, and searching for it finds an unrelated coin.
  GNT: ['', 'Golem, old GNT token'],
};

export async function cryptoQuotes(symbols, currency = 'inr') {
  const quotes = new Map();
  const ids = new Map();
  for (const symbol of symbols) {
    const known = COINS[symbol.toUpperCase()];
    if (known && !known[0]) { quotes.set(symbol, { price: null, changePct: null, change: null, name: known[1] }); continue; }
    if (known) { ids.set(known[0], symbol); continue; }
    const res = await web(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`, { signal: timed() }).catch(() => null);
    const coin = res?.ok ? (await res.json()).coins?.find(c => c.symbol.toUpperCase() === symbol.toUpperCase()) : null;
    if (coin) ids.set(coin.id, symbol);
  }
  if (!ids.size) return quotes;
  const res = await web(`https://api.coingecko.com/api/v3/simple/price?ids=${[...ids.keys()].join(',')}&vs_currencies=${currency}&include_24hr_change=true`, { signal: timed() });
  for (const [id, q] of Object.entries(await res.json())) {
    const price = q[currency], changePct = q[`${currency}_24h_change`] ?? null;
    const symbol = ids.get(id);
    quotes.set(symbol, { price, changePct, change: changePct == null ? null : price - price / (1 + changePct / 100), name: COINS[symbol.toUpperCase()]?.[1] ?? symbol });
  }
  return quotes;
}
