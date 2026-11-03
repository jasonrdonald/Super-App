// EPF passbooks: reading a year's statement out of the PDF's text, and the sums
// behind the Retirals pages. Only the employer's name, the last four digits of
// the member ID and the money are kept: never the name, birth date or UAN.

const amount = s => Number(String(s).replace(/,/g, '')) || 0;
const triple = (a, b, c) => [amount(a), amount(b), amount(c)];
const isoDate = d => d.split(/[-/]/).reverse().join('-');
const monthNames = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const wageMonth = s => `${s.slice(4)}-${monthNames[s.slice(0, 3)] ?? '01'}`;

const NUM = '([\\d,]+)';
const ROW = new RegExp(`^([A-Z][a-z]{2}-\\d{4}) (\\d\\d-\\d\\d-\\d{4}) (CR|DR)\\s*(.*?)\\s*${NUM} ${NUM} ${NUM} ${NUM} ${NUM}$`);
const BALANCES = `${NUM}\\s+${NUM}\\s+${NUM}`;

// What a withdrawal was for, by the paragraph of the EPF Scheme it was claimed under.
const CLAIM_PURPOSE = [
  [/68BD/, 'Housing loan or EMI'], [/68BB/, 'House repair or addition'], [/68B/, 'Buying or building a house'],
  [/68J/, 'Illness'], [/68K/, 'Marriage or education'], [/68NN/, 'Before retirement'], [/68N/, 'Equipment for a disability'],
  [/68M/, 'Natural calamity'], [/68L/, 'Outbreak or pandemic'], [/69/, 'Final settlement'],
];

function describe(kind, text) {
  if (kind === 'contribution') return 'Monthly contribution';
  if (kind === 'transfer') return /INTEREST/i.test(text) ? 'Interest moved from your previous PF account' : 'Moved from your previous PF account';
  if (kind === 'withdrawal') {
    const para = text.match(/PARA\s*([\w()]+)/i)?.[1] ?? '';
    const purpose = CLAIM_PURPOSE.find(([re]) => re.test(para))?.[1];
    return purpose ? `Withdrawal: ${purpose}${para ? `, para ${para}` : ''}` : `Withdrawal${para ? `, para ${para}` : ''}`;
  }
  // Member IDs from an old employer are dropped, along with any other long code.
  return text.replace(/\(?\s*Old Member Id-?\s*:?\s*[A-Z0-9]*\s*\)?/gi, '').replace(/\b[A-Z]{5}\d{6,}\b/g, '').trim() || 'Other entry';
}

