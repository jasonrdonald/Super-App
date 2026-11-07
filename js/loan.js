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
  }));
  if (!schedule.length) return null;
  const t = Date.now();
  return {
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
