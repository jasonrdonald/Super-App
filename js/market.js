// Free market data. Most sources refuse calls from a web page, so each one here
// is chosen because it answers a browser directly. Only ticker symbols and fund
// or coin names leave the device, never quantities or amounts.

const timed = (ms = 20000) => AbortSignal.timeout(ms);

// Local backup mode stops every call here, so nothing can reach the internet.
let offline = false;
export const setOffline = on => { offline = on; };
const web = (...args) => (offline ? Promise.reject(new Error('Public data is set to local backup')) : fetch(...args));

/* ---------- change over a period ---------- */

// The periods a price change is shown over, besides the day. 5D is the past week,
// five trading days.
export const PERIODS = ['5d', '1m', '6m', 'ytd', '1y'];

// The percentage change over each period from TradingView's own columns.
const perfFrom = f => Object.fromEntries([['5d', f.perf1w], ['1m', f.perf1m], ['6m', f.perf6m], ['ytd', f.perfYtd], ['1y', f.perf1y]].filter(([, v]) => Number.isFinite(v)));

// The price each period started at, from a daily series of [isoDate, price]: the last
// price on or before the period's start. Kept as prices, not percentages, so the
// change stays right as today's price moves.
export function seriesStarts(points, today = new Date()) {
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const back = (days = 0, months = 0, years = 0) => iso(new Date(today.getFullYear() - years, today.getMonth() - months, today.getDate() - days));
  const starts = { '5d': back(7), '1m': back(0, 1), '6m': back(0, 6), ytd: `${today.getFullYear() - 1}-12-31`, '1y': back(0, 0, 1) };
  const sorted = [...points].sort((a, b) => a[0].localeCompare(b[0]));
  const out = {};
  for (const [k, start] of Object.entries(starts)) {
    // The free crypto service gives a year at most, so its first price may land a day or two after a year ago.
    const grace = iso(new Date(new Date(`${start}T00:00:00`).getTime() + 3 * 864e5));
    if (!sorted.length || sorted[0][0] > grace) continue;
    const then = (sorted.filter(p => p[0] <= start).at(-1) ?? sorted[0])[1];
    if (then > 0) out[k] = then;
  }
  return out;
}

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
  perf1w: ['Perf.W'], perf1m: ['Perf.1M'], perf3m: ['Perf.3M'], perf6m: ['Perf.6M'], perf1y: ['Perf.Y'], perfYtd: ['Perf.YTD'], perf5y: ['Perf.5Y'], rsi: ['RSI'], sma200: ['SMA200'],
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
      if (d[0] != null) { const f = fundamentalsFrom(d); quotes.set(bySymbol.get(s), { price: d[0], changePct: d[1], change: d[2], name: d[3], f, perf: perfFrom(f), epsYears: yearlyEps(d) }); }
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
    if (d[0] != null) { const f = fundamentalsFrom(d); quotes.set(s.split(':')[1], { price: d[0], changePct: d[1], change: d[2], name: d[3], f, perf: perfFrom(f) }); }
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

/* ---------- benchmark indices and coins, for the market strip ---------- */

// Each benchmark and where its level comes from. TradingView's scanner doesn't carry
// Nifty Midcap 150, so it comes from Yahoo's daily chart, and its INR coin pairs are
// stale, so coins come from CoinGecko like held coins do.
export const MARKET_TICKERS = [
  { id: 'nifty50', name: 'Nifty 50', market: 'in', tv: ['india', 'NSE:NIFTY'] },
  { id: 'next50', name: 'Nifty Next 50', market: 'in', tv: ['india', 'NSE:NIFTYJR'] },
  { id: 'mid150', name: 'Nifty Midcap 150', short: 'Midcap 150', market: 'in', yahoo: 'NIFTYMIDCAP150.NS' },
  { id: 'sp500', name: 'S&P 500', market: 'us', tv: ['america', 'SP:SPX'] },
  { id: 'nasdaq100', name: 'Nasdaq 100', market: 'us', tv: ['america', 'NASDAQ:NDX'] },
  { id: 'btcinr', name: 'BTC/INR', market: 'crypto', coin: 'bitcoin' },
  { id: 'ethinr', name: 'ETH/INR', market: 'crypto', coin: 'ethereum' },
];

const PERF_COLUMNS = ['Perf.W', 'Perf.1M', 'Perf.6M', 'Perf.YTD', 'Perf.Y'];
const pctFromStarts = (price, starts) => Object.fromEntries(Object.entries(starts).map(([k, v]) => [k, (price / v - 1) * 100]));

