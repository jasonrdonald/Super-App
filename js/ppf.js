// PPF: reading a bank's Public Provident Fund account statement (SBI's .xlsx or
// .xls export), and the sums behind its page. Only the bank, the account number's
// last four digits, the rate, the dates and the amounts are kept: never the
// holder's name, address, email, branch or the linked savings account, which the
// transaction details carry.

const amount = s => {
  const n = Number(String(s ?? '').replace(/[₹,\s]|CR|DR/gi, ''));
  return Number.isFinite(n) && String(s ?? '').trim() !== '' && String(s).trim() !== '-' ? n : 0;
};
const dmy = s => {
  const m = String(s ?? '').match(/(\d\d)[/-](\d\d)[/-](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Financial year a date falls in, by the year it starts: 2026-11-15 is in 2026 (2026-27).
export const fyOf = iso => Number(iso.slice(0, 4)) - (Number(iso.slice(5, 7)) < 4 ? 1 : 0);

// PPF's yearly deposit limit and the minimum that keeps an account active.
export const PPF_LIMIT = 150000;
export const PPF_MINIMUM = 500;

// One statement. Throws if the sheet isn't a PPF account statement.
export function parsePpfStatement(sheets) {
  const rows = Object.values(sheets)[0] ?? [];
  const cells = rows.flat().map(c => String(c ?? ''));
  const all = cells.join('\n');
  if (!/PPF Account|Public Provident Fund/i.test(all)) throw new Error('This isn\'t a PPF account statement');
  const field = re => all.match(re)?.[1]?.trim() ?? '';

  const bank = cells.find(c => /^(State Bank of India|[A-Z][A-Za-z ]+ Bank|India Post)/.test(c.trim()))?.trim().split('\n')[0] ?? '';
  const accountTail = field(/Account No\s*:\s*(\d+)/).slice(-4);
  const rate = Number(field(/Interest Rate\s*:\s*([\d.]+)/)) || null;
  const opened = dmy(field(/Account Open Date\s*:\s*([\d/-]+)/));
  const asOf = dmy(field(/Date of Statement\s*:\s*([\d/-]+)/));
  const clear = amount(field(/Clear Balance\s*:\s*([\d,.]+)/));
  const [from, to] = [...field(/Statement F[or]{2}m\s*:\s*(.+)/).matchAll(/\d\d-\d\d-\d{4}/g)].map(m => dmy(m[0]));

  // The transactions table: its header names each column.
  const head = rows.findIndex(r => String(r[0]).trim() === 'Date' && r.some(c => /Balance/i.test(c)));
  if (head < 0) throw new Error('Couldn\'t find the transactions in this PPF statement');
  const col = name => rows[head].findIndex(c => new RegExp(`^${name}`, 'i').test(String(c).trim()));
  const [debitAt, creditAt, balanceAt] = [col('Debit'), col('Credit'), col('Balance')];
  const entries = [];
  for (const r of rows.slice(head + 1)) {
    const date = dmy(r[0]);
    if (!date) break;
    const debit = amount(r[debitAt]), credit = amount(r[creditAt]);
    const kind = debit > 0 ? 'withdrawal' : /INTEREST/i.test(String(r[1])) ? 'interest' : 'deposit';
    entries.push({ date, kind, amount: debit > 0 ? debit : credit, balance: amount(r[balanceAt]) });
  }
  // The bank lists newest first; oldest first is the order balances run in.
  entries.reverse();

  // The summary: brought forward, debit and credit counts and totals, closing balance.
  const sumHead = rows.findIndex(r => /^Brought Forward/i.test(String(r[0]).trim()));
  const sum = sumHead >= 0 ? rows[sumHead + 1] : null;
  const summary = sum ? { opening: amount(sum[0]), debits: amount(sum[3]), debitCount: amount(sum[1]), credits: amount(sum[5]), creditCount: amount(sum[4]), closing: amount(sum[6]) } : null;

  // Each balance should follow from the one before, and the last should be the summary's closing balance.
  let running = summary?.opening ?? 0;
  const steps = entries.every(e => {
    running += e.kind === 'withdrawal' ? -e.amount : e.amount;
    return Math.abs(running - e.balance) < 0.5;
  });
  const closing = entries.at(-1)?.balance ?? 0;
  const counted = !summary || (summary.creditCount === entries.filter(e => e.kind !== 'withdrawal').length && summary.debitCount === entries.filter(e => e.kind === 'withdrawal').length);
  const matches = steps && counted && (!summary || Math.abs(summary.closing - closing) < 0.5) && (!clear || Math.abs(clear - closing) < 0.5);

  if (!entries.length) throw new Error('This PPF statement has no transactions');
  return { bank, accountTail, rate, opened, asOf: asOf ?? entries.at(-1).date, from, to, closing, matches, entries };
}

// PPF credits interest each 31 March on the lowest balance between the 5th and the
// month's end, month by month. This is that balance for a month (yyyy-mm).
function qualifying(entries, month) {
  const before = entries.filter(e => e.date <= `${month}-05`);
  let low = before.at(-1)?.balance ?? 0;
  for (const e of entries.filter(e => e.date > `${month}-05` && e.date.slice(0, 7) === month)) low = Math.min(low, e.balance);
  return low;
}

const monthsOfFy = fy => Array.from({ length: 12 }, (_, i) => {
  const m = (3 + i) % 12 + 1, y = fy + (m < 4 ? 1 : 0);
  return `${y}-${String(m).padStart(2, '0')}`;
});

// Everything the PPF page shows: balance, deposits and interest, year by year,
// interest building up this year, this year's deposit room, maturity and the return.
export function ppfSummary(account, entries, today = new Date()) {
  const list = [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'interest') - (b.kind === 'interest'));
  if (!list.length) return null;
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sumOf = (kind, l = list) => l.filter(e => e.kind === kind).reduce((n, e) => n + e.amount, 0);
  const balance = list.at(-1).balance;
  const rate = account.rate ?? null;

  const firstFy = fyOf(account.opened ?? list[0].date);
  const thisFy = fyOf(iso);
  const years = [];
  let opening = 0;
  for (let fy = firstFy; fy <= thisFy; fy++) {
    const inYear = list.filter(e => fyOf(e.date) === fy);
    const deposits = sumOf('deposit', inYear), interest = sumOf('interest', inYear), withdrawn = sumOf('withdrawal', inYear);
    const closing = inYear.at(-1)?.balance ?? opening;
    // The year's interest over its average qualifying balance, close to the declared rate.
    const months = monthsOfFy(fy).map(m => qualifying(list, m));
    const average = months.reduce((n, v) => n + v, 0) / 12;
    const credited = inYear.some(e => e.kind === 'interest' && e.date.slice(5) === '03-31');
    years.push({ fy, opening, deposits, interest, withdrawn, closing, rate: credited && average ? interest / average * 100 : null, credited });
    opening = closing;
  }

  // This year's interest so far, at the account's rate, for each month whose 5th has passed.
  const current = years.at(-1);
  const due = monthsOfFy(thisFy).filter(m => `${m}-05` < iso);
  const accrued = rate && !current.credited ? due.reduce((n, m) => n + qualifying(list, m), 0) * rate / 1200 : 0;

  // It matures 15 full financial years after the one it opened in, then runs on in 5-year blocks.
  const maturity = `${firstFy + 16}-04-01`;
  let extendedTo = null;
  if (iso >= maturity) {
    let end = firstFy + 16;
    while (`${end}-04-01` <= iso) end += 5;
    extendedTo = `${end}-04-01`;
  }

  // From the 7th year, up to half the lower of the balances at the end of the 4th and the last year before.
  const closeOf = fy => years.find(y => y.fy === fy)?.closing ?? 0;
  const canWithdraw = thisFy >= firstFy + 6;
  const withdrawLimit = canWithdraw ? 0.5 * Math.min(closeOf(thisFy - 4), closeOf(thisFy - 1)) : 0;

  // Deposits are cash in, today's balance is cash out; interest stays inside.
  const flows = [...list.filter(e => e.kind !== 'interest').map(e => ({ date: e.date, amount: e.kind === 'deposit' ? -e.amount : e.amount })), { date: iso, amount: balance + accrued }];

  // What it could be at maturity, keeping up the average of the last three full years'
  // deposits, each made by 5 April, at today's rate.
  const recent = years.filter(y => y.fy < thisFy).slice(-3);
  const yearly = recent.length ? recent.reduce((n, y) => n + y.deposits, 0) / recent.length : 0;
  const endYear = Number((extendedTo ?? maturity).slice(0, 4));
  const project = perYear => {
    if (!rate) return null;
    // This year: the rest of the year's deposit goes in now, and the months still to come earn on it.
    const topUp = Math.max(0, perYear - current.deposits);
    let b = balance + topUp + accrued + (balance + topUp) * rate / 1200 * (12 - due.length);
    // Then whole years to maturity, each deposit made by 5 April.
    for (let fy = thisFy + 1; fy < endYear; fy++) b = (b + perYear) * (1 + rate / 100);
    return b;
  };

  return {
    balance, rate, asOf: list.at(-1).date, opened: account.opened, years, accrued,
    deposits: sumOf('deposit'), interest: sumOf('interest'), withdrawn: sumOf('withdrawal'),
    lastDeposit: [...list].reverse().find(e => e.kind === 'deposit') ?? null,
    thisYear: current.deposits, room: Math.max(0, PPF_LIMIT - current.deposits), belowMinimum: current.deposits < PPF_MINIMUM,
    maturity, extendedTo, canWithdraw, withdrawLimit, flows, yearly, projected: project(yearly), projectedMax: project(PPF_LIMIT), projectedAt: extendedTo ?? maturity,
    entries: list,
  };
}

/* ---------- stored shapes ---------- */

const text = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = v => (Number.isFinite(v) ? v : 0);
const isDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v);

export function cleanPpfAccount(x) {
  return {
    id: text(x.id, 60), kind: 'ppf', name: text(x.name, 80) || 'PPF', bank: text(x.bank, 80),
    accountTail: String(x.accountTail ?? '').replace(/\D/g, '').slice(-4), rate: Number.isFinite(x.rate) ? x.rate : null,
    opened: isDate(x.opened) ? x.opened : null, createdAt: finite(x.createdAt), updatedAt: finite(x.updatedAt),
  };
}

export function cleanPpfStatement(x) {
  if (!x?.id || !x.accountId || !isDate(x.asOf)) return null;
  return {
    id: text(x.id, 80), accountId: text(x.accountId, 60), kind: 'ppf', asOf: x.asOf, from: isDate(x.from) ? x.from : null, to: isDate(x.to) ? x.to : null,
    closing: finite(x.closing), rate: Number.isFinite(x.rate) ? x.rate : null, count: finite(x.count), matches: x.matches === true, updatedAt: finite(x.updatedAt),
  };
}

export function cleanPpfEntry(x) {
  if (!x?.id || !x.accountId || !isDate(x.date) || !['ppf-deposit', 'ppf-interest', 'ppf-withdrawal'].includes(x.kind)) return null;
  return { id: text(x.id, 160), accountId: text(x.accountId, 60), kind: x.kind, date: x.date, amount: finite(x.amount), balance: finite(x.balance), updatedAt: finite(x.updatedAt) };
}
