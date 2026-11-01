// Every outside source of data in the app, and which figures come from where.
// The Disclosure page and the info icons both read this, so they can't disagree.

export const SOURCES = {
  tradingview: {
    name: 'TradingView stock scanner', url: 'https://www.tradingview.com/', format: 'JSON',
    timing: 'Delayed about 15 minutes in market hours, the last close after them',
    note: 'A public endpoint with no contract, so it may change without notice.',
  },
  tradingviewFundamentals: {
    name: 'TradingView stock scanner', url: 'https://www.tradingview.com/', format: 'JSON',
    timing: 'Latest reported results: updated quarterly or yearly, with prices delayed about 15 minutes',
    note: 'Where trailing figures are missing, the last full-year figure is used.',
  },
  yahoo: {
    name: 'Yahoo Finance, relayed by Jina Reader (AllOrigins as backup)', url: 'https://finance.yahoo.com/', format: 'JSON, inside a text or JSON wrapper from the relay',
    timing: 'Overnight. Loaded in the background and checked again after 7 days',
    note: 'Yahoo refuses browsers directly, so a relay fetches it. Dividends are in today\'s share units.',
  },
  mfapi: {
    name: 'MFapi.in (AMFI NAV data)', url: 'https://www.mfapi.in/', format: 'JSON',
    timing: 'Overnight: the latest published daily NAV',
    note: 'The scheme list is matched by ISIN.',
  },
  coingecko: {
    name: 'CoinGecko', url: 'https://www.coingecko.com/', format: 'JSON',
    timing: 'Near real time, within a few minutes',
    note: 'Day change is over the last 24 hours.',
  },
  offerDocuments: {
    name: 'Published offer terms (Chittorgarh, exchange notices, press reports)', url: 'https://www.chittorgarh.com/', format: 'HTML pages, entered into the app by hand',
    timing: 'Static: fixed when the issue happened, and only updated with the app',
    note: 'No free source answers a browser, so new issues are added to the app or entered on Reconcile.',
  },
  curated: {
    name: 'Company announcements and traded prices', url: '', format: 'Entered into the app by hand',
    timing: 'Static: only updated with the app',
    note: 'ETF split dates are approximate, worked out from jumps in traded prices.',
  },
  broker: {
    name: 'Your broker\'s files', url: '', format: 'XLSX or CSV, loaded by you',
    timing: 'As of the file you loaded',
    note: 'Not public data. These stay on your device.',
  },
  app: {
    name: 'Calculated in the app', url: '', format: 'Not applicable',
    timing: 'Recalculated from the sources above',
    note: '',
  },
};

// id, label, the sources behind it, and how it's worked out when that isn't obvious.
export const DATA_POINTS = [
  { id: 'price', label: 'Last price, market value, day gain', sources: ['tradingview', 'mfapi', 'coingecko'], how: 'Stocks and ETFs from TradingView, funds from MFapi.in, crypto from CoinGecko. Falls back to the holdings file\'s price.' },
  { id: 'gain', label: 'Total gain, unrealized gain', sources: ['app', 'tradingview', 'mfapi', 'coingecko'], how: 'Market value less your cost.' },
  { id: 'names', label: 'Stock names and ticker matching', sources: ['tradingview'], how: 'HDFC reports give only company names, matched against the NSE and BSE lists.' },
  { id: 'dividends', label: 'Dividend income', sources: ['yahoo', 'app'], how: 'Each dividend per share times the shares you held the day before its ex-date.' },
  { id: 'yieldOnCost', label: 'Dividend yield on cost', sources: ['yahoo', 'app'], how: 'Dividends received in the last 12 months divided by the cost of what you hold now.' },
  { id: 'splits', label: 'Splits and bonuses', sources: ['yahoo', 'curated'], how: 'From Yahoo, with bonuses and ETF splits it misses added by hand.' },
  { id: 'mergers', label: 'Mergers and demergers', sources: ['curated'], how: 'Ratios and cost shares as published.' },
  { id: 'issues', label: 'Rights issue and IPO prices', sources: ['offerDocuments'], how: 'Applied only when the shares fit your holdings exactly.' },
  { id: 'funds', label: 'Mutual fund NAV', sources: ['mfapi'] },
  { id: 'crypto', label: 'Crypto prices', sources: ['coingecko'] },
  { id: 'holdings', label: 'Trades, quantities and broker cost', sources: ['broker'] },
  { id: 'realized', label: 'Realized gain', sources: ['broker', 'app'], how: 'Sells matched to buys, oldest first.' },
  { id: 'fundamentals', label: 'EPS, P/E, P/B, P/S, EV/EBITDA, dividend yield', sources: ['tradingviewFundamentals'], how: 'Trailing 12 months.' },
  { id: 'profitability', label: 'ROE, ROCE, ROIC, ROA, margins', sources: ['tradingviewFundamentals'], how: 'Trailing where reported, else the last full year. ROCE is the last full year.' },
  { id: 'quality', label: 'Debt-to-equity, current ratio, free cash flow, Piotroski score, payout, beta', sources: ['tradingviewFundamentals'], how: 'Trailing where reported, else the last full year.' },
  { id: 'growth', label: 'Revenue, EPS and profit growth', sources: ['tradingviewFundamentals'], how: 'Trailing 12 months against the 12 months before.' },
  { id: 'momentum', label: '52-week range, returns, RSI, moving averages', sources: ['tradingview'], how: 'From traded prices.' },
  { id: 'sector', label: 'Sector, industry, market cap', sources: ['tradingviewFundamentals'] },
  { id: 'groups', label: 'Market cap, momentum, quality and growth groups', sources: ['app', 'tradingviewFundamentals'], how: 'Rules listed below. These are the app\'s own labels, not ratings from any source.' },
];
