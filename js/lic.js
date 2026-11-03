// LIC policies: reading renewal premium receipts, the premium schedule, and the
// sums behind a policy's page. Only the policy number's last four digits, the
// plan and the money are kept: never the name, address, nominee or agent.

import { xirr } from './portfolio.js';

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const PER_YEAR = { Yearly: 1, 'Half-yearly': 2, Quarterly: 4, Monthly: 12 };
export const MODES = Object.keys(PER_YEAR);
const monthOf = mmYyyy => `${mmYyyy.slice(3)}-${mmYyyy.slice(0, 2)}`;

// Each receipt in a PDF of LIC renewal premium receipts. Throws if there are none.
export function parseReceipts(lines) {
  const all = lines.join('\n');
  if (!/Renewal Premium Receipt/.test(all)) throw new Error('This isn\'t an LIC premium receipt');
  const blocks = all.split(/(?=Collecting Branch)/).filter(b => /Renewal Premium Receipt/.test(b));
  const receipts = blocks.flatMap(b => {
    const date = b.match(/Date \( ?Tim ?e ?\) : (\d\d)-([A-Z][a-z]{2})-(\d\d)/);
    const paid = b.match(/Received with thanks ₹ ([\d,.]+)/);
    const row = b.match(/(\d{8,10}) (\d{1,3}) \/ (\d+) ([\d.]+) (\d+) ([\d.]+)/);
    const second = b.match(/(\d{4}-\d\d-\d\d) (Yearly|Half-?[Yy]early|Quarterly|Monthly) (\d\d\/\d{4})[^\n]*?(\d\d\/\d{4})\s*$/m);
    const third = b.match(/\b(?:No|Yes) \S+ ([\d.]+) (\d\d\/\d{4}) ([\d.]+)/);
    if (!date || !paid || !row) return [];
    return [{
      policyTail: row[1].slice(-4), table: Number(row[2]), termYears: Number(row[3]),
      date: `20${date[3]}-${MONTHS[date[2]]}-${date[1]}`, amount: Number(paid[1].replace(/,/g, '')),
      installments: Number(row[5]), premium: Number(row[4]),
      mode: second ? second[2].replace(/half-?yearly/i, 'Half-yearly') : 'Yearly',
      dueFrom: second ? monthOf(second[3]) : null, nextDue: second ? monthOf(second[4]) : null,
      dueTo: third ? monthOf(third[2]) : null, sumAssured: third ? Number(third[1]) : null,
      lateFee: third ? Number(third[3]) : 0,
    }];
  });
  if (!receipts.length) throw new Error('Couldn\'t find any receipts in this file');
  return receipts;
}

const addMonths = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

// Every premium due, oldest first, each marked paid if it falls before the next due date.
export function premiumSchedule(policy) {
  const step = 12 / (PER_YEAR[policy.mode] ?? 1);
  const count = policy.premiumYears * (PER_YEAR[policy.mode] ?? 1);
  return Array.from({ length: count }, (_, i) => {
    const due = addMonths(policy.start, i * step);
    return { n: i + 1, due, amount: policy.premium, paid: !policy.nextDue || due < policy.nextDue };
  });
}

// When the policy pays out while you're alive. Jeevan Anand (table 149) pays the sum
// assured with bonuses at the end of the premium term, then keeps the sum assured as
// life cover. Other plans pay at maturity.
export const payoutDate = p => (p.table === 149 ? addMonths(p.start, p.premiumYears * 12) : p.maturity);

// Bonus declarations still to come before the payout, one each 31 March.
function declarationsLeft(policy, asOf) {
  const payout = payoutDate(policy);
  let n = 0;
  for (let y = Number(asOf.slice(0, 4)); y <= Number(payout.slice(0, 4)); y++) {
    const march = `${y}-03-31`;
    if (march > asOf && march < payout) n++;
  }
  return n;
}

export function policySummary(policy, receipts, today = new Date().toISOString().slice(0, 10)) {
  const schedule = premiumSchedule(policy);
  const paid = schedule.filter(d => d.paid);
  const left = schedule.filter(d => !d.paid);
  const payout = payoutDate(policy);
  // The interim bonus is this year's rate, so it stands in for the years ahead.
  const rate = policy.sumAssured ? policy.interimBonus / policy.sumAssured * 1000 : 0;
  const ahead = declarationsLeft(policy, policy.bonusAsOf ?? today);
  const futureBonus = ahead * policy.interimBonus;
  const atPayout = policy.sumAssured + policy.vestedBonus + futureBonus;
  const flows = [...schedule.map(d => ({ date: d.due, amount: -d.amount })), { date: payout, amount: atPayout }];
  return {
    schedule, paid, left,
    paidTotal: paid.reduce((n, d) => n + d.amount, 0),
    leftTotal: left.reduce((n, d) => n + d.amount, 0),
    nextDue: left[0] ?? null, lastDue: schedule.at(-1)?.due ?? null,
    payout, atPayout, futureBonus, bonusRate: rate, declarationsAhead: ahead,
    deathCover: policy.sumAssured + policy.vestedBonus + policy.interimBonus,
    // At least 30% of premiums paid after the first year, plus the bonus's cash value, which LIC sets.
    surrenderFloor: paid.length >= 3 ? 0.3 * paid.slice(PER_YEAR[policy.mode] ?? 1).reduce((n, d) => n + d.amount, 0) : 0,
    returnRate: xirr(flows),
    receiptsByDue: new Map(receipts.map(r => [r.dueMonth, r])),
  };
}

/* ---------- stored shapes ---------- */

const text = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = v => (Number.isFinite(v) ? v : 0);
const isDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

export function cleanPolicy(x) {
  return {
    id: text(x.id, 60), kind: 'lic', name: text(x.name, 80) || 'LIC policy', plan: text(x.plan, 80),
    // A full policy number keeps only its last four digits.
    table: Number.isInteger(x.table) ? x.table : 0, policyTail: String(x.policyTail ?? '').replace(/\D/g, '').slice(-4),
    sumAssured: finite(x.sumAssured), premium: finite(x.premium), mode: MODES.includes(x.mode) ? x.mode : 'Yearly',
    start: isDate(x.start) ? x.start : '2000-01-01', premiumYears: Math.max(1, Math.min(100, Math.round(finite(x.premiumYears)) || 1)),
    termYears: Math.max(1, Math.min(100, Math.round(finite(x.termYears)) || 1)), maturity: isDate(x.maturity) ? x.maturity : null,
    vestedBonus: finite(x.vestedBonus), interimBonus: finite(x.interimBonus), bonusAsOf: isDate(x.bonusAsOf) ? x.bonusAsOf : null,
    nextDue: isDate(x.nextDue) ? x.nextDue : null, autoPay: x.autoPay === true,
    riderName: text(x.riderName, 80), riderSumAssured: finite(x.riderSumAssured),
    createdAt: finite(x.createdAt), updatedAt: finite(x.updatedAt),
  };
}
