// The Retirals section: EPF accounts built from the passbook PDFs you load, LIC
// policies from their details and premium receipts, NPS from its statements and
// PPF from the bank's account statement.
// Amounts follow Portfolio's privacy switch and the app's Short amounts setting.

import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import { shortAmounts, shortMoney } from './format.js';
import { pdfLines } from './pdf-text.js';
import { logImport } from './import-log.js';
import { parsePassbook, accountSummary } from './epf.js';
import { parseReceipts, policySummary, MODES } from './lic.js';
import { parseStatement as parseNpsStatement, npsSummary, schemeName, transactionKind } from './nps.js';
import { parsePpfStatement, ppfSummary, PPF_LIMIT, PPF_MINIMUM } from './ppf.js';
import { readWorkbook, readLegacyWorkbook } from './xlsx.js';
import { xirr } from './portfolio.js';

const HOME = '#/s/retirals';
const MASK = '••••••';
let A;

export function initRetirals(helpers) { A = helpers; }

const isPrivate = () => A.ls.get('pfPrivate', false);
const full = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 });
const money = v => (v == null ? '–' : isPrivate() ? MASK : shortAmounts() ? shortMoney(v) : full.format(v));
const day = s => A.fmt(new Date(`${s}T00:00:00`), { dateStyle: 'medium' });
const monthName = key => A.fmt(new Date(`${key}-01T00:00:00`), { month: 'short', year: 'numeric' });
const fyName = y => `${y}-${String(y + 1).slice(2)}`;
const accountPath = id => `${HOME}/a/${id}`;

const accounts = () => [...A.S.retiralAccounts].sort((a, b) => a.createdAt - b.createdAt);
const isPolicy = a => a.kind === 'lic';
const isNps = a => a.kind === 'nps';
const isPpf = a => a.kind === 'ppf';
const epfAccounts = () => accounts().filter(a => !isPolicy(a) && !isNps(a) && !isPpf(a));
const ppfAccounts = () => accounts().filter(isPpf);
// The balance holds as of the latest statement's date, which can be after its last transaction.
const ppfOf = a => {
  const s = ppfSummary(a, A.S.retiralEntries.filter(e => e.accountId === a.id && e.kind.startsWith('ppf-')).map(e => ({ ...e, kind: e.kind.slice(4) })));
  const latest = A.S.retiralStatements.filter(x => x.accountId === a.id && x.kind === 'ppf').reduce((d, x) => (x.asOf > d ? x.asOf : d), '');
  return s && latest > s.asOf ? { ...s, asOf: latest } : s;
};
const npsAccounts = () => accounts().filter(isNps);
const npsOf = a => npsSummary(A.S.retiralStatements.filter(s => s.accountId === a.id), A.S.retiralEntries.filter(e => e.accountId === a.id));
const policies = () => accounts().filter(isPolicy);
const policyOf = a => policySummary(a, A.S.retiralEntries.filter(e => e.accountId === a.id && e.kind === 'premium'));
const accountById = id => A.S.retiralAccounts.find(a => a.id === id);
const summaryOf = id => accountSummary(A.S.retiralStatements.filter(s => s.accountId === id), A.S.retiralEntries.filter(e => e.accountId === id));

// Each kind of retiral has its own page, listing its accounts. The colours match Net worth's.
const TYPES = {
  epf: { label: 'EPF', long: "Employees' Provident Fund", icon: 'briefcase', cls: 'nw-epf', list: () => epfAccounts() },
  nps: { label: 'NPS', long: 'National Pension System', icon: 'chart', cls: 'nw-nps', list: () => npsAccounts() },
  ppf: { label: 'PPF', long: 'Public Provident Fund', icon: 'card', cls: 'nw-ppf', list: () => ppfAccounts() },
  lic: { label: 'LIC', long: 'LIC policies', icon: 'shield', cls: 'nw-lic', list: () => policies() },
};
const typeOf = a => (isPolicy(a) ? 'lic' : isNps(a) ? 'nps' : isPpf(a) ? 'ppf' : 'epf');
const typePath = type => `${HOME}/t/${type}`;

export const retiralsNav = () => [
  { id: 'home', name: 'Overview', icon: 'pie', href: HOME },
  ...Object.entries(TYPES).filter(([, t]) => t.list().length).map(([id, t]) => ({ id, name: t.label, icon: t.icon, href: typePath(id) })),
  { id: 'imports', name: 'Data imports', icon: 'clock', href: '#/s/portfolio/imports', foot: true },
];

export const retiralsRouteValid = r => (r.page === 'type' ? !!TYPES[r.id] : !['account', 'lic-edit'].includes(r.page) || !!accountById(r.id));

// EPF, NPS and PPF together for the home screen's tile, or a count of policies when there are neither.
// LIC isn't added in, as a policy's worth depends on when it's claimed.
export function retiralsTileText() {
  const total = epfAccounts().reduce((n, a) => n + (summaryOf(a.id)?.balance ?? 0), 0) + npsAccounts().reduce((n, a) => n + (npsOf(a)?.latest.value ?? 0), 0) + ppfAccounts().reduce((n, a) => n + (ppfOf(a)?.balance ?? 0), 0);
  if (total) return money(total);
  return policies().length ? A.plural(policies().length, 'policy').replace('policys', 'policies') : '';
}

// Each account's value today, for Net worth. EPF counts its balance, not the
// pension (EPS), which is paid as a pension. LIC counts only its minimum surrender
// value, which is what's certain if it were surrendered today.
export function retiralsParts() {
  return [
    ...epfAccounts().map(a => {
      const s = summaryOf(a.id), last = lastContribution(a.id);
      return s && { id: a.id, kind: 'EPF', name: a.name, value: s.balance, href: accountPath(a.id), monthly: last ? last.employee + last.employer : 0, rate: s.lastRate };
    }),
    ...npsAccounts().map(a => {
      const s = npsOf(a);
      return s && { id: a.id, kind: 'NPS', name: a.name, value: s.latest.value, href: accountPath(a.id), monthly: 0, rate: s.latest.xirr };
    }),
    // PPF counts its balance; the monthly addition is the average yearly deposit of the last three years.
    ...ppfAccounts().map(a => {
      const s = ppfOf(a);
      return s && { id: a.id, kind: 'PPF', name: a.name, value: s.balance, href: accountPath(a.id), monthly: s.yearly / 12, rate: s.rate };
    }),
    ...policies().map(a => ({ id: a.id, kind: 'LIC', name: a.name, value: policyOf(a).surrenderFloor ?? 0, href: accountPath(a.id), monthly: 0, rate: null })),
  ].filter(Boolean);
}

function hero(title, sub, up, extra = '') {
  const eye = isPrivate();
  return `<header class="topbar hero">
    ${A.upButton(up)}
    <span class="hero-icon">${icon('shield')}</span>
    <div class="titles"><h1>${A.esc(title)}</h1><p>${A.esc(sub)}</p></div>
    <button class="icon-btn" data-act="ret-privacy" aria-pressed="${eye}" aria-label="${eye ? 'Show amounts' : 'Hide amounts'}" title="${eye ? 'Show amounts' : 'Hide amounts'}">${icon(eye ? 'eyeOff' : 'eye')}</button>
    ${extra}${A.menuButton}
  </header>`;
}

const stat = (label, value, note = '') => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-note">${note}</span></div>`;

const loadButton = (label = 'Load files') => `<label class="btn sm primary">${icon('upload')}<span>${label}</span><input id="ret-files" type="file" multiple accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv" hidden></label>`;

// The monthly amounts going in, from the latest contribution.
function lastContribution(id) {
  return A.S.retiralEntries.filter(e => e.accountId === id && e.kind === 'contribution').sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}

