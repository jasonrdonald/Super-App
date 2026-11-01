// The app's own grouping rules for the holdings grids. Funds and crypto have no
// company figures, so they sit together under FUNDS.

export const FUNDS = 'Funds and others';
export const UNRATED = 'Not rated';

const CRORE = 1e7;

const bands = (value, steps) => (value == null ? UNRATED : steps.find(([min]) => value >= min)?.[1]);

const average = list => {
  const known = list.filter(v => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

function qualityBand(l) {
  const tests = [
    l.roe == null ? null : l.roe >= 15,
    l.debtEquity == null ? null : l.debtEquity <= 1,
    l.netMargin == null ? null : l.netMargin >= 10,
    l.fcf == null ? null : l.fcf > 0,
  ].filter(t => t !== null);
  if (tests.length < 3) return UNRATED;
  const share = tests.filter(Boolean).length / tests.length;
  return share >= 0.75 ? 'High quality' : share >= 0.5 ? 'Medium quality' : 'Low quality';
}

export const GROUPINGS = {
  asset: { label: 'Asset type' },
  sector: { label: 'Sector', band: l => l.sector ?? UNRATED },
  cap: {
    label: 'Market cap',
    order: ['Large cap', 'Mid cap', 'Small cap', 'Micro cap'],
    rule: 'Large: ₹1,00,000 Cr or more. Mid: ₹30,000 Cr or more. Small: ₹5,000 Cr or more. Micro: below that.',
    band: l => bands(l.capInr ?? l.marketCap, [[1e5 * CRORE, 'Large cap'], [3e4 * CRORE, 'Mid cap'], [5e3 * CRORE, 'Small cap'], [-Infinity, 'Micro cap']]),
  },
  momentum: {
    label: 'Momentum',
    order: ['Strong', 'Positive', 'Weak', 'Falling'],
    rule: 'By 6-month return. Strong: +15% or more. Positive: 0 to +15%. Weak: 0 to -15%. Falling: below -15%.',
    band: l => bands(l.perf6m, [[15, 'Strong'], [0, 'Positive'], [-15, 'Weak'], [-Infinity, 'Falling']]),
  },
  quality: {
    label: 'Quality',
    order: ['High quality', 'Medium quality', 'Low quality'],
    rule: 'Four tests: ROE 15% or more, debt-to-equity 1 or less, net margin 10% or more, positive free cash flow. High passes 75% of those available, Medium 50%. Needs at least three.',
    band: qualityBand,
  },
  growth: {
    label: 'Growth',
    order: ['High growth', 'Moderate growth', 'Low growth', 'Declining'],
    rule: 'Average of revenue and EPS growth. High: 15% or more. Moderate: 5% or more. Low: 0 to 5%. Declining: below 0.',
    band: l => bands(average([l.revenueGrowth, l.epsGrowth]), [[15, 'High growth'], [5, 'Moderate growth'], [0, 'Low growth'], [-Infinity, 'Declining']]),
  },
};

// The group a holding falls in under `key`.
export function bandOf(key, line) {
  if (line.group !== 'Stocks' && line.group !== 'ETFs') return FUNDS;
  if (line.group === 'ETFs' && key !== 'sector') return FUNDS;
  return line.group === 'ETFs' ? FUNDS : GROUPINGS[key].band(line);
}

// Puts group names in reading order, with the catch-alls last.
export function orderBands(key, names) {
  const fixed = GROUPINGS[key].order;
  const rank = n => (n === UNRATED ? 1e3 : n === FUNDS ? 1e3 + 1 : fixed ? fixed.indexOf(n) : 0);
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
