// Some brokers give only company names, and spell them differently in each file.
// This finds the ticker from the exchange's own list of names. A holdings file
// also gives the last price, which settles close calls.

const NOISE = new Set(['LTD', 'LIMITED', 'LIMI', 'LI', 'CO', 'COMPANY', 'CORPN', 'CORPORATION', 'THE', 'OF', 'AND', 'I', 'INDIA',
  'MUTUAL', 'FUND', 'ETF', 'EXCHANGE', 'TRADED', 'UNITS', 'OPEN', 'ENDED', 'MOST', 'SHARES', 'BEES', 'MAHINDRA']);

// Names that stopped trading, so no list has them any more.
const DELISTED = { 'HOUSING DEVELOPMENT FINANCE CORPORATION': 'HDFC' };

// Holdings names carry the share class after the company, e.g. "... EQ NEW FV RS.2/-".
export const companyPart = name => name.toUpperCase().replace(/\s+EQ(\s.*)?$/, '').replace(/\s+/g, ' ').trim();

function tokens(name) {
  const clean = companyPart(name).replace(/&/g, ' ').replace(/[^A-Z0-9 ]+/g, ' ').replace(/([A-Z])(\d)/g, '$1 $2');
  return clean.split(/\s+/).filter(w => w && !NOISE.has(w));
}

function score(a, b) {
  const set = new Set(b);
  const shared = a.filter(w => set.has(w)).length;
  return shared / Math.max(a.length, b.length, 1);
}

const CLOSE_PRICE = 0.015;

// `list` holds { symbol, name, isin, close, fund }. Resolves a name to one of its
// entries, or null when nothing is close enough to trust.
export function findTicker(name, list, price) {
  const wanted = tokens(name);
  if (!wanted.length) return null;
  const ranked = list
    .map(x => ({ x, s: score(wanted, x.words ??= tokens(x.name)) }))
    .filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s);
  if (price) {
    // A holding with the right price needs only a partial name match.
    const hit = ranked.find(r => Math.abs(r.x.close - price) / price < CLOSE_PRICE && r.s >= 0.3);
    return hit?.x ?? null;
  }
  const best = ranked[0];
  return best && best.s >= 0.75 && best.s > (ranked[1]?.s ?? 0) ? best.x : null;
}

// The ticker for a name, falling back to the delisted list.
export function tickerFor(name, list, price) {
  const delisted = DELISTED[companyPart(name)];
  if (delisted) return { symbol: delisted, isin: '' };
  return findTicker(name, list, price);
}
