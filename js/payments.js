// Recurring payments, without any UI. A payment is the plan; its dues are worked
// out from the plan on demand, and only paying one stores a record. Dates are
// local 'YYYY-MM-DD' strings, so they compare and sort as text.

export const CATEGORIES = [
  { id: 'bills', name: 'Bills', tag: 'The Foundation',
    about: 'Non-negotiable survival expenses that rarely change month to month.',
    types: [
      ['Housing', 'Mortgage payments or monthly rent.'],
      ['Utilities', 'Electricity, water, natural gas and waste management.'],
      ['Connectivity', 'High-speed internet and mobile data plans.'],
      ['Insurance', 'Health, auto, homeowners/renters and life insurance premiums.'],
      ['Transportation', 'Auto loan payments or public transit passes.'],
    ] },
  { id: 'repayments', name: 'Repayments', tag: 'The Leverage',
    about: 'Payments on borrowed money. Manage these actively to avoid interest fees.',
    types: [
      ['Credit Cards', 'Monthly statement balances or minimum required payments.'],
      ['Personal Loans', 'Fixed-term debt consolidation or medical loan payments.'],
    ] },
  { id: 'subscriptions', name: 'Subscriptions & Memberships', tag: 'The Lifestyle',
    about: 'Recurring charges that are flexible and usually the easiest to cut back.',
    types: [
      ['Streaming Media', 'Video (Netflix, Hulu) and audio (Spotify, Apple Music).'],
      ['Wellness & Fitness', 'Gym memberships, boutique studios or wellness apps.'],
      ['Software (SaaS)', 'Cloud storage (iCloud, Google One) and productivity tools.'],
      ['Retail & Delivery', 'Amazon Prime, Costco memberships or food delivery passes.'],
      ['Laundry', ''],
      ['Meal Pass', ''],
    ] },
];

export const FREQUENCIES = [
  { id: 'days', label: 'Every X days' },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'bimonthly', label: 'Bi-monthly', months: 2 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'halfyearly', label: 'Half-yearly', months: 6 },
  { id: 'annual', label: 'Annual', months: 12 },
];

export const WHEN = ['Prepaid', 'Advance', 'Post-payment'];
export const CHANNELS = ['Bank Account', 'Credit Card', 'UPI'];
export const MODES = ['Manual', 'Auto-pay', 'Standing Instructions'];

/* ---------- dates ---------- */

const DAY = 24 * 60 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');

export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s, k) => { const d = parseDate(s); d.setDate(d.getDate() + k); return iso(d); };
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);

export function monthRange(year, month) {
  return [`${year}-${pad(month)}-01`, iso(new Date(year, month, 0))];
}
export const yearRange = year => [`${year}-01-01`, `${year}-12-31`];

/* ---------- schedule ---------- */

export const freqOf = p => FREQUENCIES.find(f => f.id === p.frequency) ?? FREQUENCIES[2];
export const freqLabel = p => (p.frequency === 'days' ? `Every ${p.everyDays} days` : freqOf(p).label);

function periodDays(p) {
  const f = freqOf(p);
  return f.months ? f.months * 30.4 : f.days ?? Math.max(1, p.everyDays);
}

// Month steps count from the start date, so the 31st falls back to the 28th in
// February and returns to the 31st in March.
function nthDate(start, p, n) {
  const f = freqOf(p);
  if (!f.months) return addDays(start, n * Math.max(1, f.days ?? p.everyDays));
  const d = parseDate(start);
  const first = new Date(d.getFullYear(), d.getMonth() + n * f.months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(d.getDate(), last));
  return iso(first);
}

const fromRecord = (p, r) => ({
  payment: p, due: r.due, bill: r.bill, record: r,
  amount: r.actual, tentative: r.tentative, channel: r.channel, mode: r.mode,
});

const fromPlan = (p, due, bill) => ({
  payment: p, due, bill, record: null,
  amount: p.tentative, tentative: p.tentative, channel: p.channel, mode: p.mode,
});

// Every due of a payment from `from` to `to`, inclusive. Ending a payment keeps
// its paid history and drops the rest; resuming skips what was unpaid until then.
export function occurrences(p, records, from, to) {
  const paid = records.filter(r => r.paymentId === p.id);
  const out = paid.filter(r => r.due >= from && r.due <= to).map(r => fromRecord(p, r));
  if (p.endedAt) return out;
  // Editing a due date moves the schedule off the stored dates, so a paid record
  // covers the nearest scheduled due instead of only an exact match.
  const reach = periodDays(p) / 2;
  for (let n = 0; ; n++) {
    const due = nthDate(p.dueDate, p, n);
    if (due > to) break;
    if (due < from || (p.resumedOn && due < p.resumedOn)) continue;
    if (paid.some(r => Math.abs(daysBetween(r.due, due)) < reach)) continue;
    out.push(fromPlan(p, due, p.billDate ? nthDate(p.billDate, p, n) : ''));
  }
  return out;
}

