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
  nseIndices: {
    name: 'NSE daily index closing file, relayed by Jina Reader', url: 'https://www.nseindia.com/', format: 'CSV, inside a text wrapper from the relay',
    timing: 'Published each trading evening. Checked again after 6 hours',
    note: 'The latest file, plus one month-end file a month back to your first purchase.',
  },
  epfPassbook: {
    name: 'Your EPF passbook PDFs, from the EPFO member portal', url: 'https://passbook.epfindia.gov.in/', format: 'PDF, loaded by you',
    timing: 'As of the passbook you loaded',
    note: 'Read on this device. Only the employer, the member ID\'s last four digits and the amounts are kept.',
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

// The public data backup: a folder for each market, one file a month, and what
// each file holds with the source it came from. The app's own Data sources page
// and the files themselves both read this.
const STOCK_FILE = [
  ['Monthly open and close, in today\'s share units', 'yahoo'],
  ['Dividends and splits', 'yahoo'],
  ['Latest price and day change', 'tradingview'],
  ['Names, sector, fundamentals, momentum and yearly EPS', 'tradingviewFundamentals'],
];

export const BACKUP_FILES = [
  { id: 'india-stocks', label: 'Indian stocks and ETFs', parts: STOCK_FILE },
  { id: 'us-stocks', label: 'US stocks and ETFs', parts: STOCK_FILE },
  { id: 'crypto', label: 'Crypto', parts: [['Monthly open and close, in rupees', 'yahoo'], ['Latest price and day change', 'coingecko']] },
  { id: 'mutual-funds', label: 'Mutual funds', parts: [['Each month\'s first and last NAV', 'mfapi'], ['Latest NAV and scheme code', 'mfapi']] },
  { id: 'fx', label: 'Currency rates', parts: [['Latest USD to INR rate', 'tradingview']] },
  { id: 'indices', label: 'Benchmark indices', parts: [['Monthly open and close of Nifty 50, Next 50, Midcap 150, Smallcap 250, Nifty 500, Nasdaq 100 and S&P 500', 'yahoo'], ['Latest close, P/E, P/B and dividend yield of Nifty indices', 'nseIndices'], ['Nifty index P/E and P/B at each month-end, under IX:pe', 'nseIndices']] },
];

export const backupSources = id => Object.fromEntries(BACKUP_FILES.find(f => f.id === id).parts.map(([what, source]) => [what, SOURCES[source].name]));

// Everything a backup keeps, how much of it, and the field it sits under in a month file.
export const BACKUP_CONTENTS = [
  ['Monthly open and close, including benchmark indices', 'Full history', 'prices'],
  ['Dividends', 'Full history, by month paid', 'dividends'],
  ['Splits', 'Full history, by month of the split', 'splits'],
  ['Latest price and day change, including fund NAVs and crypto', 'Latest only', 'quotes'],
  ['USD to INR rate', 'Latest only', 'quotes, in the fx folder'],
  ['Names and mutual fund scheme codes', 'Latest only', 'quotes'],
  ['Sector, industry and market cap', 'Latest only', 'quotes'],
  ['EPS, P/E, P/B, P/S, EV/EBITDA and dividend yield', 'Latest only', 'quotes'],
  ['ROE, ROCE, ROIC, ROA and margins', 'Latest only', 'quotes'],
  ['Debt-to-equity, current ratio, free cash flow, Piotroski score, payout and beta', 'Latest only', 'quotes'],
  ['Revenue, EPS and profit growth', 'Latest only', 'quotes'],
  ['Yearly EPS of each Indian stock, adjusted for splits', 'Full history, by financial year-end', 'prices, under EP'],
  ['52-week and all-time range, returns, RSI and 200-day average', 'Latest only', 'quotes'],
  ['Five-year growth rates and median P/E by sector', 'Latest only', 'quotes, with sector P/Es in the indices folder'],
  ['Nifty index P/E, P/B and dividend yield', 'Latest only', 'quotes, in the indices folder'],
  ['Nifty index P/E and P/B at each month-end', 'Full history, from your first purchase', 'prices, in the indices folder'],
];

export const BACKUP_LEAVES_OUT = [
  'Exchange ticker lists and the mutual fund scheme list, so a new broker file in Local backup mode only matches tickers already on this device.',
  'Anything you\'ve never held, as only your own tickers are downloaded.',
  'Daily prices, and past values of anything marked Latest only.',
  'Tickers the sources have no monthly prices for. Past market value estimates those between cost and today\'s price.',
];

export const BACKUP_NEEDS_NOTHING = 'Bonuses, mergers, demergers, and rights and IPO prices are built into the app, so they work in every mode.';

// id, label, the sources behind it, and how it's worked out when that isn't obvious.
export const DATA_POINTS = [
  { id: 'price', label: 'Last price, market value, day gain', sources: ['tradingview', 'mfapi', 'coingecko'], how: 'Indian and US stocks and ETFs from TradingView, funds from MFapi.in, crypto from CoinGecko. Falls back to the holdings file\'s price.' },
  { id: 'fx', label: 'USD to INR rate', sources: ['tradingview'], how: 'The latest rate converts all USD figures on the main Portfolio and Consolidated pages, including cost, so they show today\'s rupee value, not the rate you bought at.' },
  { id: 'gain', label: 'Total gain, unrealized gain', sources: ['app', 'tradingview', 'mfapi', 'coingecko'], how: 'Market value less your cost.' },
  { id: 'names', label: 'Stock names and ticker matching', sources: ['tradingview'], how: 'HDFC reports give only company names, matched against the NSE and BSE lists.' },
  { id: 'dividends', label: 'Dividend income', sources: ['yahoo', 'app'], how: 'Each dividend per share times the shares you held the day before its ex-date. Before tax, so US dividends show more than you received after withholding.' },
  { id: 'xirr', label: 'XIRR', sources: ['app', 'broker', 'yahoo', 'tradingview'], how: 'Annual return on dated cash flows: each lot\'s cost, sale proceeds, dividends before tax, and today\'s value. Holdings under a year are annualised, so short periods can look extreme.' },
  { id: 'capitalGains', label: 'Capital gains report', sources: ['broker', 'app'], how: 'Sells matched to buys, oldest first. Long term is over 12 months, or over 24 for US shares. Same-day trades are intraday. Excludes charges and does not apply tax rules such as debt fund treatment, so it is not a tax computation.' },
  { id: 'performance', label: 'Performance report', sources: ['broker', 'yahoo', 'app'], how: 'Your XIRR, against what the same cash flows on the same dates would have made in each index. Index values on a date are read between that month\'s open and close. On the chart, a shorter period restarts each index from your value on its first month, and prices are monthly, so 1M runs from the last month-end. Indices are price indices, so they leave out dividends, while your return includes them. US indices are in dollars, so they leave out rupee moves. Nifty Midcap 150 history starts in January 2019, and earlier money counts from then. Commodities and crypto are left out.' },
  { id: 'performers', label: 'Top and worst performers', sources: ['broker', 'app', 'tradingview'], how: 'Stocks held today, combined across brokers. Total return is price gain, realized gain and dividends, divided by all the money put into that stock. Share of total return can pass 100%, as losses elsewhere reduce the total.' },
  { id: 'metrics', label: 'Metrics report', sources: ['tradingviewFundamentals', 'nseIndices', 'yahoo', 'mfapi', 'app'], how: 'Indian stocks held today, without ETFs. Your P/E is total value over total earnings in each market cap band, so loss-makers lower the earnings. The app\'s bands use market cap, while each index picks its own stocks, so the match is close, not exact. Your earnings are trailing diluted EPS, and NSE works out index P/E its own way. P/E when you bought is what you paid for the lots you still hold, over their EPS for the last financial year ended before each purchase, adjusted for splits. Results come out a month or two after a year ends, so this can use figures not yet published when you bought. The index figure uses its P/E at the end of the month you bought. Volatility is the spread of monthly open-to-close returns, times the square root of 12, for holdings held from each month\'s start. Alpha is your XIRR on a stock less the same cash flows in the index for its market cap, which is Nifty 50, Midcap 150 or Smallcap 250, as Microcap 250 has no monthly history. It does not adjust for risk.' },
  { id: 'ratings', label: 'Rating report', sources: ['tradingviewFundamentals', 'tradingview', 'app'], how: 'The app\'s own rules applied to public figures, not ratings from any source and not advice. Returns and highs and lows are from TradingView. Growth uses five years of yearly EPS, or revenue if a year made a loss. Valuation compares P/E with the median of NSE stocks above ₹500 Cr in the same sector. The verdict is a fixed weighted score of those four ratings, shown on the report. It is not investment advice and takes no account of your goals, tax position or purchase price. Each rating shows its rule on the report.' },
  { id: 'goals', label: 'Milestones', sources: ['app'], how: 'Today\'s portfolio value grown month by month at a steady yearly return, plus a monthly investment that rises each year by the step-up. Added a month is the change in what you held at cost over the past year, divided by 12. Real returns vary, so dates are rough guides, not a forecast or advice.' },
  { id: 'epf', label: 'EPF balances, contributions and interest', sources: ['epfPassbook', 'app'], how: 'Read from each year\'s passbook and checked against its printed closing balance. Effective rate is the year\'s interest over its average month-end balance. Interest building up in the current year is an estimate at last year\'s effective rate, as EPFO credits it after March.' },
  { id: 'publicData', label: 'Public data source', sources: ['tradingview', 'yahoo', 'mfapi', 'coingecko'], how: 'Set on the Data sources page. Internet downloads everything. Local backup downloads nothing and uses imported files, so figures stop at the backup\'s date. Hybrid downloads recent months and today\'s prices, and keeps older months from the backup. If a split happens later, older backup months are rescaled to match.' },
  { id: 'timeline', label: 'Timeline report', sources: ['broker', 'app', 'yahoo', 'mfapi'], how: 'Invested is the cost of what you held at each date, from your trades, with USD at today\'s rate. Past market value appears only when switched on, and is an estimate: shares held at each month\'s end times that month\'s close, from Yahoo for stocks, ETFs and crypto, and MFapi.in for funds. A held item with no price for a month is taken as moving steadily from its cost to today\'s price, and a sold one counts at cost. Those monthly prices stay on this device, go in the public data backup rather than broker backups, and refresh weekly. Highlights are picked from your trades, dividends, transfers and corporate actions, and start from your earliest loaded file.' },
  { id: 'fees', label: 'Fees and charges', sources: ['broker'], how: 'Taken from broker files that show them. Aionion Capital charges are net value less trade value. Coins deducted are valued at their FIFO cost. Network fees are entered on each transfer.' },
  { id: 'earn', label: 'Crypto Earn contracts and rewards', sources: ['broker', 'coingecko'], how: 'Contracts and rates from your Zebpay files. Coins locked in Earn still count as holdings. Earnings in rupees are valued at today\'s price, not the price when credited.' },
  { id: 'yieldOnCost', label: 'Dividend yield on cost', sources: ['yahoo', 'app'], how: 'On summaries and grids: dividends in the last 12 months divided by the cost of what you hold now. In the Dividend report: dividends in the period divided by the amount invested up to its end, net of shares sold by then.' },
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
  { id: 'assetGroups', label: 'Stocks, ETFs, Commodities and Debt', sources: ['broker', 'tradingview'], how: 'A fund\'s ISIN, scanner type or broker file marks it as an ETF or mutual fund. Its name then decides the group: gold, silver or commodity goes to Commodities; bond, gilt, G-Sec, government securities, liquid, debt, treasury, T-bill, overnight, money market, a duration category, credit risk or floating rate goes to Debt. Hybrid and equity funds, and all others, stay as ETFs or Mutual funds.' },
  { id: 'groups', label: 'Market cap, momentum, quality and growth groups', sources: ['app', 'tradingviewFundamentals'], how: 'Rules listed below. These are the app\'s own labels, not ratings from any source.' },
];