function summaryStats(s, last) {
  return `<div class="stats five">
    ${stat('EPF balance', money(s.balance), `You ${money(s.employee)} · employer ${money(s.employer)}`)}
    ${stat('Interest building this year', s.pendingInterest ? money(s.accrued) : '–', s.pendingInterest && s.lastRate ? `About, at ${s.lastRate.toFixed(2)}%, credited after March` : 'Credited for the year')}
    ${stat('Interest credited so far', money(s.interest), 'From these passbooks')}
    ${stat('Pension (EPS)', money(s.pension), 'Paid as a pension, not part of the balance')}
    ${stat('Going in each month', last ? money(last.employee + last.employer + last.pension) : '–', last ? `You ${money(last.employee)} · employer ${money(last.employer)} + ${money(last.pension)} pension` : '')}
    ${stat('Withdrawn', money(s.withdrawn), s.withdrawn ? 'From these passbooks' : 'None in these passbooks')}
  </div>`;
}

const receiptButton = (label = 'Load LIC receipts') => `<label class="btn sm">${icon('upload')}<span>${label}</span><input id="ret-receipts" type="file" multiple accept=".pdf,application/pdf" hidden></label>`;
const addPolicyButton = `<a class="btn sm" href="${HOME}/lic">${icon('plus')}<span>Add LIC policy</span></a>`;

function epfBlock(list) {
  const sums = list.map(a => ({ a, s: summaryOf(a.id), last: lastContribution(a.id) })).filter(x => x.s);
  if (!sums.length) return '';
  const add = key => sums.reduce((n, x) => n + (x.s[key] ?? 0), 0);
  const total = {
    balance: add('balance'), employee: add('employee'), employer: add('employer'), pension: add('pension'), interest: add('interest'), withdrawn: add('withdrawn'),
    accrued: add('accrued'), pendingInterest: sums.some(x => x.s.pendingInterest), lastRate: sums.find(x => x.s.lastRate)?.s.lastRate,
  };
  return `<h2 class="ret-head">EPF</h2>
    ${summaryStats(total, sums.length === 1 ? sums[0].last : null)}
    <div class="rows pf-accounts">${sums.map(({ a, s }) => `<a class="sub pf-account" href="${accountPath(a.id)}">
      <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
      <span class="card-meta">${a.memberTail ? `Member ID ending ${A.esc(a.memberTail)} · ` : ''}as of ${day(s.asOf)}</span></span></span>
      <span class="pay-side"><span class="pay-amount">${money(s.balance)}</span><span class="pf-delta">+ ${money(s.pension)} pension</span></span>
    </a>`).join('')}</div>
    <p class="muted small chart-note">Balances are as your latest passbook shows them. Interest for the current year is credited after March, so it's shown as an estimate until then.</p>`;
}

function policyBlock(list) {
  if (!list.length) return '';
  const sums = list.map(a => ({ a, s: policyOf(a) }));
  const add = key => sums.reduce((n, x) => n + (x.s[key] ?? 0), 0);
  const next = sums.map(x => x.s.nextDue && { ...x.s.nextDue, a: x.a }).filter(Boolean).sort((p, q) => p.due.localeCompare(q.due))[0];
  return `<h2 class="ret-head">LIC policies</h2>
    <div class="stats five">
      ${stat('Life cover today', money(add('deathCover')), 'Sum assured and bonus so far, paid on death')}
      ${stat('Premiums paid', money(add('paidTotal')), A.plural(sums.reduce((n, x) => n + x.s.paid.length, 0), 'premium'))}
      ${stat('Premiums left', money(add('leftTotal')), A.plural(sums.reduce((n, x) => n + x.s.left.length, 0), 'premium'))}
      ${stat('Next premium', next ? money(next.amount) : '–', next ? `${day(next.due)} · ${A.esc(next.a.name)}` : 'All paid')}
    </div>
    <div class="rows pf-accounts">${sums.map(({ a, s }) => `<a class="sub pf-account" href="${accountPath(a.id)}">
      <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
      <span class="card-meta">${a.policyTail ? `Policy ending ${A.esc(a.policyTail)} · ` : ''}${s.paid.length} of ${s.schedule.length} premiums paid · pays out ${monthName(s.payout.slice(0, 7))}</span></span></span>
      <span class="pay-side"><span class="pay-amount">${money(s.atPayout)}</span><span class="pf-delta">expected at payout</span></span>
    </a>`).join('')}</div>`;
}

function npsBlock(list) {
  const sums = list.map(a => ({ a, s: npsOf(a) })).filter(x => x.s);
  if (!sums.length) return '';
  const add = key => sums.reduce((n, x) => n + (x.s.latest[key] ?? 0), 0);
  const one = sums.length === 1 ? sums[0].s : null;
  return `<h2 class="ret-head">NPS</h2>
    <div class="stats five">
      ${stat('NPS value', money(add('value')), one ? `As of ${day(one.latest.asOf)}` : '')}
      ${stat('You put in', money(add('contributed')), 'Total contributions, as NPS counts them')}
      ${stat('Gain', money(add('gain')), add('contributed') ? `${(add('gain') / add('contributed') * 100).toFixed(1)}% on what you put in` : '')}
      ${stat('Return', one?.latest.xirr != null ? `${one.latest.xirr.toFixed(2)}%` : '–', 'XIRR, as NPS works it out')}
    </div>
    <div class="rows pf-accounts">${sums.map(({ a, s }) => `<a class="sub pf-account" href="${accountPath(a.id)}">
      <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
      <span class="card-meta">${a.pranTail ? `PRAN ending ${A.esc(a.pranTail)} · ` : ''}${A.esc(s.latest.choice || a.choice)}</span></span></span>
      <span class="pay-side"><span class="pay-amount">${money(s.latest.value)}</span><span class="pf-delta">+ ${money(s.latest.gain)} gain</span></span>
    </a>`).join('')}</div>`;
}

const pct = v => (v == null ? '–' : `${v.toFixed(2)}%`);
const yearsLeft = to => {
  const now = new Date(), end = new Date(`${to}T00:00:00`);
  const months = (end.getFullYear() - now.getFullYear()) * 12 + end.getMonth() - now.getMonth();
  return months <= 0 ? 'now' : `in ${[Math.floor(months / 12) && A.plural(Math.floor(months / 12), 'year'), months % 12 && A.plural(months % 12, 'month')].filter(Boolean).join(' ')}`;
};

function ppfBlock(list) {
  const sums = list.map(a => ({ a, s: ppfOf(a) })).filter(x => x.s);
  if (!sums.length) return '';
  const add = key => sums.reduce((n, x) => n + (x.s[key] ?? 0), 0);
  const one = sums.length === 1 ? sums[0].s : null;
  return `<h2 class="ret-head">PPF</h2>
    <div class="stats five">
      ${stat('PPF balance', money(add('balance')), one ? `As of ${day(one.asOf)}` : '')}
      ${stat('Interest building this year', money(add('accrued')), one?.rate ? `About, at ${one.rate}%, credited 31 March` : 'Credited 31 March')}
      ${stat('You put in', money(add('deposits')), `Interest earned ${money(add('interest'))}`)}
      ${stat('Return', one ? pct(xirr(one.flows)) : '–', 'XIRR on your deposits, tax-free')}
      ${stat('Room this year', money(add('room')), `Of ${money(PPF_LIMIT * sums.length)}, by 31 March`)}
    </div>
    <div class="rows pf-accounts">${sums.map(({ a, s }) => `<a class="sub pf-account" href="${accountPath(a.id)}">
      <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
      <span class="card-meta">${a.accountTail ? `Account ending ${A.esc(a.accountTail)} · ` : ''}${s.extendedTo ? `extended to ${day(s.extendedTo)}` : `matures ${day(s.maturity)}`}</span></span></span>
      <span class="pay-side"><span class="pay-amount">${money(s.balance)}</span><span class="pf-delta">+ ${money(s.accrued)} building</span></span>
    </a>`).join('')}</div>`;
}