export const byDue = (a, b) => a.due.localeCompare(b.due) || a.payment.name.localeCompare(b.payment.name);

export function occurrencesIn(payments, records, from, to) {
  return payments.flatMap(p => occurrences(p, records, from, to)).sort(byDue);
}

// Everything unpaid so far, plus the next due, oldest first.
export function openDues(p, records) {
  if (p.endedAt) return [];
  const now = today();
  const start = p.dueDate > now ? p.dueDate : now;
  const paidCount = records.filter(r => r.paymentId === p.id).length;
  const horizon = addDays(start, Math.ceil(periodDays(p) * (paidCount + 2)));
  const open = occurrences(p, records, p.dueDate, horizon).filter(o => !o.record).sort(byDue);
  const k = open.findIndex(o => o.due >= now);
  return k < 0 ? open : open.slice(0, k + 1);
}

export function statusOf(o, now = today()) {
  if (o.record) return 'paid';
  if (o.due < now) return 'overdue';
  return daysBetween(now, o.due) <= o.payment.remindDays ? 'soon' : 'upcoming';
}

// Unpaid dues that are late or inside their reminder window.
export function attention(payments, records) {
  return payments
    .flatMap(p => openDues(p, records))
    .filter(o => statusOf(o) !== 'upcoming')
    .sort(byDue);
}

export function summarize(list) {
  const s = { total: 0, paid: 0, pending: 0, overdue: 0, overdueCount: 0 };
  const now = today();
  for (const o of list) {
    s.total += o.amount;
    if (o.record) { s.paid += o.amount; continue; }
    s.pending += o.amount;
    if (o.due < now) { s.overdue += o.amount; s.overdueCount++; }
  }
  return s;
}

/* ---------- stored shapes ---------- */

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d) => (Number.isFinite(v) ? v : d);
const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const oneOf = (v, list) => (list.includes(v) ? v : list[0]);

export function cleanPayment(x) {
  if (!x || typeof x.id !== 'string' || !date(x.dueDate)) return null;
  const t = Date.now();
  return {
    id: x.id,
    name: str(x.name, 80) || 'Payment',
    categoryId: str(x.categoryId, 100) || CATEGORIES[0].id,
    type: str(x.type, 80),
    tentative: Math.max(0, num(x.tentative, 0)),
    cycleFrom: num(x.cycleFrom, 1),
    cycleTo: num(x.cycleTo, 30),
    billDate: date(x.billDate),
    dueDate: x.dueDate,
    remindDays: Math.max(0, num(x.remindDays, 3)),
    frequency: oneOf(x.frequency, FREQUENCIES.map(f => f.id)),
    everyDays: Math.max(1, num(x.everyDays, 28)),
    when: oneOf(x.when, WHEN),
    channel: oneOf(x.channel, CHANNELS),
    mode: oneOf(x.mode, MODES),
    comments: str(x.comments, 2000),
    endedAt: date(x.endedAt),
    resumedOn: date(x.resumedOn),
    createdAt: num(x.createdAt, t),
    updatedAt: num(x.updatedAt, t),
  };
}

export function cleanRecord(x) {
  if (!x || typeof x.id !== 'string' || typeof x.paymentId !== 'string' || !date(x.due)) return null;
  const t = Date.now();
  return {
    id: x.id,
    paymentId: x.paymentId,
    due: x.due,
    bill: date(x.bill),
    tentative: num(x.tentative, 0),
    actual: num(x.actual, 0),
    paidOn: date(x.paidOn) || x.due,
    channel: oneOf(x.channel, CHANNELS),
    mode: oneOf(x.mode, MODES),
    createdAt: num(x.createdAt, t),
    updatedAt: num(x.updatedAt, t),
  };
}

export function cleanCategory(x) {
  if (!x || typeof x.id !== 'string') return null;
  const t = Date.now();
  return { id: x.id, name: str(x.name, 80) || 'Custom', createdAt: num(x.createdAt, t), updatedAt: num(x.updatedAt, t) };
}

export function cleanType(x) {
  if (!x || typeof x.id !== 'string' || typeof x.categoryId !== 'string') return null;
  const t = Date.now();
  return { id: x.id, categoryId: x.categoryId, name: str(x.name, 80) || 'Custom', createdAt: num(x.createdAt, t), updatedAt: num(x.updatedAt, t) };
}
