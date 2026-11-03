// The Retirals section: EPF accounts built from the passbook PDFs you load.
// Amounts follow Portfolio's privacy switch and the app's Short amounts setting.

import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import { shortAmounts, shortMoney } from './format.js';
import { pdfLines } from './pdf-text.js';
import { parsePassbook, accountSummary } from './epf.js';

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
const accountById = id => A.S.retiralAccounts.find(a => a.id === id);
const summaryOf = id => accountSummary(A.S.retiralStatements.filter(s => s.accountId === id), A.S.retiralEntries.filter(e => e.accountId === id));

export const retiralsNav = () => [
  { id: 'home', name: 'Overview', icon: 'shield', href: HOME },
  ...accounts().map(a => ({ id: a.id, name: a.name, icon: 'briefcase', href: accountPath(a.id) })),
];

export const retiralsRouteValid = r => r.page !== 'account' || !!accountById(r.id);

// Every account's balance, for the home screen's tile.
export function retiralsTileText() {
  const total = accounts().reduce((n, a) => n + (summaryOf(a.id)?.balance ?? 0), 0);
  return total ? money(total) : '';
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

const loadButton = (label = 'Load passbook PDFs') => `<label class="btn sm primary">${icon('upload')}<span>${label}</span><input id="ret-files" type="file" multiple accept=".pdf,application/pdf" hidden></label>`;

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

function homeView() {
  const list = accounts();
  if (!list.length) {
    A.view.innerHTML = `${hero('Retirals', 'EPF and other retirement savings', '#/')}
      <div class="scroll"><div class="empty">${icon('shield')}<p>Load your EPF passbook PDFs from the EPFO member portal, one for each financial year. Each becomes part of your EPF account here.</p>
      <div class="pf-start">${loadButton()}</div>
      <p class="muted small">Only the employer's name, the last four digits of the member ID and the amounts are kept, never your name, date of birth or UAN.</p></div></div>`;
    return bindFiles();
  }
  const sums = list.map(a => ({ a, s: summaryOf(a.id), last: lastContribution(a.id) })).filter(x => x.s);
  const add = (key, pick = s => s[key]) => sums.reduce((n, x) => n + (pick(x.s) ?? 0), 0);
  const total = {
    balance: add('balance'), employee: add('employee'), employer: add('employer'), pension: add('pension'), interest: add('interest'), withdrawn: add('withdrawn'),
    accrued: add('accrued'), pendingInterest: sums.some(x => x.s.pendingInterest), lastRate: sums.find(x => x.s.lastRate)?.s.lastRate,
  };
  const last = sums.length === 1 ? sums[0].last : null;
  A.view.innerHTML = `${hero('Retirals', A.plural(list.length, 'account'), '#/')}
    <div class="scroll"><div class="pay-page pf-page">
      ${summaryStats(total, last)}
      <div class="btn-row">${loadButton()}</div>
      <div class="rows pf-accounts">${sums.map(({ a, s }) => `<a class="sub pf-account" href="${accountPath(a.id)}">
        <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(a.name)}</span>
        <span class="card-meta">${a.memberTail ? `Member ID ending ${A.esc(a.memberTail)} · ` : ''}as of ${day(s.asOf)}</span></span></span>
        <span class="pay-side"><span class="pay-amount">${money(s.balance)}</span><span class="pf-delta">+ ${money(s.pension)} pension</span></span>
      </a>`).join('')}</div>
      <p class="muted small chart-note">Balances are as your latest passbook shows them. Interest for the current year is credited after March, so it's shown as an estimate until then.</p>
    </div></div>`;
  bindFiles();
}

function accountView(r) {
  const a = accountById(r.id);
  const s = summaryOf(a.id);
  const statements = s?.years ?? [];
  const tick = ok => (ok ? `<span class="up">${icon('check')} Matches</span>` : '<span class="down">Differs</span>');
  A.view.innerHTML = `${hero(a.name, `Employees' Provident Fund${a.memberTail ? ` · member ID ending ${a.memberTail}` : ''}`, HOME, `<button class="icon-btn" data-act="ret-menu" data-id="${a.id}" aria-label="Account options">${icon('more')}</button>`)}
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

// Each PDF becomes one year of its account. A year loaded again replaces the
// earlier copy, so a newer passbook for the year in progress brings it up to date.
async function loadPassbooks(files) {
  let loaded = 0, mismatched = 0;
  const failed = [];
  for (const file of files) {
    let p;
    try {
      p = parsePassbook(await pdfLines(await file.arrayBuffer()));
    } catch (e) {
      failed.push(`${file.name}: ${e.message}`);
      continue;
    }
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
    loaded++;
    if (!p.check.matches) mismatched++;
  }
  A.markDirty();
  A.refresh();
  if (failed.length) A.toast(`Couldn't read ${failed.join('; ')}`);
  else A.toast(`Loaded ${A.plural(loaded, 'passbook')}${loaded ? (mismatched ? `, ${mismatched} not matching its printed totals` : loaded === 1 ? ', matching its printed totals' : ', all matching their printed totals') : ''}`);
}

function bindFiles() {
  A.$('#ret-files')?.addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) loadPassbooks(files);
  });
}

export function retiralsView(r) {
  if (r.page === 'account') accountView(r);
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
        { icon: 'edit', label: 'Rename account' },
        { icon: 'trash', label: 'Remove account', danger: true },
      ]);
      if (pick === 0) {
        const name = (await A.ask('Rename account', a.name))?.trim();
        if (!name) return undefined;
        Object.assign(a, { name, updatedAt: Date.now() });
        await db.put('retiralAccounts', a);
        A.markDirty();
        return A.refresh();
      }
      if (pick !== 1 || !(await A.confirmDlg(`Remove “${a.name}”?`, 'Its passbook entries are removed from this device. You can load the PDFs again later.', 'Remove'))) return undefined;
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
