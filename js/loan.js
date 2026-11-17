// Loans: reading a lender's amortization schedule PDF, and the sums behind the
// Loans pages. EMIs dated on or before today count as paid. Only the loan
// number's last four digits, the rate and the schedule are kept: never the
// borrower's name, customer ID or branch.

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const NUM = /^-?[\d,]+\.\d\d$/;
const r2 = v => Math.round(v * 100) / 100;
const numbers = line => {
  const parts = String(line).trim().split(/\s+/);
  return parts[0] && parts.every(p => NUM.test(p)) ? parts.map(p => Number(p.replace(/,/g, ''))) : null;
};
const datesIn = line => [...String(line).matchAll(/(\d\d)-([A-Z][a-z]{2})-(\d{4})(\[R\])?/g)].map(m => ({ iso: `${m[3]}-${MONTHS[m[2]]}-${m[1]}`, repay: !!m[4] }));

// The schedule prints each page column by column: a row of dates, then rows of
// principal, interest, total and balance figures. Each page's instalments are its
// last dates, paired with its principal row and its total row. The figures are
// then checked against the schedule's own totals and running balances.
export function parseSchedule(lines) {
  if (!lines.some(l => /Schedule Details/.test(l)) || !lines.some(l => /Ins\. No\./.test(l))) throw new Error('This isn\'t a loan schedule');
  const pages = [];
  let start = 0;
  lines.forEach((l, i) => { if (/Ins\. No\./.test(l)) { pages.push(lines.slice(start, i + 1)); start = i + 1; } });

  const schedule = [];
  let firstDates = null;
  for (const page of pages) {
    const nos = page.find(l => /Ins\. No\./.test(l)).match(/Ins\. No\.\s+([\d\s]+?)\s*(?:Printed|$)/)?.[1].trim().split(/\s+/).map(Number) ?? [];
    const n = nos.length;
    if (!n) continue;
    const dates = page.filter(l => /^Date\s/.test(l)).flatMap(datesIn);
    firstDates ??= dates;
    const at = page.findIndex(l => l.trim() === 'Principal');
    const principal = page.slice(at + 1).map(numbers).find(v => v?.length === n);
    // The totals row is the row of n figures at least each principal, with the smallest sum: balances are far larger.
    const totals = page.map(numbers).filter(v => v?.length === n && principal && v.every((x, i) => x >= principal[i] - 0.005) && v.some((x, i) => x > principal[i] + 0.005)).sort((p, q) => p.reduce((s, x) => s + x, 0) - q.reduce((s, x) => s + x, 0))[0];
    if (at < 0 || !principal || !totals || dates.length < n) throw new Error('Couldn\'t read the instalments in this schedule');
    dates.slice(-n).forEach((d, i) => schedule.push({ no: nos[i], date: d.iso, principal: principal[i], interest: r2(totals[i] - principal[i]), total: totals[i] }));
  }
  if (!schedule.length) throw new Error('Couldn\'t find any instalments in this schedule');

  const amount = r2(schedule.reduce((s, x) => s + x.principal, 0));
  let balance = amount;
  schedule.forEach(x => { balance = r2(balance - x.principal); x.balance = Math.max(0, balance); });

  // Single figures standing alone: the amount lent, the pre-EMI interest and the totals.
  const singles = lines.map(numbers).filter(v => v?.length === 1).map(v => v[0]);
  const printed = new Set(lines.map(numbers).filter(Boolean).flat());
  const totalPayment = Math.max(...singles);
  const paidInEmis = r2(schedule.reduce((s, x) => s + x.total, 0));
  const preEmi = r2(totalPayment - paidInEmis);
  const repayDates = (firstDates ?? []).filter(d => d.repay).map(d => d.iso);
  const bpiDate = preEmi > 0 ? repayDates.find(d => d < schedule[0].date) ?? null : null;

  const text = lines.join('\n');
  const ref = text.match(/\b(\d{8,})\s+([A-Z]{2,3}) - ([A-Za-z ]+?Loan)\b/);
  const rateMatch = text.match(/\[([A-Z]+),\s*([-\d.]+)\]\s*([\d.]+)%/);
  const generated = text.match(/(\d\d)\/(\d\d)\/(\d{4})\s+\d{1,2}\.\d\d\s*[AP]M/);
  const checks = {
    amount: singles.some(v => Math.abs(v - amount) < 0.01),
    preEmi: preEmi <= 0 || singles.some(v => Math.abs(v - preEmi) < 0.01),
    balances: schedule.slice(0, -1).every(x => printed.has(x.balance)),
    interest: schedule.every(x => printed.has(x.interest)),
  };
  return {
    loanTail: ref?.[1].slice(-4) ?? '', type: ref?.[3].trim() ?? 'Loan',
    rate: rateMatch ? Number(rateMatch[3]) : Number(text.match(/(\d+\.\d+)%/)?.[1]) || null,
    benchmark: rateMatch ? `${rateMatch[1]} ${Number(rateMatch[2]) < 0 ? '−' : '+'} ${Math.abs(Number(rateMatch[2]))}%` : '',
    disbursed: firstDates?.find(d => !d.repay)?.iso ?? null,
    generated: generated ? `${generated[3]}-${generated[2]}-${generated[1]}` : null,
    amount, emi: mostCommon(schedule.map(x => x.total)), preEmi: preEmi > 0 ? { date: bpiDate, amount: preEmi } : null,
    totalPayment, totalInterest: r2(totalPayment - amount), schedule,
    matches: Object.values(checks).every(Boolean), checks,
  };
}