function ppfView(a) {
  const s = ppfOf(a);
  const statement = A.S.retiralStatements.filter(x => x.accountId === a.id && x.kind === 'ppf').sort((p, q) => p.asOf.localeCompare(q.asOf)).at(-1);
  const tick = ok => (ok ? `<span class="up">${icon('check')} Matches</span>` : '<span class="down">Differs</span>');
  const ret = s ? xirr(s.flows) : null;
  const ends = s?.extendedTo ?? s?.maturity;
  const insights = s ? [
    s.extendedTo
      ? `Matured on ${day(s.maturity)} and now runs in 5-year blocks; this one ends ${day(s.extendedTo)}, ${yearsLeft(s.extendedTo)}.`
      : `Matures on ${day(s.maturity)}, ${yearsLeft(s.maturity)}, 15 full years after the year it opened. You can then close it, or extend it in 5-year blocks with or without deposits.`,
    s.belowMinimum ? `Put in at least ${money(PPF_MINIMUM)} by 31 March to keep it active; nothing has gone in this year yet.` : `${money(s.thisYear)} has gone in this year, leaving ${money(s.room)} you can still add by 31 March. Deposits by the 5th of a month earn interest for that month.`,
    s.canWithdraw && s.withdrawLimit ? `A partial withdrawal of up to ${money(s.withdrawLimit)} is allowed this year: half the lower of the balances at the end of the fourth year back and of last year.` : '',
    s.projected != null ? `Keeping up ${money(s.yearly)} a year at ${s.rate}%, it would be about ${money(s.projected)} on ${day(ends)}. Putting in the full ${money(PPF_LIMIT)} each year would make it about ${money(s.projectedMax)}.` : '',
  ].filter(Boolean) : [];
  A.view.innerHTML = `${hero(a.name, ['Public Provident Fund', a.accountTail && `account ending ${a.accountTail}`, a.bank].filter(Boolean).join(' · '), typePath(typeOf(a)), `<button class="icon-btn" data-act="ret-menu" data-id="${a.id}" aria-label="Account options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      ${s ? `<div class="stats five">
        ${stat('Balance', money(s.balance), `As of ${day(s.asOf)}`)}
        ${stat('Interest building this year', money(s.accrued), s.rate ? `About, at ${s.rate}%, credited 31 March` : 'Credited 31 March')}
        ${stat('You put in', money(s.deposits), A.plural(s.entries.filter(e => e.kind === 'deposit').length, 'deposit'))}
        ${stat('Interest earned', money(s.interest), s.balance ? `${(s.interest / s.balance * 100).toFixed(1)}% of the balance` : '')}
        ${stat('Return', pct(ret), 'XIRR on your deposits, tax-free')}
        ${stat('This year', money(s.thisYear), `${money(s.room)} of ${money(PPF_LIMIT)} left to put in`)}
      </div>` : ''}
      <div class="status">${icon('clock')}<span>From the statement of ${statement ? day(statement.asOf) : '–'}${statement ? `, ${statement.matches ? 'its balances and totals all matching' : 'which doesn\'t match its own totals'}` : ''}. Opened ${a.opened ? day(a.opened) : '–'}.</span></div>
      <div class="btn-row">${loadButton('Load a newer statement')}</div>
      ${insights.length ? `<section class="panel"><h2>Insights</h2><ul class="ret-insights">${insights.map(t => `<li>${t}</li>`).join('')}</ul></section>` : ''}
      <section class="panel"><h2>Year by year</h2>
        <p class="muted small chart-note">Interest is credited each 31 March, on the lowest balance between the 5th and the end of each month. Effective rate is the year's interest over that average balance, which comes to the rate the government declared.</p>
        <div class="holdings-wrap"><table class="holdings pf-summary">
          <thead><tr><th>Year</th>${['Opening', 'Put in', 'Interest', 'Withdrawn', 'Closing', 'Effective rate'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
          <tbody>${[...(s?.years ?? [])].reverse().map(y => `<tr><th scope="row">${fyName(y.fy)}</th><td class="num">${money(y.opening)}</td><td class="num">${money(y.deposits)}</td>
            <td class="num">${y.credited ? money(y.interest) : y.fy === s.years.at(-1).fy ? `<span class="muted">About ${money(s.accrued)} so far</span>` : money(y.interest)}</td><td class="num">${money(y.withdrawn)}</td><td class="num">${money(y.closing)}</td><td class="num">${pct(y.rate)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel"><details class="pf-details"><summary>Transactions · ${s?.entries.length ?? 0}</summary>
        <div class="holdings-wrap"><table class="holdings lots">
          <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
          <tbody>${[...(s?.entries ?? [])].reverse().map(e => `<tr class="${e.kind === 'withdrawal' ? 'ret-out' : ''}"><td>${day(e.date)}</td><td>${{ deposit: 'Deposit', interest: 'Interest', withdrawal: 'Withdrawal' }[e.kind]}</td>
            <td class="num">${money(e.kind === 'withdrawal' ? -e.amount : e.amount)}</td><td class="num">${money(e.balance)}</td></tr>`).join('')}</tbody>
        </table></div>
      </details></section>
      <p class="muted small chart-note">Only the bank, the account number's last four digits, the rate, the dates and the amounts are kept from the statement, never your name, address, email, branch or the savings account deposits come from.</p>
    </div></div>`;
  bindFiles();
}

// One PPF statement. Each transaction is kept by its date, kind, amount and balance,
// so a newer statement covering the same years adds only what's new.
async function savePpf(p) {
  const now = Date.now();
  let account = A.S.retiralAccounts.find(a => a.kind === 'ppf' && a.accountTail === p.accountTail);
  const bankShort = /State Bank of India/i.test(p.bank) ? 'SBI' : p.bank.replace(/\s*Bank$/i, '');
  if (!account) {
    account = { id: A.uid(), kind: 'ppf', name: `PPF${bankShort ? ` · ${bankShort}` : ''}`, bank: p.bank, accountTail: p.accountTail, rate: p.rate, opened: p.opened, createdAt: now, updatedAt: now };
    A.S.retiralAccounts.push(account);
  } else {
    Object.assign(account, { rate: p.rate ?? account.rate, opened: p.opened ?? account.opened, bank: p.bank || account.bank, updatedAt: now });
  }
  await db.put('retiralAccounts', account);
  const statement = { id: `${account.id}:ppf:${p.asOf}`, accountId: account.id, kind: 'ppf', asOf: p.asOf, from: p.from, to: p.to, closing: p.closing, rate: p.rate, count: p.entries.length, matches: p.matches, updatedAt: now };
  const entries = p.entries.map(e => ({ id: `${account.id}:ppf:${e.date}:${e.kind}:${e.amount}:${e.balance}`, accountId: account.id, kind: `ppf-${e.kind}`, date: e.date, amount: e.amount, balance: e.balance, updatedAt: now }));
  const ids = new Set(entries.map(e => e.id));
  A.S.retiralEntries = [...A.S.retiralEntries.filter(e => !ids.has(e.id)), ...entries];
  A.S.retiralStatements = [...A.S.retiralStatements.filter(x => x.id !== statement.id), statement];
  await db.putMany('retiralEntries', entries);
  await db.put('retiralStatements', statement);
  return statement;
}

function homeView() {
  const epf = epfAccounts(), lic = policies(), nps = npsAccounts(), ppf = ppfAccounts();
  if (!epf.length && !lic.length && !nps.length && !ppf.length) {
    A.view.innerHTML = `${hero('Retirals', 'EPF, NPS, LIC and other retirement savings', '#/')}
      <div class="scroll"><div class="empty">${icon('shield')}<p>Load your EPF passbook PDFs, NPS transaction statement CSVs, PPF account statements or LIC premium receipts, in any mix. Add an LIC policy first for its receipts.</p>
      <div class="pf-start"><div class="btn-row">${loadButton()}${addPolicyButton}</div></div>
      <p class="muted small">Only the employer's name, the last four digits of member IDs, PRANs, PPF accounts and policy numbers, and the amounts are kept, never your name, date of birth, UAN, PAN, bank details, address or nominee.</p></div></div>`;
    return bindFiles();
  }
  const d = dashboard();
  const total = d.parts.reduce((n, p) => n + p.value, 0);
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const stale = asOf => asOf && (Date.parse(today) - Date.parse(asOf)) / 864e5 > 120;
  A.view.innerHTML = `${hero('Retirals', Object.values(TYPES).filter(t => t.list().length).map(t => t.label).join(' · '), '#/')}
    <div class="scroll"><div class="pay-page pf-page">
      <div class="stats five">
        ${stat('Retirement savings', money(d.savings), 'EPF, NPS and PPF today')}
        ${stat('Interest building this year', money(d.building), 'EPF and PPF, credited after March')}
        ${stat('Going in a year', money(d.yearly), [d.epfYear && `EPF ${money(d.epfYear)}`, d.ppfYear && `PPF ${money(d.ppfYear)}`, d.licYear && `LIC ${money(d.licYear)}`].filter(Boolean).join(' · ') || 'Nothing regular on record')}
        ${stat('LIC payouts ahead', lic.length ? money(d.payouts) : '–', lic.length ? `Life cover ${money(d.cover)}` : 'No policies')}
        ${stat('Next payment due', d.nextDue ? money(d.nextDue.amount) : '–', d.nextDue ? `${day(d.nextDue.date)} · ${A.esc(d.nextDue.what)}` : 'Nothing due in the next year')}
      </div>
      ${total ? `<section class="panel"><h2>Where it sits</h2>
        <div class="nw-bar ret-mix" role="img" aria-label="${d.parts.map(p => `${p.label} ${Math.round(p.value / total * 100)}%`).join(', ')}">${d.parts.map(p => `<span class="${p.cls}" style="width:${p.value / total * 100}%"></span>`).join('')}</div>
        <div class="ret-mix-key">${d.parts.map(p => `<span><i class="sw ${p.cls}"></i>${p.label} ${money(p.value)} <span class="muted">${(p.value / total * 100).toFixed(1)}%</span></span>`).join('')}</div>
        <p class="muted small chart-note">LIC counts its minimum surrender value, the certain part today, as Net worth does. EPF leaves out the pension (EPS).</p>
      </section>` : ''}
      <div class="ret-types">${d.cards.map(c => `<a class="ret-type" href="${typePath(c.id)}">
        <span class="ret-type-head"><i class="sw ${TYPES[c.id].cls}"></i><strong>${TYPES[c.id].label}</strong><span class="muted small">${A.esc(c.count)}</span>${icon('chevron')}</span>
        <span class="ret-type-value">${money(c.value)}</span>
        <span class="muted small">${c.lines.filter(Boolean).join('<br>')}</span>
        ${c.asOf ? `<span class="small ${stale(c.asOf) ? 'down' : 'muted'}">As of ${day(c.asOf)}${stale(c.asOf) ? ', load a newer one' : ''}</span>` : ''}
      </a>`).join('')}</div>
      ${d.upcoming.length ? `<section class="panel"><h2>Coming up</h2>
        <ul class="ret-upcoming">${d.upcoming.slice(0, 6).map(u => `<li><span class="ret-up-date">${day(u.date)}</span><span>${A.esc(u.what)}</span><span class="num">${u.amount != null ? `${u.upTo ? 'up to ' : ''}${money(u.amount)}` : ''}</span></li>`).join('')}</ul>
      </section>` : ''}
      <div class="btn-row">${loadButton()}${addPolicyButton}</div>
      <p class="muted small chart-note">Load files takes EPF passbook PDFs, NPS statement CSVs, PPF account statements (.xlsx or .xls) and LIC premium receipts, in any mix.</p>
    </div></div>`;
  bindFiles();
}