// One financial year's passbook, from the lines of its PDF. Throws if the text
// isn't an EPF passbook, and reports whether its own sums agree with its totals.
export function parsePassbook(lines) {
  const all = lines.join('\n');
  const fy = all.match(/Financial Year - (\d{4})-(\d{4})/);
  if (!fy) throw new Error('This isn\'t an EPF passbook');
  const employer = all.match(/Establishment ID\/Name\s+\S+\s*\/\s*(.+)/)?.[1].trim() ?? '';
  const memberTail = all.match(/Member ID\/Name\s+([A-Z0-9]+)/)?.[1].slice(-4) ?? '';
  const opening = all.match(new RegExp(`OB Int\\. Updated upto \\S+\\s+${BALANCES}`));
  const interest = all.match(new RegExp(`(?<!OB )Int\\. Updated upto (\\d\\d/\\d\\d/\\d{4})\\s+${BALANCES}`));
  const closing = all.match(new RegExp(`Closing Balance as on (\\d\\d/\\d\\d/\\d{4})\\s+${BALANCES}`));
  const total = label => {
    const m = all.match(new RegExp(`Total ${label} for the year \\[ \\d{4} \\]\\s+${BALANCES}`));
    return m ? triple(m[1], m[2], m[3]) : [0, 0, 0];
  };
  if (!opening || !closing) throw new Error('Couldn\'t find the balances in this passbook');

  // A row's figures share a line with its date. Its description sits on the
  // line above, and a wrapped tail on the lines below.
  const start = lines.findIndex(l => /OB Int\. Updated/.test(l));
  const stop = lines.findIndex((l, i) => i > start && /^Total Contributions/.test(l));
  const body = lines.slice(start + 1, stop < 0 ? undefined : stop);
  const rows = [];
  let pending = [];
  for (const line of body) {
    const m = line.match(ROW);
    if (!m) {
      const tail = /^(\d{6}|Id-|:|\)|68|69)/.test(line) && rows.length && !pending.length;
      if (tail) rows.at(-1).text += ` ${line}`;
      else if (!/Particulars|Wage Month|Employee|Transaction|Type\b|Date\b/.test(line) && /[A-Za-z]/.test(line)) pending.push(line);
      continue;
    }
    const [, month, date, side, inline, wagesEpf, wagesEps, employee, employerShare, pension] = m;
    rows.push({ month, date, side, text: [...pending, inline].join(' ').trim(), wages: [amount(wagesEpf), amount(wagesEps)], amounts: triple(employee, employerShare, pension) });
    pending = [];
  }
  const entries = rows.map(r => {
    const kind = r.side === 'DR' ? 'withdrawal' : /TRANSFER/i.test(r.text) ? 'transfer' : /Cont\./i.test(r.text) ? 'contribution' : 'credit';
    return { date: isoDate(r.date), wageMonth: wageMonth(r.month), kind, note: describe(kind, r.text), wages: r.wages, employee: r.amounts[0], employer: r.amounts[1], pension: r.amounts[2] };
  });

  const out = {
    fy: Number(fy[1]), employer, memberTail,
    opening: triple(opening[1], opening[2], opening[3]),
    interest: interest ? triple(interest[2], interest[3], interest[4]) : [0, 0, 0],
    // A year still running prints an interest line of zeros until March's credit.
    interestUpto: interest && triple(interest[2], interest[3], interest[4]).some(v => v > 0) ? isoDate(interest[1]) : null,
    closing: triple(closing[2], closing[3], closing[4]), closingDate: isoDate(closing[1]),
    totals: { contributions: total('Contributions'), transfers: total('Transfer-Ins/VDRs'), withdrawals: total('Withdrawals') },
    entries,
  };
  out.check = statementCheck(out);
  return out;
}

const sign = kind => (kind === 'withdrawal' ? -1 : 1);

// Rebuilds the closing balance from the opening, the rows and the interest.
export function statementCheck(s) {
  const sum = i => s.opening[i] + s.entries.reduce((n, e) => n + sign(e.kind) * [e.employee, e.employer, e.pension][i], 0) + s.interest[i];
  const computed = [0, 1, 2].map(sum);
  return { computed, matches: computed.every((v, i) => Math.round(v) === Math.round(s.closing[i])) };
}

/* ---------- sums for the pages ---------- */

const sumOf = (list, key) => list.reduce((n, x) => n + (x[key] ?? 0), 0);

// The balance at each month's end of a financial year, for the employee and
// employer shares together, which is what EPF pays interest on.
function monthEnds(statement, entries) {
  let balance = statement.opening[0] + statement.opening[1];
  const ends = [];
  for (let i = 0; i < 12; i++) {
    const year = statement.fy + (i >= 9 ? 1 : 0);
    const month = String(((i + 3) % 12) + 1).padStart(2, '0');
    const key = `${year}-${month}`;
    balance += entries.filter(e => e.date.slice(0, 7) === key).reduce((n, e) => n + sign(e.kind) * (e.employee + e.employer), 0);
    ends.push({ key, balance });
  }
  return ends;
}

// The interest a year earned against its average month-end balance, which comes
// close to the rate EPFO declared for that year.
export function effectiveRate(statement, entries) {
  const credited = statement.interest[0] + statement.interest[1];
  if (!credited) return null;
  const average = monthEnds(statement, entries).reduce((n, m) => n + m.balance, 0) / 12;
  return average > 0 ? credited / average * 100 : null;
}

