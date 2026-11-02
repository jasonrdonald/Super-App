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

/* ---------- stock ratings ---------- */

// Each rating has a rank, highest best, a level for its colour, and a line of
// plain figures behind it. A null means there isn't enough data to say.
const away = (from, to) => Math.abs(to / from - 1) * 100;
const NEAR = 1.05;

export const RATING_SCALES = {
  momentum: {
    label: 'Momentum',
    rule: 'Where the price sits: within 5% of its all-time high or low, or its 52-week high or low. Neutral is anywhere between.',
    levels: ['All-time high', '52-week high', 'Neutral', '52-week low', 'All-time low'],
  },
  growth: {
    label: 'Growth',
    rule: 'Yearly growth over five years, in EPS, or revenue if any year made a loss. Exponential is 15% or more a year, both overall and over the last two years. Flat is within 3%. Degrowth exponential is falling 15% or more a year.',
    levels: ['Exponential', 'Linear', 'Flat', 'Degrowth linear', 'Degrowth exponential'],
  },
  valuation: {
    label: 'Valuation',
    rule: 'P/E against its sector\'s median. Undervalued is 20% or more below it, unless earnings are shrinking. Overvalued is 25% or more above it, unless P/E is under 1.5 times growth. Losses, and a P/E under 3, usually a one-off gain, aren\'t rated.',
    levels: ['Undervalued', 'Fair value', 'Overvalued'],
  },
  profitability: {
    label: 'Profitability',
    rule: 'Great is ROE of 20% or more with a net margin of 10% or more. Good is ROE of 12% or more. Avg is any other profit. A loss is Not profitable, or Burning cash if free cash flow is negative too.',
    levels: ['Great', 'Good', 'Avg', 'Not profitable', 'Burning cash'],
  },
};

const rated = (scale, level, note) => {
  const levels = RATING_SCALES[scale].levels;
  return { label: level, note, rank: levels.length - levels.indexOf(level), step: levels.indexOf(level), count: levels.length };
};

export function momentumRating(l) {
  const { price, allHigh, allLow, high52, low52 } = l;
  if (price == null || high52 == null || low52 == null) return null;
  const below = high => `${away(high, price).toFixed(0)}% below high`;
  if (allHigh != null && price * NEAR >= allHigh) return rated('momentum', 'All-time high', below(allHigh));
  if (allLow != null && price <= allLow * NEAR) return rated('momentum', 'All-time low', `${away(allLow, price).toFixed(0)}% above low`);
  if (price * NEAR >= high52) return rated('momentum', '52-week high', below(high52));
  if (price <= low52 * NEAR) return rated('momentum', '52-week low', `${away(low52, price).toFixed(0)}% above low`);
  return rated('momentum', 'Neutral', below(high52));
}

export function growthRating(l) {
  const { gCagr, gRecent, gBasis } = l;
  if (gCagr == null) return null;
  const note = `${gBasis} ${gCagr > 0 ? '+' : ''}${gCagr.toFixed(0)}% a year`;
  if (Math.abs(gCagr) < 3) return rated('growth', 'Flat', note);
  if (gCagr <= -15) return rated('growth', 'Degrowth exponential', note);
  if (gCagr < 0) return rated('growth', 'Degrowth linear', note);
  return rated('growth', gCagr >= 15 && gRecent >= 15 ? 'Exponential' : 'Linear', note);
}

export function valuationRating(l, sectorPe) {
  // A P/E under 3 usually comes from a one-off gain, so it says nothing about value.
  if (!(l.pe >= 3) || !sectorPe) return null;
  const note = `P/E ${l.pe.toFixed(0)}, sector ${sectorPe.toFixed(0)}`;
  const gap = l.pe / sectorPe;
  if (gap <= 0.8 && !(l.gCagr < 0)) return rated('valuation', 'Undervalued', note);
  if (gap >= 1.25 && !(l.gCagr > 0 && l.pe / l.gCagr < 1.5)) return rated('valuation', 'Overvalued', note);
  return rated('valuation', 'Fair value', note);
}

export function profitabilityRating(l) {
  const { eps, netMargin, roe, fcf } = l;
  if (eps == null && netMargin == null) return null;
  if (eps < 0 || netMargin < 0) {
    return fcf < 0 ? rated('profitability', 'Burning cash', 'Loss, and cash flow negative') : rated('profitability', 'Not profitable', 'Making a loss');
  }
  const note = roe == null ? 'ROE not reported' : `ROE ${roe.toFixed(0)}%`;
  if (roe >= 20 && netMargin >= 10) return rated('profitability', 'Great', note);
  return rated('profitability', roe >= 12 ? 'Good' : 'Avg', note);
}

// Puts group names in reading order, with the catch-alls last.
export function orderBands(key, names) {
  const fixed = GROUPINGS[key].order;
  const rank = n => (n === UNRATED ? 1e3 : n === FUNDS ? 1e3 + 1 : fixed ? fixed.indexOf(n) : 0);
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