// The overview's figures: totals, the mix, a card a type and what's due in the next year.
function dashboard() {
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const inYear = `${now.getFullYear() + 1}${today.slice(4)}`;
  const march = `${now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear()}-03-31`;
  const epf = epfAccounts().map(a => ({ a, s: summaryOf(a.id), last: lastContribution(a.id) })).filter(x => x.s);
  const nps = npsAccounts().map(a => ({ a, s: npsOf(a) })).filter(x => x.s);
  const ppf = ppfAccounts().map(a => ({ a, s: ppfOf(a) })).filter(x => x.s);
  const lic = policies().map(a => ({ a, s: policyOf(a) }));
  const sum = (list, f) => list.reduce((n, x) => n + (f(x) ?? 0), 0);
  const latest = list => list.reduce((d, x) => (x > d ? x : d), '');
  const epfYear = sum(epf, x => (x.last ? (x.last.employee + x.last.employer) * 12 : 0));
  const ppfYear = sum(ppf, x => x.s.yearly);
  const licDue = lic.flatMap(x => x.s.left.filter(p => p.due <= inYear).map(p => ({ ...p, name: x.a.name })));
  const licYear = licDue.reduce((n, p) => n + p.amount, 0);
  const parts = [
    { id: 'epf', label: 'EPF', cls: 'nw-epf', value: sum(epf, x => x.s.balance) },
    { id: 'nps', label: 'NPS', cls: 'nw-nps', value: sum(nps, x => x.s.latest.value) },
    { id: 'ppf', label: 'PPF', cls: 'nw-ppf', value: sum(ppf, x => x.s.balance) },
    { id: 'lic', label: 'LIC', cls: 'nw-lic', value: sum(lic, x => x.s.surrenderFloor) },
  ].filter(p => p.value > 0);
  const n = (list, word) => A.plural(list.length, word);
  const cards = [
    epf.length && { id: 'epf', count: n(epf, 'account'), value: sum(epf, x => x.s.balance), asOf: latest(epf.map(x => x.s.asOf)),
      lines: [`+ ${money(sum(epf, x => x.s.pension))} pension (EPS)`, epfYear ? `${money(epfYear / 12)} going in a month` : '', sum(epf, x => x.s.accrued) ? `About ${money(sum(epf, x => x.s.accrued))} interest building` : ''] },
    nps.length && { id: 'nps', count: n(nps, 'account'), value: sum(nps, x => x.s.latest.value), asOf: latest(nps.map(x => x.s.latest.asOf)),
      lines: [`${money(sum(nps, x => x.s.latest.gain))} gain on ${money(sum(nps, x => x.s.latest.contributed))} put in`, nps.length === 1 && nps[0].s.latest.xirr != null ? `${nps[0].s.latest.xirr.toFixed(2)}% a year, as NPS works it out` : ''] },
    ppf.length && { id: 'ppf', count: n(ppf, 'account'), value: sum(ppf, x => x.s.balance), asOf: latest(ppf.map(x => x.s.asOf)),
      lines: [`+ ${money(sum(ppf, x => x.s.accrued))} interest building`, ppf.length === 1 ? (ppf[0].s.extendedTo ? `Extended to ${day(ppf[0].s.extendedTo)}` : `Matures ${day(ppf[0].s.maturity)}`) : '', `${money(sum(ppf, x => x.s.room))} room this year`] },
    lic.length && { id: 'lic', count: lic.length === 1 ? '1 policy' : `${lic.length} policies`, value: sum(lic, x => x.s.atPayout),
      lines: ['Expected at payout', `Cover ${money(sum(lic, x => x.s.deathCover))} · surrender ${money(sum(lic, x => x.s.surrenderFloor))}`, `${sum(lic, x => x.s.left.length)} premiums left`] },
  ].filter(Boolean);
  // Dated things in the next year: premiums, PPF's deposit deadline, interest credits, maturities and payouts.
  const upcoming = [
    ...licDue.map(p => ({ date: p.due, what: `LIC premium · ${p.name}`, amount: p.amount, due: true })),
    ...ppf.filter(x => x.s.room > 0).map(x => (x.s.belowMinimum
      ? { date: march, what: `PPF minimum deposit to keep it active · ${x.a.name}`, amount: PPF_MINIMUM, due: true }
      : { date: march, what: `Last day to add to PPF this year · ${x.a.name}`, amount: x.s.room, upTo: true })),
    ...ppf.filter(x => x.s.accrued).map(x => ({ date: march, what: `PPF interest credited · ${x.a.name}`, amount: x.s.accrued })),
    ...epf.filter(x => x.s.pendingInterest && x.s.accrued).map(x => ({ date: march, what: `EPF interest for the year, credited after March · ${x.a.name}`, amount: x.s.accrued })),
    ...ppf.filter(x => x.s.maturity > today && x.s.maturity <= inYear).map(x => ({ date: x.s.maturity, what: `PPF matures · ${x.a.name}`, amount: null })),
    ...lic.filter(x => x.s.payout > today && x.s.payout <= inYear).map(x => ({ date: x.s.payout, what: `LIC pays out · ${x.a.name}`, amount: x.s.atPayout })),
  ].filter(u => u.date >= today && u.date <= inYear).sort((p, q) => p.date.localeCompare(q.date));
  return {
    parts, cards, upcoming, nextDue: upcoming.find(u => u.due) ?? null,
    savings: sum(epf, x => x.s.balance) + sum(nps, x => x.s.latest.value) + sum(ppf, x => x.s.balance),
    building: sum(epf, x => x.s.accrued) + sum(ppf, x => x.s.accrued),
    epfYear, ppfYear, licYear, yearly: epfYear + ppfYear + licYear,
    payouts: sum(lic, x => x.s.atPayout), cover: sum(lic, x => x.s.deathCover),
  };
}