// Resolves to a Map of id to { price, change, changePct, perf }, where perf holds the
// percentage change over 5D, 1M, 6M, YTD and 1Y. `coinLong` says whether to also ask
// for the coins' 6M and YTD, a call per coin that the free service limits. Tickers
// that fail are left out, so one source being down doesn't hide the rest.
export async function marketTickers({ coinLong = true } = {}) {
  const out = new Map();
  const jobs = [];
  const byMarket = new Map();
  for (const t of MARKET_TICKERS.filter(t => t.tv)) byMarket.set(t.tv[0], [...(byMarket.get(t.tv[0]) ?? []), t]);
  for (const [market, list] of byMarket) {
    jobs.push((async () => {
      const res = await web(`https://scanner.tradingview.com/${market}/scan`, {
        method: 'POST', signal: timed(),
        body: JSON.stringify({ symbols: { tickers: list.map(t => t.tv[1]) }, columns: ['close', 'change', 'change_abs', ...PERF_COLUMNS] }),
      });
      if (!res.ok) throw new Error(`Price service answered ${res.status}`);
      for (const { s, d } of (await res.json()).data ?? []) {
        const t = list.find(x => x.tv[1] === s);
        if (!t || d[0] == null) continue;
        const perf = Object.fromEntries(PERIODS.map((k, i) => [k, d[3 + i]]).filter(([, v]) => Number.isFinite(v)));
        out.set(t.id, { price: d[0], changePct: d[1], change: d[2], perf });
      }
    })());
  }
  for (const t of MARKET_TICKERS.filter(t => t.yahoo)) {
    jobs.push((async () => {
      const result = await yahooChart(t.yahoo, new Date(Date.now() - 380 * 864e5).toISOString().slice(0, 10), 'interval=1d');
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const points = (result?.timestamp ?? []).map((ts, i) => [dayOf(ts), closes[i]]).filter(p => p[1] != null);
      if (!points.length) return;
      const price = result.meta?.regularMarketPrice ?? points.at(-1)[1];
      // The last point is today's while the market is open or once it has closed.
      const prev = points.at(-1)[0] === dayOf(result.meta?.regularMarketTime ?? 0) ? points.at(-2)?.[1] : points.at(-1)[1];
      const change = prev ? price - prev : null;
      out.set(t.id, { price, change, changePct: prev ? change / prev * 100 : null, perf: pctFromStarts(price, seriesStarts(points)) });
    })());
  }
  const coins = MARKET_TICKERS.filter(t => t.coin);
  jobs.push((async () => {
    const res = await web(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${coins.map(t => t.coin).join(',')}&price_change_percentage=24h,7d,30d,1y`, { signal: timed() });
    if (!res.ok) throw new Error(`Crypto service answered ${res.status}`);
    for (const q of await res.json()) {
      const t = coins.find(x => x.coin === q.id);
      const price = q.current_price;
      if (!t || price == null) continue;
      const changePct = q.price_change_percentage_24h_in_currency ?? q.price_change_percentage_24h ?? null;
      const perf = Object.fromEntries([['5d', q.price_change_percentage_7d_in_currency], ['1m', q.price_change_percentage_30d_in_currency], ['1y', q.price_change_percentage_1y_in_currency]].filter(([, v]) => Number.isFinite(v)));
      out.set(t.id, { price, changePct, change: changePct == null ? null : price - price / (1 + changePct / 100), perf });
    }
    if (!coinLong) return;
    for (const t of coins) {
      const q = out.get(t.id);
      if (!q) continue;
      const long = await cryptoStarts(t.coin);
      if (!long) break;
      Object.assign(q.perf, pctFromStarts(q.price, long));
      q.long = true;
    }
  })());
  const results = await Promise.allSettled(jobs);
  if (!out.size) throw results.find(r => r.status === 'rejected')?.reason ?? new Error('No market data');
  return out;
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
  // Dates come as dd-mm-yyyy.
  const points = (nav.data ?? []).map(x => [x.date.split('-').reverse().join('-'), Number(x.nav)]);
  return { price, change, changePct: change == null ? null : change / Number(previous.nav) * 100, starts: seriesStarts(points), startsAt: Date.now() };
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
  // One call for every coin: today's price with its change over a day, week, month and year.
  const res = await web(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&ids=${[...ids.keys()].join(',')}&price_change_percentage=24h,7d,30d,1y&per_page=250`, { signal: timed() });
  if (!res.ok) throw new Error(`Crypto service answered ${res.status}`);
  const startFrom = (price, pct) => (Number.isFinite(pct) && pct > -100 ? price / (1 + pct / 100) : null);
  for (const q of await res.json()) {
    const symbol = ids.get(q.id);
    const price = q.current_price, changePct = q.price_change_percentage_24h_in_currency ?? q.price_change_percentage_24h ?? null;
    if (!symbol || price == null) continue;
    const starts = Object.fromEntries([['5d', q.price_change_percentage_7d_in_currency], ['1m', q.price_change_percentage_30d_in_currency], ['1y', q.price_change_percentage_1y_in_currency]]
      .map(([k, pct]) => [k, startFrom(price, pct)]).filter(([, v]) => v != null));
    quotes.set(symbol, { price, changePct, change: changePct == null ? null : price - price / (1 + changePct / 100), name: COINS[symbol.toUpperCase()]?.[1] ?? symbol, coinId: q.id, starts });
  }
  return quotes;
}

// The 6M and YTD start prices for one coin, from a year of daily prices. The free
// service limits how often it answers, so callers ask a few coins at a time and
// resolve to null when it says no.
export async function cryptoStarts(id, currency = 'inr') {
  const res = await web(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${currency}&days=365`, { signal: timed() }).catch(() => null);
  if (!res?.ok) return null;
  const chart = await res.json();
  if (!chart?.prices?.length) return null;
  const all = seriesStarts(chart.prices.map(([ms, v]) => [new Date(ms).toISOString().slice(0, 10), v]));
  return Object.fromEntries(['6m', 'ytd'].filter(k => all[k]).map(k => [k, all[k]]));
}
