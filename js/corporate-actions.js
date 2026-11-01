// Corporate actions Yahoo's split history doesn't carry: mergers, demergers,
// and the bonuses and ETF splits it leaves out. Everything else comes from Yahoo
// per ticker. `costShare` is the part of the cost that moves to the new company,
// as published on the demerger. Dates are ex-dates.

export const CORPORATE_ACTIONS = [
  // ETF unit splits, worked out from the jump in traded prices. Each date is only
  // known to fall between two trades, which is enough because these pay no dividends.
  { type: 'split', symbol: 'HNGSNGBEES', date: '2020-11-02', num: 10, den: 1, note: 'ETF unit split, date approximate' },
  { type: 'split', symbol: 'MON100', date: '2021-06-17', num: 10, den: 1, note: 'ETF unit split, date approximate' },
  { type: 'split', symbol: 'HDFCGOLD', date: '2023-03-01', num: 100, den: 1, note: 'ETF unit split, date approximate' },
  { type: 'split', symbol: 'HDFCNIFTY', date: '2023-03-01', num: 10, den: 1, note: 'ETF unit split, date approximate' },
  { type: 'bonus', symbol: 'BAJFINANCE', date: '2025-06-16', num: 5, den: 1, note: 'Bonus 4:1' },
  { type: 'merger', symbol: 'HDFC', to: 'HDFCBANK', date: '2023-07-13', num: 42, den: 25, note: 'HDFC Ltd merged into HDFC Bank' },
  { type: 'merger', symbol: 'TATAMTRDVR', to: 'TMPV', date: '2024-09-01', num: 7, den: 10, note: 'DVR shares converted to ordinary shares' },
  { type: 'demerger', symbol: 'ITC', to: 'ITCHOTELS', date: '2025-01-06', num: 1, den: 10, costShare: 0.1351, note: 'Hotels business demerged' },
  { type: 'demerger', symbol: 'RELIANCE', to: 'JIOFIN', date: '2023-07-20', num: 1, den: 1, costShare: 0.0468, note: 'Financial services demerged' },
  { type: 'demerger', symbol: 'SIEMENS', to: 'ENRIN', date: '2025-04-07', num: 1, den: 1, costShare: 0.2382, note: 'Energy business demerged' },
  { type: 'demerger', symbol: 'TMPV', to: 'TMCV', date: '2025-10-14', num: 1, den: 1, costShare: 0.3115, note: 'Commercial vehicles demerged' },
  { type: 'demerger', symbol: 'GE', to: 'GEV', date: '2024-04-02', num: 1, den: 4, costShare: 0.2026, note: 'GE Vernova spun off' },
];

// Yahoo lists these spin-offs as splits, but the share count didn't change.
export const NOT_SPLITS = [
  { symbol: 'GE', date: '2023-01-04' },
  { symbol: 'GE', date: '2024-04-02' },
];

// Rights issues and IPOs, from published offer terms. Brokers don't list these in
// tradebooks, so they're matched against what a holdings file is short by. No free
// source answers a browser, so new issues are added here or by hand on Reconcile.
export const PUBLIC_ISSUES = [
  { kind: 'ipo', symbol: 'ANGELONE', date: '2020-10-05', price: 306, lot: 49 },
  { kind: 'ipo', symbol: 'PAYTM', date: '2021-11-18', price: 2150, lot: 6 },
  { kind: 'ipo', symbol: 'SAPPHIRE', date: '2021-11-18', price: 1180, lot: 12 },
  { kind: 'ipo', symbol: 'JPL', date: '2026-10-28', price: 1119, lot: 12 },
  { kind: 'rights', symbol: 'RELIANCE', record: '2020-05-14', date: '2020-06-10', price: 1257, num: 1, den: 15 },
  { kind: 'rights', symbol: 'SOUTHBANK', record: '2024-02-27', date: '2024-04-05', price: 22, num: 1, den: 4 },
  { kind: 'rights', symbol: 'NATCOPHARM', record: '2026-10-01', date: '2026-10-27', price: 750, num: 2, den: 21 },
];
