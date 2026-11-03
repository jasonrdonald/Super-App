// NPS: reading a Tier I transaction statement CSV from the CRA, and the sums
// behind its page. Only the PRAN's last four digits, the schemes and the money
// are kept: never the subscriber's name.

const amount = s => {
  const clean = String(s ?? '').replace(/Rs|,|\s/g, '');
  if (!clean) return null;
  const neg = /^\(.*\)$/.test(clean);
  const n = Number(clean.replace(/[()]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const isoDay = s => {
  const m = String(s).match(/(\d\d)-([A-Z][a-z]{2})-(\d{4})/);
  return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null;
};
const longDate = s => {
  const m = String(s).match(/([A-Z][a-z]+) (\d\d) (\d{4})/);
  return m ? `${m[3]}-${MONTHS[m[1].slice(0, 3)]}-${m[2]}` : null;
};
const SCHEME_NAMES = { E: 'Equity (E)', C: 'Corporate bonds (C)', G: 'Government bonds (G)', A: 'Alternative assets (A)' };
export const schemeName = letter => SCHEME_NAMES[letter] ?? `Scheme ${letter}`;
const schemeOf = name => ({ letter: name.match(/SCHEME ([A-Z])\b/)?.[1] ?? '?', route: /\bDIRECT\b/.test(name) ? 'Direct' : /\bPOP\b/.test(name) ? 'POP' : '', fund: name.match(/A\/C (.+?) (?:LIMITED )?SCHEME/)?.[1]?.replace(/MANAGEMENT/, 'Management').replace(/\b(\w)(\w*)/g, (w, a, b) => a + b.toLowerCase()) ?? '' });

// One statement: its summary, scheme holdings, contributions and every scheme's
// transactions. Throws if the file isn't an NPS transaction statement.
export function parseStatement(text) {
  if (!/NPS Transaction Statement/.test(text)) throw new Error('This isn\'t an NPS transaction statement');
  const rows = text.replace(/\r/g, '').split('\n');
  const pran = text.match(/PRAN,'?(\d{12})/)?.[1] ?? '';
  const tier = text.match(/Statement for (Tier [I]+)/)?.[1] ?? 'Tier I';
  const choice = text.match(/Scheme Choice - (.+)/)?.[1].trim() ?? '';
  const asOf = longDate(text.match(/Value of your Holdings\(Investments\)as on ([A-Za-z]+ \d\d \d{4})/)?.[1]);
  const xirr = amount(text.match(/Return on Investment\(XIRR\),\s*([\d.-]+)%/)?.[1]);
  const totals = rows.find(r => /^Rs [\d.]+,\d+,Rs /.test(r))?.split(',') ?? [];
  if (!asOf || !totals.length) throw new Error('Couldn\'t find the summary in this statement');

  const holdings = [];
  const navDate = isoDay(text.match(/NAV as on (\d\d-[A-Z][a-z]{2}-\d{4})/)?.[1]);
  let i = rows.findIndex(r => /^Particulars,Scheme wise Value/.test(r)) + 1;
  for (; i > 0 && /SCHEME [A-Z]/.test(rows[i]); i++) {
    const cells = rows[i].split(',');
    const s = schemeOf(cells[0]);
    holdings.push({ scheme: s.letter, route: s.route, fund: s.fund, value: amount(cells[1]), units: amount(cells[2]), nav: amount(cells[3]) });
  }

  const contributions = [];
  const head = rows.findIndex(r => /^Date,Particulars,Uploaded By/.test(r));
  for (let k = head + 1; head >= 0 && k < rows.length && !/Transaction Details/.test(rows[k]); k++) {
    const cells = rows[k].split(',');
    const date = isoDay(cells[0]);
    if (!date) continue;
    contributions.push({ date, note: cells[1].trim(), via: cells[2].replace(/\s*\(\d+\)/, '').trim(), employee: amount(cells[3]) ?? 0, employer: amount(cells[4]) ?? 0, total: amount(cells[5]) ?? 0 });
  }

  // Descriptions can hold commas, so a row is its date, the last three figures, and everything between.
  const transactions = [];
  const opening = {}, closing = {};
  let scheme = null;
  for (const row of rows.slice(rows.findIndex(r => /Transaction Details/.test(r)) + 1)) {
    if (/SCHEME [A-Z]/.test(row) && !/^\d\d-/.test(row)) { scheme = schemeOf(row); continue; }
    const cells = row.split(',');
    const date = isoDay(cells[0]);
    if (!date || !scheme || cells.length < 5) continue;
    const description = cells.slice(1, -3).join(',').trim();
    const [value, nav, units] = cells.slice(-3).map(amount);
    const key = `${scheme.letter}-${scheme.route}`;
    if (/Opening balance/i.test(description)) { opening[key] = units ?? 0; continue; }
    if (/Closing Balance/i.test(description)) { closing[key] = units ?? 0; continue; }
    transactions.push({ date, scheme: scheme.letter, route: scheme.route, description: description || 'Contribution', amount: value ?? 0, nav: nav ?? 0, units: units ?? 0 });
  }

  // Each scheme's units should run from its opening balance to its closing one.
  const moved = key => transactions.filter(t => `${t.scheme}-${t.route}` === key).reduce((n, t) => n + t.units, 0);
  const matches = Object.keys(closing).length > 0 && Object.keys(closing).every(key => Math.abs((opening[key] ?? 0) + moved(key) - closing[key]) < 0.001);

  return {
    pranTail: pran.slice(-4), matches, tier, choice, asOf, navDate, xirr,
    value: amount(totals[0]), count: Number(totals[1]) || 0, contributed: amount(totals[2]), withdrawn: amount(totals[3]), gain: amount(totals[4]), charges: amount(totals[5]),
    holdings, contributions, transactions,
  };
}

// What a transaction is, in plain words.
export function transactionKind(t) {
  const d = t.description;
  if (/Billing/i.test(d)) return 'Charges';
  if (/Rebalancing|Switch/i.test(d)) return 'Rebalancing';
  if (/Dormancy|Scheme change|Credit of units/i.test(d)) return 'Moved to Direct';
  if (/Contribution/i.test(d) || (!/[A-Za-z]/.test(d.replace('Contribution', '')) && t.amount > 0)) return 'Contribution';
  return t.amount < 0 ? 'Deduction' : 'Credit';
}

// The latest statement, every statement's summary by date, and the charges and contributions on record.
export function npsSummary(statements, entries) {
  const list = [...statements].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const latest = list.at(-1);
  if (!latest) return null;
  const contributions = entries.filter(e => e.kind === 'nps-contribution').sort((a, b) => b.date.localeCompare(a.date));
  const txns = entries.filter(e => e.kind === 'nps-transaction');
  const charges = txns.filter(t => transactionKind(t) === 'Charges').reduce((n, t) => n - t.amount, 0);
  const total = latest.holdings.reduce((n, h) => n + h.value, 0) || latest.value;
  return {
    latest, statements: list, contributions, txns, charges,
    mix: latest.holdings.map(h => ({ ...h, share: total ? h.value / total * 100 : 0 })),
    lastContribution: contributions[0] ?? null,
  };
}

/* ---------- stored shapes ---------- */

const text = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = v => (Number.isFinite(v) ? v : 0);
const isDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

export function cleanNpsAccount(x) {
  return {
    id: text(x.id, 60), kind: 'nps', name: text(x.name, 80) || 'NPS', tier: text(x.tier, 20), choice: text(x.choice, 80),
    pranTail: String(x.pranTail ?? '').replace(/\D/g, '').slice(-4), createdAt: finite(x.createdAt), updatedAt: finite(x.updatedAt),
  };
}

export function cleanNpsStatement(x) {
  if (!x?.id || !x.accountId || !isDate(x.asOf)) return null;
  return {
    id: text(x.id, 80), accountId: text(x.accountId, 60), kind: 'nps', asOf: x.asOf, navDate: isDate(x.navDate) ? x.navDate : null,
    xirr: Number.isFinite(x.xirr) ? x.xirr : null, value: finite(x.value), count: finite(x.count), contributed: finite(x.contributed),
    withdrawn: finite(x.withdrawn), gain: finite(x.gain), charges: finite(x.charges), choice: text(x.choice, 80), matches: x.matches === true,
    holdings: (Array.isArray(x.holdings) ? x.holdings : []).slice(0, 8).map(h => ({ scheme: text(h.scheme, 2), route: text(h.route, 10), fund: text(h.fund, 80), value: finite(h.value), units: finite(h.units), nav: finite(h.nav) })),
    updatedAt: finite(x.updatedAt),
  };
}

export function cleanNpsEntry(x) {
  if (!x?.id || !x.accountId || !isDate(x.date)) return null;
  const base = { id: text(x.id, 200), accountId: text(x.accountId, 60), date: x.date, updatedAt: finite(x.updatedAt) };
  if (x.kind === 'nps-contribution') return { ...base, kind: 'nps-contribution', note: text(x.note, 80), via: text(x.via, 60), employee: finite(x.employee), employer: finite(x.employer), total: finite(x.total) };
  return { ...base, kind: 'nps-transaction', scheme: text(x.scheme, 2), route: text(x.route, 10), description: text(x.description, 200), amount: finite(x.amount), nav: finite(x.nav), units: finite(x.units) };
}