// One kind's page: its totals and accounts.
function typeView(type) {
  const t = TYPES[type];
  const list = t.list();
  const block = { epf: epfBlock, nps: npsBlock, ppf: ppfBlock, lic: policyBlock }[type](list).replace(/^\s*<h2 class="ret-head">.*?<\/h2>/, '');
  const buttons = type === 'lic' ? `${receiptButton()}${addPolicyButton}` : loadButton(type === 'epf' ? 'Load passbooks' : 'Load statements');
  A.view.innerHTML = `${hero(t.label, `${t.long} · ${A.plural(list.length, type === 'lic' ? 'policy' : 'account').replace('policys', 'policies')}`, HOME)}
    <div class="scroll"><div class="pay-page pf-page">
      ${block || `<div class="empty">${icon(t.icon)}<p>Nothing here yet.</p></div>`}
      <div class="btn-row">${buttons}</div>
    </div></div>`;
  bindFiles();
}

/* ---------- NPS ---------- */

function npsView(a) {
  const s = npsOf(a);
  const tick = ok => (ok ? `<span class="up">${icon('check')} Matches</span>` : '<span class="down">Differs</span>');
  const latest = s?.latest;
  const moved = s?.txns.find(t => transactionKind(t) === 'Moved to Direct');
  const txns = [...(s?.txns ?? [])].sort((p, q) => q.date.localeCompare(p.date) || p.scheme.localeCompare(q.scheme));
  A.view.innerHTML = `${hero(a.name, [a.pranTail && `PRAN ending ${a.pranTail}`, latest?.choice || a.choice].filter(Boolean).join(' · '), typePath(typeOf(a)), `<button class="icon-btn" data-act="ret-menu" data-id="${a.id}" aria-label="Account options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      ${latest ? `<div class="stats five">
        ${stat('Value', money(latest.value), `As of ${day(latest.asOf)}${latest.navDate ? `, at NAVs of ${day(latest.navDate)}` : ''}`)}
        ${stat('You put in', money(latest.contributed), `${A.plural(latest.count, 'contribution')}, as NPS counts them`)}
        ${stat('Gain', money(latest.gain), latest.contributed ? `${(latest.gain / latest.contributed * 100).toFixed(1)}% on what you put in` : '')}
        ${stat('Return', latest.xirr != null ? `${latest.xirr.toFixed(2)}%` : '–', 'XIRR, as NPS works it out')}
        ${stat('Last contribution', s.lastContribution ? money(s.lastContribution.total) : '–', s.lastContribution ? `${day(s.lastContribution.date)}, ${A.esc(s.lastContribution.note)}` : 'None in these statements')}
        ${stat('Charges', money(s.charges), 'Quarterly billing in these statements')}
      </div>` : ''}
      <div class="btn-row">${loadButton('Load more statements')}</div>
      ${moved ? `<div class="status">${icon('alert')}<span>On ${day(moved.date)}, NPS moved every unit from the ${A.esc(s.txns.find(t => t.route === 'POP')?.route ?? 'POP')} route to Direct, citing dormancy rules. It's the same schemes and value, now held directly, not through a point of presence such as a broker.</span></div>` : ''}
      ${latest ? `<section class="panel"><h2>Holdings</h2>
        ${s.mix[0]?.fund ? `<p class="muted small chart-note">Managed by ${A.esc(s.mix[0].fund)}.</p>` : ''}
        <div class="holdings-wrap"><table class="holdings pf-summary">
          <thead><tr><th>Scheme</th>${['Units', 'NAV', 'Value', 'Share'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
          <tbody>${s.mix.map(h => `<tr><th scope="row">${schemeName(h.scheme)}<small class="muted"> · ${A.esc(h.route)}</small></th>
            <td class="num">${isPrivate() ? MASK : h.units.toFixed(4)}</td><td class="num">${h.nav.toFixed(4)}</td><td class="num">${money(h.value)}</td><td class="num">${h.share.toFixed(1)}%</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td></td><td></td><td class="num">${money(latest.value)}</td><td class="num">100%</td></tr></tfoot>
        </table></div>
      </section>` : ''}
      <section class="panel"><h2>Statement by statement</h2>
        <p class="muted small chart-note">Each statement's own summary. Its units are checked to run from the opening balance to the closing one, scheme by scheme.</p>
        <div class="holdings-wrap"><table class="holdings pf-summary">
          <thead><tr><th>As of</th>${['Value', 'You put in so far', 'Gain', 'Return', 'Charges', 'Units'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
          <tbody>${[...(s?.statements ?? [])].reverse().map(x => `<tr><th scope="row">${day(x.asOf)}</th><td class="num">${money(x.value)}</td><td class="num">${money(x.contributed)}</td><td class="num">${money(x.gain)}</td>
            <td class="num">${x.xirr != null ? `${x.xirr.toFixed(2)}%` : '–'}</td><td class="num">${money(x.charges)}</td><td class="num">${tick(x.matches)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel"><h2>Contributions</h2>
        ${s?.contributions.length ? `<div class="holdings-wrap"><table class="holdings lots">
          <thead><tr><th>Credited</th><th>For</th><th>Through</th><th class="num">You</th><th class="num">Employer</th><th class="num">Total</th></tr></thead>
          <tbody>${s.contributions.map(c => `<tr><td>${day(c.date)}</td><td>${A.esc(c.note)}</td><td>${A.esc(c.via)}</td><td class="num">${money(c.employee)}</td><td class="num">${money(c.employer)}</td><td class="num">${money(c.total)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted small">None listed in these statements.</p>'}
      </section>
      <section class="panel"><details class="pf-details"><summary>Scheme transactions · ${txns.length}</summary>
        <div class="holdings-wrap"><table class="holdings lots">
          <thead><tr><th>Date</th><th>Scheme</th><th>What</th>${['Amount', 'NAV', 'Units'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
          <tbody>${txns.map(t => `<tr class="${t.amount < 0 && transactionKind(t) !== 'Moved to Direct' ? 'ret-out' : ''}"><td>${day(t.date)}</td><td>${t.scheme} · ${A.esc(t.route)}</td><td title="${A.esc(t.description)}">${transactionKind(t)}</td>
            <td class="num">${money(t.amount)}</td><td class="num">${t.nav.toFixed(4)}</td><td class="num">${isPrivate() ? MASK : t.units.toFixed(4)}</td></tr>`).join('')}</tbody>
        </table></div>
      </details></section>
      <p class="muted small chart-note">Totals and the return are NPS's own figures from each statement. Older history may sit with a previous record-keeping agency, so the contributions and transactions here can start later than the account.</p>
    </div></div>`;
  bindFiles();
}

/* ---------- LIC policies ---------- */

function policyView(a) {
  const s = policyOf(a);
  const receiptRows = new Map(A.S.retiralEntries.filter(e => e.accountId === a.id && e.kind === 'premium').map(e => [e.dueMonth, e]));
  const withReceipt = s.schedule.filter(d => receiptRows.has(d.due.slice(0, 7))).length;
  const plan = [a.plan, a.table ? `table ${a.table}` : '', a.policyTail ? `policy ending ${a.policyTail}` : ''].filter(Boolean).join(' · ');
  A.view.innerHTML = `${hero(a.name, plan, typePath(typeOf(a)), `<button class="icon-btn" data-act="ret-menu" data-id="${a.id}" aria-label="Policy options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      <div class="stats five">
        ${stat('Sum assured', money(a.sumAssured), `${a.premiumYears} years of premiums, cover to ${monthName(a.maturity?.slice(0, 7) ?? s.payout.slice(0, 7))}`)}
        ${stat('Bonus so far', money(a.vestedBonus), `Plus ${money(a.interimBonus)} interim bonus this year`)}
        ${stat('Premiums paid', money(s.paidTotal), `${s.paid.length} of ${s.schedule.length}, ${money(a.premium)} ${a.mode.toLowerCase()}`)}
        ${stat('Premiums left', money(s.leftTotal), s.left.length ? `${s.left.length} more, the last on ${day(s.lastDue)}` : 'All paid')}
        ${stat('Next premium', s.nextDue ? day(s.nextDue.due) : '–', s.nextDue ? `${money(s.nextDue.amount)} · Auto Pay ${a.autoPay ? 'on' : 'off'}` : 'No more premiums')}
        ${stat('Return on premiums', s.returnRate != null ? `${s.returnRate.toFixed(1)}%` : '–', 'A year, to the payout, before any final bonus')}
      </div>
      <section class="panel"><h2>What the policy pays</h2>
        <ol class="ret-steps">
          <li><b>${monthName(s.payout.slice(0, 7))}: about ${money(s.atPayout)}</b><span>The sum assured with bonuses, if you survive the premium term: ${money(a.sumAssured)} sum assured, ${money(a.vestedBonus)} bonus so far, and about ${money(s.futureBonus)} more from ${A.plural(s.declarationsAhead, 'bonus')} still to be declared at this year's rate of ₹${Math.round(s.bonusRate)} per ₹1,000. Any final additional bonus is extra.</span></li>
          ${a.table === 149 ? `<li><b>After that, until ${a.maturity ? monthName(a.maturity.slice(0, 7)) : 'the end of the term'}: ${money(a.sumAssured)} life cover</b><span>Jeevan Anand keeps the sum assured as cover for life, paid on death, with no further premiums.</span></li>` : ''}
          <li><b>On death before then: about ${money(s.deathCover)}</b><span>The sum assured and the bonus so far${a.riderSumAssured ? `, plus ${money(a.riderSumAssured)} more if death is from an accident (${A.esc(a.riderName || 'accident rider')})` : ''}.</span></li>
          <li><b>If you surrender it now: at least ${money(s.surrenderFloor)}</b><span>LIC's guaranteed minimum is 30% of premiums paid after the first year, plus a cash value for the bonus that LIC works out. Ask LIC for the actual figure, as it's usually higher.</span></li>
        </ol>
        <p class="muted small chart-note">Bonus rates change each year, so the payout is an estimate. Figures are as at ${a.bonusAsOf ? day(a.bonusAsOf) : 'the date you entered them'}; edit the policy when LIC shows new bonus figures.</p>
      </section>
      <section class="panel"><h2>Premiums</h2>
        <p class="muted small chart-note">${withReceipt ? `${A.plural(withReceipt, 'premium')} with a receipt loaded.` : 'No receipts loaded yet.'} Others count as paid because LIC's next due date is after them.</p>
        <div class="btn-row">${receiptButton('Load premium receipts')}</div>
        <div class="holdings-wrap"><table class="holdings lots">
          <thead><tr><th>#</th><th>Due</th><th>Status</th><th>Paid on</th><th class="num">Amount</th></tr></thead>
          <tbody>${[...s.schedule].reverse().map(d => {
            const r = receiptRows.get(d.due.slice(0, 7));
            const status = r ? `<span class="up">${icon('check')} Receipt</span>` : d.paid ? 'Paid' : d === s.nextDue ? '<b>Next</b>' : 'To pay';
            return `<tr class="${d.paid ? '' : 'ret-due'}"><td>${d.n}</td><td>${day(d.due)}</td><td>${status}</td><td>${r ? day(r.date) : '–'}</td><td class="num">${money(r?.amount ?? d.amount)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>
    </div></div>`;
  bindFiles();
}

const POLICY_FIELDS = [
  ['name', 'Name in this app', 'text', 'LIC Jeevan Anand'],
  ['plan', 'Plan', 'text', 'Jeevan Anand'],
  ['table', 'Table (plan number)', 'number', '149'],
  ['policyTail', 'Policy number (only the last four digits are kept)', 'text', ''],
  ['sumAssured', 'Basic sum assured (₹)', 'number', ''],
  ['premium', 'Installment premium, including GST (₹)', 'number', ''],
  ['mode', 'Payment mode', 'select', 'Yearly'],
  ['start', 'Commencement date', 'date', ''],
  ['premiumYears', 'Premium payment term (years)', 'number', ''],
  ['termYears', 'Policy term (years)', 'number', ''],
  ['maturity', 'Maturity date', 'date', ''],
  ['vestedBonus', 'Vested bonus so far (₹)', 'number', '0'],
  ['interimBonus', 'Interim bonus this year (₹)', 'number', '0'],
  ['bonusAsOf', 'Bonus figures as of', 'date', ''],
  ['nextDue', 'Next premium date', 'date', ''],
  ['riderName', 'Rider (optional)', 'text', ''],
  ['riderSumAssured', 'Rider sum assured (₹)', 'number', '0'],
];

// One form adds a policy or edits one, from the figures on LIC's app or portal.
function policyForm(r) {
  const a = r.page === 'lic-edit' ? accountById(r.id) : null;
  const today = new Date().toISOString().slice(0, 10);
  const value = (key, fallback) => (a ? a[key] ?? '' : key === 'bonusAsOf' ? today : fallback);
  A.view.innerHTML = `
    <header class="topbar">${A.upButton(a ? accountPath(a.id) : HOME)}<div class="titles"><h1>${a ? 'Edit policy' : 'Add LIC policy'}</h1><p>Retirals</p></div>${A.menuButton}</header>
    <div class="scroll"><form class="pay-form" id="ret-policy" novalidate>
      <p class="muted small wide">Copy these from the policy details in the LIC app or portal. The policy number keeps only its last four digits, and no name, address or nominee is stored.</p>
      ${POLICY_FIELDS.map(([key, label, type, fallback]) => `<label class="f${['name', 'riderName', 'policyTail'].includes(key) ? ' wide' : ''}"><span>${label}</span>${type === 'select'
        ? `<select name="${key}">${MODES.map(m => `<option${m === value(key, fallback) ? ' selected' : ''}>${m}</option>`).join('')}</select>`
        : `<input name="${key}" type="${type}"${type === 'number' ? ' step="any" min="0"' : ''} value="${A.esc(String(value(key, fallback)))}"${['sumAssured', 'premium', 'start', 'premiumYears'].includes(key) ? ' required' : ''}>`}</label>`).join('')}
      <label class="switch wide"><input type="checkbox" name="autoPay"${a?.autoPay ? ' checked' : ''}><span>Auto Pay is on</span></label>
      <div class="f-actions wide"><button class="btn primary" type="submit">${a ? 'Save' : 'Add policy'}</button><a class="btn ghost" href="${a ? accountPath(a.id) : HOME}">Cancel</a></div>
    </form></div>`;
  A.$('#ret-policy').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    if (!form.reportValidity()) return;
    const v = Object.fromEntries(new FormData(form));
    const num = k => Number(v[k]) || 0;
    const now = Date.now();
    const policy = {
      ...(a ?? { id: A.uid(), createdAt: now }), kind: 'lic', name: v.name.trim() || 'LIC policy', plan: v.plan.trim(), table: Math.round(num('table')),
      policyTail: String(v.policyTail).replace(/\D/g, '').slice(-4), sumAssured: num('sumAssured'), premium: num('premium'), mode: v.mode,
      start: v.start, premiumYears: Math.round(num('premiumYears')), termYears: Math.round(num('termYears')) || Math.round(num('premiumYears')),
      maturity: v.maturity || null, vestedBonus: num('vestedBonus'), interimBonus: num('interimBonus'), bonusAsOf: v.bonusAsOf || today,
      nextDue: v.nextDue || null, autoPay: v.autoPay === 'on', riderName: v.riderName.trim(), riderSumAssured: num('riderSumAssured'), updatedAt: now,
    };
    A.S.retiralAccounts = [...A.S.retiralAccounts.filter(x => x.id !== policy.id), policy];
    await db.put('retiralAccounts', policy);
    A.markDirty();
    A.go(accountPath(policy.id), true);
  });
}

// Each receipt marks its premium as paid with a receipt, and a later next due date
// moves the policy's own one forward. Returns how many were saved, and any problems.
async function saveReceipts(receipts) {
  let saved = 0;
  const problems = [];
  for (const r of receipts) {
    const policy = policies().find(p => p.policyTail === r.policyTail);
    if (!policy) {
      problems.push(`no LIC policy ending ${r.policyTail} here yet, so add it first`);
      continue;
    }
    const entry = { id: `${policy.id}:premium:${r.dueFrom ?? r.date.slice(0, 7)}`, accountId: policy.id, kind: 'premium', date: r.date, dueMonth: r.dueFrom ?? r.date.slice(0, 7), amount: r.amount, installments: r.installments, lateFee: r.lateFee, updatedAt: Date.now() };
    A.S.retiralEntries = [...A.S.retiralEntries.filter(e => e.id !== entry.id), entry];
    await db.put('retiralEntries', entry);
    const next = r.nextDue ? `${r.nextDue}-${policy.start.slice(8)}` : null;
    if (next && (!policy.nextDue || next > policy.nextDue)) {
      Object.assign(policy, { nextDue: next, updatedAt: Date.now() });
      await db.put('retiralAccounts', policy);
    }
    saved++;
  }
  return { saved, problems };
}

// One NPS statement. Statements cover separate periods, so each adds its own
// contributions and transactions; loading one again replaces its copy.
async function saveNps(s) {
  const now = Date.now();
  let account = A.S.retiralAccounts.find(a => a.kind === 'nps' && a.pranTail === s.pranTail);
  if (!account) {
    account = { id: A.uid(), kind: 'nps', name: `NPS ${s.tier}`, tier: s.tier, choice: s.choice, pranTail: s.pranTail, createdAt: now, updatedAt: now };
    A.S.retiralAccounts.push(account);
    await db.put('retiralAccounts', account);
  }
  const statement = { id: `${account.id}:${s.asOf}`, accountId: account.id, kind: 'nps', asOf: s.asOf, navDate: s.navDate, xirr: s.xirr, value: s.value, count: s.count, contributed: s.contributed, withdrawn: s.withdrawn, gain: s.gain, charges: s.charges, choice: s.choice, holdings: s.holdings, matches: s.matches, updatedAt: now };
  const seen = new Map();
  const unique = key => {
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return `${key}:${seen.get(key)}`;
  };
  const entries = [
    ...s.contributions.map(c => ({ ...c, id: unique(`${account.id}:c:${c.date}:${c.note}:${c.total}`), accountId: account.id, kind: 'nps-contribution', updatedAt: now })),
    ...s.transactions.map(t => ({ ...t, id: unique(`${account.id}:t:${t.scheme}:${t.route}:${t.date}:${t.description.slice(0, 40)}:${t.units}`), accountId: account.id, kind: 'nps-transaction', updatedAt: now })),
  ];
  const ids = new Set(entries.map(e => e.id));
  A.S.retiralEntries = [...A.S.retiralEntries.filter(e => !ids.has(e.id)), ...entries];
  A.S.retiralStatements = [...A.S.retiralStatements.filter(x => x.id !== statement.id), statement];
  await db.putMany('retiralEntries', entries);
  await db.put('retiralStatements', statement);
  if (s.choice && s.choice !== account.choice) {
    Object.assign(account, { choice: s.choice, updatedAt: now });
    await db.put('retiralAccounts', account);
  }
  return statement;
}

function accountView(r) {
  const a = accountById(r.id);
  if (isPolicy(a)) return policyView(a);
  if (isNps(a)) return npsView(a);
  if (isPpf(a)) return ppfView(a);
  const s = summaryOf(a.id);
  const statements = s?.years ?? [];
  const tick = ok => (ok ? `<span class="up">${icon('check')} Matches</span>` : '<span class="down">Differs</span>');
  A.view.innerHTML = `${hero(a.name, `Employees' Provident Fund${a.memberTail ? ` · member ID ending ${a.memberTail}` : ''}`, typePath(typeOf(a)), `<button class="icon-btn" data-act="ret-menu" data-id="${a.id}" aria-label="Account options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      ${s ? summaryStats(s, lastContribution(a.id)) : ''}
      <div class="status">${icon('clock')}<span>As of ${s ? day(s.asOf) : '–'}, from passbooks for ${statements.map(y => fyName(y.fy)).join(', ')}.</span></div>
      <div class="btn-row">${loadButton('Load more passbooks')}</div>
      <section class="panel"><h2>Year by year</h2>
        <p class="muted small chart-note">Effective rate is the year's interest over its average month-end balance, close to the rate EPFO declared. Money moved in partway through a year lowers it. Each year is checked against the passbook's printed closing balance.</p>
        <div class="holdings-wrap"><table class="holdings pf-summary">
          <thead><tr><th>Year</th>${['Opening', 'You put in', 'Employer put in', 'Moved in', 'Withdrawn', 'Interest', 'Closing', 'Effective rate', 'Pension (EPS)', 'Passbook'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
          <tbody>${[...statements].reverse().map(y => `<tr>
            <th scope="row">${fyName(y.fy)}</th>
            <td class="num">${money(y.opening[0] + y.opening[1])}</td>
            <td class="num">${money(y.contributed[0])}</td>
            <td class="num">${money(y.contributed[1])}</td>
            <td class="num">${money(y.movedIn)}</td>
            <td class="num">${y.withdrawn ? money(-y.withdrawn) : money(0)}</td>
            <td class="num">${y.interestUpto ? money(y.interest[0] + y.interest[1]) : 'After March'}</td>
            <td class="num">${money(y.closing[0] + y.closing[1])}</td>
            <td class="num">${y.rate ? `${y.rate.toFixed(2)}%` : '–'}</td>
            <td class="num">${money(y.closing[2])}</td>
            <td class="num">${tick(y.matches)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel"><h2>Passbook</h2>
        ${[...statements].reverse().map((y, i) => `<details class="pf-details"${i ? '' : ' open'}><summary>${fyName(y.fy)} · ${y.own.length} ${y.own.length === 1 ? 'entry' : 'entries'}</summary>
          <div class="holdings-wrap"><table class="holdings lots">
            <thead><tr><th>Wage month</th><th>Credited</th><th>What</th><th class="num">Your share</th><th class="num">Employer</th><th class="num">Pension</th></tr></thead>
            <tbody>${[...y.own].sort((p, q) => q.date.localeCompare(p.date) || q.wageMonth.localeCompare(p.wageMonth)).map(e => {
              const out = e.kind === 'withdrawal' ? -1 : 1;
              return `<tr class="${e.kind === 'withdrawal' ? 'ret-out' : ''}"><td>${monthName(e.wageMonth)}</td><td>${day(e.date)}</td><td>${A.esc(e.note)}</td>
                <td class="num">${money(out * e.employee)}</td><td class="num">${money(out * e.employer)}</td><td class="num">${money(out * e.pension)}</td></tr>`;
            }).join('')}</tbody>
          </table></div></details>`).join('')}
      </section>
    </div></div>`;
  bindFiles();
}

// Each passbook becomes one year of its account. A year loaded again replaces the
// earlier copy, so a newer passbook for the year in progress brings it up to date.
async function savePassbook(p) {
  let account = A.S.retiralAccounts.find(a => a.memberTail === p.memberTail && a.employer === p.employer);
  if (!account) {
    const now = Date.now();
    account = { id: A.uid(), kind: 'epf', name: `EPF · ${p.employer.replace(/\b(LIMITED|LTD|PRIVATE|PVT)\b\.?/gi, '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}`, employer: p.employer, memberTail: p.memberTail, createdAt: now, updatedAt: now };
    A.S.retiralAccounts.push(account);
    await db.put('retiralAccounts', account);
  }
  const now = Date.now();
  const statement = { id: `${account.id}:${p.fy}`, accountId: account.id, fy: p.fy, opening: p.opening, interest: p.interest, closing: p.closing, interestUpto: p.interestUpto, closingDate: p.closingDate, matches: p.check.matches, updatedAt: now };
  const seen = new Map();
  const entries = p.entries.map(e => {
    const key = `${account.id}:${p.fy}:${e.date}:${e.wageMonth}:${e.kind}:${e.employee}:${e.employer}:${e.pension}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return { ...e, id: `${key}:${seen.get(key)}`, accountId: account.id, fy: p.fy, updatedAt: now };
  });
  for (const old of A.S.retiralEntries.filter(e => e.accountId === account.id && e.fy === p.fy)) await db.del('retiralEntries', old.id);
  A.S.retiralEntries = [...A.S.retiralEntries.filter(e => !(e.accountId === account.id && e.fy === p.fy)), ...entries];
  A.S.retiralStatements = [...A.S.retiralStatements.filter(s => s.id !== statement.id), statement];
  await db.putMany('retiralEntries', entries);
  await db.put('retiralStatements', statement);
  return statement;
}

// One button takes any mix of files and works out each one: an NPS statement CSV,
// an EPF passbook PDF or an LIC premium receipt PDF.
async function loadFiles(files) {
  const done = { passbook: 0, statement: 0, receipt: 0, ppf: 0 };
  let unchecked = 0, points = 0, dataTo = '';
  const problems = [];
  // Counts each file's rows and its latest date for the import timeline.
  const seen = list => { points += list.length; list.forEach(x => { if (x.date > dataTo) dataTo = x.date; }); };
  for (const file of files) {
    try {
      if (/\.csv$/i.test(file.name)) {
        const parsed = parseNpsStatement(await file.text());
        const statement = await saveNps(parsed);
        seen(parsed.transactions);
        done.statement++;
        if (!statement.matches) unchecked++;
        continue;
      }
      if (/.xlsx?$/i.test(file.name)) {
        const sheets = /.xlsx$/i.test(file.name) ? await readWorkbook(file) : readLegacyWorkbook(await file.arrayBuffer());
        const parsed = parsePpfStatement(sheets);
        const statement = await savePpf(parsed);
        seen(parsed.entries);
        done.ppf++;
        if (!statement.matches) unchecked++;
        continue;
      }
      const lines = await pdfLines(await file.arrayBuffer());
      if (lines.some(l => /Renewal Premium Receipt/.test(l))) {
        const receipts = parseReceipts(lines);
        const { saved, problems: more } = await saveReceipts(receipts);
        seen(receipts);
        done.receipt += saved;
        problems.push(...more);
        continue;
      }
      const passbook = parsePassbook(lines);
      const statement = await savePassbook(passbook);
      seen(passbook.entries);
      done.passbook++;
      if (!statement.matches) unchecked++;
    } catch (e) {
      problems.push(`${file.name}: ${e.message.replace("This isn't an EPF passbook", 'not an EPF passbook, LIC receipt, NPS or PPF statement')}`);
    }
  }
  A.markDirty();
  A.refresh();
  const loaded = [done.passbook && A.plural(done.passbook, 'EPF passbook'), done.statement && A.plural(done.statement, 'NPS statement'), done.ppf && A.plural(done.ppf, 'PPF statement'), done.receipt && A.plural(done.receipt, 'LIC receipt')].filter(Boolean).join(', ');
  const checked = loaded && (unchecked ? `${unchecked} not matching its own totals` : 'all matching their own totals');
  const issues = [...new Set(problems)].join('; ');
  if (loaded) logImport({ category: 'retirals', source: 'Retirals', what: loaded, points, detail: `${loaded}${done.passbook || done.statement || done.ppf ? `, ${checked}` : ''}`, dataTo: /^\d{4}-\d{2}-\d{2}$/.test(dataTo) ? dataTo : '' });
  A.toast([loaded && `Loaded ${loaded}${done.passbook || done.statement || done.ppf ? `, ${checked}` : ''}`, issues && `Couldn't use ${issues}`].filter(Boolean).join('. '));
}

function bindFiles() {
  A.view.querySelectorAll('#ret-files, #ret-receipts').forEach(input => input.addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) loadFiles(files);
  }));
}

export function retiralsView(r) {
  if (r.page === 'type') typeView(r.id);
  else if (r.page === 'account') accountView(r);
  else if (r.page === 'lic-new' || r.page === 'lic-edit') policyForm(r);
  else homeView();
}

export async function retiralsAction(b) {
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'ret-privacy':
      A.ls.set('pfPrivate', !isPrivate());
      return A.refresh();
    case 'ret-menu': {
      const a = accountById(id);
      const pick = await A.choose(a.name, [
        isPolicy(a) ? { icon: 'edit', label: 'Edit policy details' } : { icon: 'edit', label: 'Rename account' },
        { icon: 'trash', label: isPolicy(a) ? 'Remove policy' : 'Remove account', danger: true },
      ]);
      if (pick === 0 && isPolicy(a)) return A.go(`${accountPath(a.id)}/edit`);
      if (pick === 0) {
        const name = (await A.ask('Rename account', a.name))?.trim();
        if (!name) return undefined;
        Object.assign(a, { name, updatedAt: Date.now() });
        await db.put('retiralAccounts', a);
        A.markDirty();
        return A.refresh();
      }
      if (pick !== 1 || !(await A.confirmDlg(`Remove “${a.name}”?`, isPolicy(a) ? 'Its details and receipts are removed from this device.' : isPpf(a) ? 'Its statement entries are removed from this device. You can load the statement again later.' : isNps(a) ? 'Its statements are removed from this device. You can load the CSVs again later.' : 'Its passbook entries are removed from this device. You can load the PDFs again later.', 'Remove'))) return undefined;
      for (const e of A.S.retiralEntries.filter(x => x.accountId === id)) await db.del('retiralEntries', e.id);
      for (const s of A.S.retiralStatements.filter(x => x.accountId === id)) await db.del('retiralStatements', s.id);
      await db.del('retiralAccounts', id);
      A.S.retiralEntries = A.S.retiralEntries.filter(x => x.accountId !== id);
      A.S.retiralStatements = A.S.retiralStatements.filter(x => x.accountId !== id);
      A.S.retiralAccounts = A.S.retiralAccounts.filter(x => x.id !== id);
      A.markDirty();
      return A.go(HOME, true);
    }
    default:
      return undefined;
  }
}