// Interest building up in the current year, at last year's rate, credited after March.
export function accruedInterest(statement, entries, rate, today = new Date().toISOString().slice(0, 7)) {
  if (!rate) return 0;
  return monthEnds(statement, entries).filter(m => m.key < today).reduce((n, m) => n + m.balance * rate / 100 / 12, 0);
}

export function accountSummary(statements, entries) {
  const years = [...statements].sort((a, b) => a.fy - b.fy);
  const latest = years.at(-1);
  if (!latest) return null;
  const byYear = years.map(s => {
    const own = entries.filter(e => e.fy === s.fy);
    const of = kind => own.filter(e => e.kind === kind);
    return {
      ...s, own,
      contributed: [sumOf(of('contribution'), 'employee'), sumOf(of('contribution'), 'employer'), sumOf(of('contribution'), 'pension')],
      movedIn: sumOf(of('transfer'), 'employee') + sumOf(of('transfer'), 'employer'),
      withdrawn: sumOf(of('withdrawal'), 'employee') + sumOf(of('withdrawal'), 'employer'),
      rate: effectiveRate(s, own),
    };
  });
  const lastRate = [...byYear].reverse().find(y => y.rate)?.rate ?? null;
  const current = byYear.at(-1);
  return {
    years: byYear,
    employee: latest.closing[0], employer: latest.closing[1], pension: latest.closing[2],
    balance: latest.closing[0] + latest.closing[1],
    interest: sumOf(byYear.map(y => ({ v: y.interest[0] + y.interest[1] })), 'v'),
    withdrawn: sumOf(byYear, 'withdrawn'),
    yourIn: sumOf(byYear.map(y => ({ v: y.contributed[0] })), 'v'),
    employerIn: sumOf(byYear.map(y => ({ v: y.contributed[1] })), 'v'),
    movedIn: sumOf(byYear, 'movedIn'),
    lastRate,
    accrued: current.interestUpto ? 0 : accruedInterest(current, current.own, lastRate),
    asOf: current.interestUpto ? latest.closingDate : current.own.map(e => e.date).sort().at(-1) ?? latest.closingDate,
    pendingInterest: !current.interestUpto,
  };
}

/* ---------- stored shapes ---------- */

const text = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = v => (Number.isFinite(v) ? v : 0);
const trio = v => (Array.isArray(v) && v.length === 3 ? v.map(finite) : [0, 0, 0]);
const isDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

export function cleanRetiralAccount(x) {
  if (!x?.id) return null;
  return { id: text(x.id, 60), kind: 'epf', name: text(x.name, 80) || 'EPF', employer: text(x.employer, 120), memberTail: text(x.memberTail, 4).replace(/\D/g, ''), createdAt: finite(x.createdAt), updatedAt: finite(x.updatedAt) };
}

export function cleanRetiralStatement(x) {
  if (!x?.id || !x.accountId || !Number.isInteger(x.fy)) return null;
  return {
    id: text(x.id, 80), accountId: text(x.accountId, 60), fy: x.fy,
    opening: trio(x.opening), interest: trio(x.interest), closing: trio(x.closing),
    interestUpto: isDate(x.interestUpto) ? x.interestUpto : null, closingDate: isDate(x.closingDate) ? x.closingDate : null,
    matches: x.matches === true, updatedAt: finite(x.updatedAt),
  };
}

export function cleanRetiralEntry(x) {
  if (!x?.id || !x.accountId || !isDate(x.date)) return null;
  const kinds = ['contribution', 'transfer', 'withdrawal', 'credit'];
  return {
    id: text(x.id, 160), accountId: text(x.accountId, 60), fy: Number.isInteger(x.fy) ? x.fy : 0, date: x.date,
    wageMonth: /^\d{4}-\d\d$/.test(x.wageMonth) ? x.wageMonth : x.date.slice(0, 7),
    kind: kinds.includes(x.kind) ? x.kind : 'credit', note: text(x.note, 120),
    wages: Array.isArray(x.wages) ? x.wages.slice(0, 2).map(finite) : [0, 0],
    employee: finite(x.employee), employer: finite(x.employer), pension: finite(x.pension), updatedAt: finite(x.updatedAt),
  };
}