/* ---------- revised schedules ---------- */

// Excel keeps dates as days since 30 Dec 1899.
const cellDate = v => {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const m = String(v ?? '').match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const cellNumber = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[₹,\s%]/g, '')));

// A lender's repayment schedule for part of a loan, as a spreadsheet: one row an EMI
// with its due date, rate, principal, interest, total and the balance after it.
// Checked that each balance follows from the one before and each month's interest
// is the rate on what was owed.
export function parseRevision(sheets) {
  const rows = Object.values(sheets).find(r => r.some(x => /Due Date/i.test(x[0]))) ?? [];
  const head = rows.findIndex(r => /Due Date/i.test(r[0]));
  if (head < 0) throw new Error('This isn\'t a repayment schedule');
  const col = re => rows[head].findIndex(c => re.test(String(c)));
  const at = { rate: col(/Interest Rate/i), principal: col(/Prin/i), interest: col(/\(Int|Interest\b(?! Rate)/i), total: col(/Total/i), balance: col(/OS|Outstanding|Balance/i) };
  if (Object.values(at).some(i => i < 0)) throw new Error('Couldn\'t find the columns in this repayment schedule');
  const list = [];
  for (const r of rows.slice(head + 1)) {
    const date = cellDate(r[0]);
    if (!date) continue;
    const rate = cellNumber(r[at.rate]);
    list.push({ date, rate: r2(rate < 1 ? rate * 100 : rate), principal: cellNumber(r[at.principal]), interest: cellNumber(r[at.interest]), total: cellNumber(r[at.total]), balance: cellNumber(r[at.balance]) });
  }
  if (!list.length) throw new Error('This repayment schedule has no EMIs');
  const opening = r2(list[0].balance + list[0].principal);
  let owed = opening;
  const steps = list.every(x => {
    const ok = Math.abs(owed * x.rate / 1200 - x.interest) < 1 && Math.abs(r2(owed - x.principal) - x.balance) < 0.05 && Math.abs(x.principal + x.interest - x.total) < 0.05;
    owed = x.balance;
    return ok;
  });
  return { rows: list, opening, matches: steps, from: list[0].date, to: list.at(-1).date, rate: list.at(-1).rate, emi: mostCommon(list.map(x => x.total)) };
}

const addMonth = (iso, n = 1) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

// Brings a revision into a loan: EMIs before it stay as they were, the lender's
// revised EMIs replace the same months, and the rest is worked out at the latest rate
// with the same EMI until nothing is owed, marked as the app's estimate. The first
// revision keeps the original plan, to compare against.
export function applyRevision(loan, rev, now = Date.now()) {
  const before = loan.schedule.filter(x => x.date < rev.from && !x.projected);
  const owedBefore = before.at(-1)?.balance ?? loan.amount;
  const continues = Math.abs(owedBefore - rev.opening) < 1;
  const firstRate = loan.rates?.[0]?.rate ?? loan.rate;
  const baseline = loan.baseline ?? { rate: loan.rate, end: loan.schedule.at(-1).date, emis: loan.schedule.length, totalInterest: loan.totalInterest, emi: loan.emi };
  let no = before.at(-1)?.no ?? 0;
  const schedule = [
    ...before.map(x => ({ ...x, rate: x.rate ?? firstRate })),
    ...rev.rows.map(x => ({ no: ++no, date: x.date, principal: x.principal, interest: x.interest, total: x.total, balance: x.balance, rate: x.rate })),
  ];
  // The months after the lender's revision, at its last rate and EMI.
  let owed = rev.rows.at(-1).balance, date = rev.to;
  while (owed > 0.005 && schedule.length < 600) {
    date = addMonth(date);
    const interest = r2(owed * rev.rate / 1200);
    const total = r2(Math.min(rev.emi, owed + interest));
    const principal = r2(total - interest);
    owed = r2(owed - principal);
    schedule.push({ no: ++no, date, principal, interest, total, balance: Math.max(0, owed), rate: rev.rate, projected: true });
  }
  const totalInterest = r2((loan.preEmi?.amount ?? 0) + schedule.reduce((s, x) => s + x.interest, 0));
  const rates = [...(loan.rates?.length ? loan.rates : [{ from: loan.schedule[0].date, rate: firstRate }]).filter(x => x.from < rev.from)];
  if (rates.at(-1)?.rate !== rev.rate) rates.push({ from: rev.from, rate: rev.rate });
  const revisions = [...(loan.revisions ?? []).filter(x => x.from !== rev.from), { from: rev.from, to: rev.to, rate: rev.rate, emi: rev.emi, emis: rev.rows.length, matches: rev.matches && continues, loadedAt: now }];
  return {
    ...loan, schedule, rate: rev.rate, emi: rev.emi, rates, baseline, revisions,
    totalInterest, totalPayment: r2(loan.amount + totalInterest), updatedAt: now,
    revisedTo: rev.to, continues,
  };
}

const mostCommon = list => {
  const counts = new Map();
  list.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

export const todayIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fyOf = iso => (Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// Where a loan stands today, taking every EMI due on or before today as paid.
export function loanSummary(loan, today = todayIso()) {
  const all = loan.schedule;
  const paid = all.filter(x => x.date <= today);
  const left = all.filter(x => x.date > today);
  const preEmiPaid = loan.preEmi && (!loan.preEmi.date || loan.preEmi.date <= today) ? loan.preEmi.amount : 0;
  const sum = (list, key) => r2(list.reduce((s, x) => s + x[key], 0));
  const principalPaid = sum(paid, 'principal');
  const interestPaid = r2(sum(paid, 'interest') + preEmiPaid);
  const outstanding = r2(loan.amount - principalPaid);
  const years = new Map();
  if (loan.preEmi) {
    const fy = fyOf(loan.preEmi.date ?? all[0].date);
    years.set(fy, { fy, principal: 0, interest: loan.preEmi.amount, emis: 0, paid: 0, closing: loan.amount });
  }
  for (const x of all) {
    const fy = fyOf(x.date);
    const y = years.get(fy) ?? { fy, principal: 0, interest: 0, emis: 0, paid: 0, closing: 0 };
    y.principal = r2(y.principal + x.principal);
    y.interest = r2(y.interest + x.interest);
    y.emis++;
    if (x.date <= today) y.paid++;
    y.closing = x.balance;
    years.set(fy, y);
  }
  const last = all.at(-1);
  return {
    paid, left, next: left[0] ?? null, last, preEmiPaid,
    emisPaid: paid.length, emisLeft: left.length, emisTotal: all.length,
    principalPaid, interestPaid, outstanding,
    paidSoFar: r2(principalPaid + interestPaid), leftToPay: sum(left, 'total'),
    interestLeft: sum(left, 'interest'), principalShare: loan.amount ? principalPaid / loan.amount * 100 : 0,
    interestShareSoFar: principalPaid + interestPaid ? interestPaid / (principalPaid + interestPaid) * 100 : 0,
    interestPerRupee: loan.amount ? loan.totalInterest / loan.amount : 0,
    monthsLeft: last ? Math.max(0, monthsBetween(today.slice(0, 7), last.date.slice(0, 7))) : 0,
    closed: !left.length,
    years: [...years.values()].sort((a, b) => a.fy - b.fy),
  };
}

/* ---------- stored shape ---------- */

const text = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = v => (Number.isFinite(v) ? v : 0);
const isDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

export function cleanLoan(x) {
  if (!x || typeof x.id !== 'string' || !Array.isArray(x.schedule)) return null;
  const schedule = x.schedule.filter(s => isDate(s?.date)).slice(0, 600).map(s => ({
    no: finite(s.no), date: s.date, principal: finite(s.principal), interest: finite(s.interest), total: finite(s.total), balance: finite(s.balance),
    ...(Number.isFinite(s.rate) ? { rate: s.rate } : {}), ...(s.projected ? { projected: true } : {}),
  }));
  if (!schedule.length) return null;
  const t = Date.now();
  const revised = Array.isArray(x.revisions) && x.revisions.length ? {
    rates: (Array.isArray(x.rates) ? x.rates : []).filter(r => isDate(r?.from) && Number.isFinite(r.rate)).slice(0, 60).map(r => ({ from: r.from, rate: r.rate })),
    revisions: x.revisions.filter(r => isDate(r?.from) && isDate(r?.to)).slice(0, 60).map(r => ({ from: r.from, to: r.to, rate: finite(r.rate), emi: finite(r.emi), emis: finite(r.emis), matches: r.matches === true, loadedAt: finite(r.loadedAt) })),
    baseline: x.baseline && isDate(x.baseline.end) ? { rate: Number.isFinite(x.baseline.rate) ? x.baseline.rate : null, end: x.baseline.end, emis: finite(x.baseline.emis), totalInterest: finite(x.baseline.totalInterest), emi: finite(x.baseline.emi) } : null,
    revisedTo: isDate(x.revisedTo) ? x.revisedTo : null, continues: x.continues !== false,
  } : {};
  return {
    ...revised,
    id: text(x.id, 60), name: text(x.name, 80) || 'Loan', type: text(x.type, 40), lender: text(x.lender, 80),
    loanTail: String(x.loanTail ?? '').replace(/\D/g, '').slice(-4),
    rate: Number.isFinite(x.rate) ? x.rate : null, benchmark: text(x.benchmark, 40),
    disbursed: isDate(x.disbursed) ? x.disbursed : null, generated: isDate(x.generated) ? x.generated : null,
    amount: finite(x.amount), emi: finite(x.emi),
    preEmi: x.preEmi && Number.isFinite(x.preEmi.amount) ? { date: isDate(x.preEmi.date) ? x.preEmi.date : null, amount: x.preEmi.amount } : null,
    totalPayment: finite(x.totalPayment), totalInterest: finite(x.totalInterest), matches: x.matches === true,
    schedule, createdAt: Number.isFinite(x.createdAt) ? x.createdAt : t, updatedAt: Number.isFinite(x.updatedAt) ? x.updatedAt : t,
  };
}
