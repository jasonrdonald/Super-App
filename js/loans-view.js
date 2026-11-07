// The Loans section: loans built from the amortization schedule PDFs you load.
// Every EMI due on or before today counts as paid. Amounts follow Portfolio's
// privacy switch and the app's Short amounts setting.

import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import { shortAmounts, shortMoney } from './format.js';
import { pdfLines } from './pdf-text.js';
import { parseSchedule, loanSummary } from './loan.js';

const HOME = '#/s/loans';
const MASK = '••••••';
let A;

export function initLoans(helpers) { A = helpers; }

const isPrivate = () => A.ls.get('pfPrivate', false);
const full = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 });
const money = v => (v == null ? '–' : isPrivate() ? MASK : shortAmounts() ? shortMoney(v) : full.format(v));
const day = s => A.fmt(new Date(`${s}T00:00:00`), { dateStyle: 'medium' });
const monthName = s => A.fmt(new Date(`${s}T00:00:00`), { month: 'short', year: 'numeric' });
const fyName = y => `${y}-${String(y + 1).slice(2)}`;
const pct = v => `${v.toFixed(1)}%`;
const loanPath = id => `${HOME}/l/${id}`;
const span = months => [Math.floor(months / 12) && A.plural(Math.floor(months / 12), 'year'), months % 12 && A.plural(months % 12, 'month')].filter(Boolean).join(' ') || 'under a month';

const loans = () => [...A.S.loans].sort((a, b) => a.createdAt - b.createdAt);
const loanById = id => A.S.loans.find(l => l.id === id);

export const loansNav = () => [
  { id: 'home', name: 'Overview', icon: 'pie', href: HOME },
  ...loans().map(l => ({ id: l.id, name: l.name, icon: 'home', href: loanPath(l.id) })),
];

export const loansRouteValid = r => r.page !== 'loan' || !!loanById(r.id);

// What's still owed on every loan, for the home screen's tile.
export function loansTileText() {
  const owed = loans().reduce((n, l) => n + loanSummary(l).outstanding, 0);
  return owed ? `${money(owed)} owed` : 'All repaid';
}

// Each loan for Net worth: what's owed today, and month by month from now along its
// schedule until it's repaid, when its EMI is free.
export function loanParts(today = new Date()) {
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return loans().map(l => {
    const s = loanSummary(l, iso(today));
    const owed = [];
    for (let m = 0; m <= 600; m++) {
      const at = new Date(today.getFullYear(), today.getMonth() + m, today.getDate());
      const paid = l.schedule.filter(x => x.date <= iso(at)).at(-1);
      owed.push(paid ? paid.balance : l.amount);
      if (owed[m] <= 0) break;
    }
    return { id: l.id, name: l.name, owed: s.outstanding, href: loanPath(l.id), emi: s.next?.total ?? l.emi, byMonth: owed, endsIn: owed.length - 1, last: s.last?.date };
  });
}

function hero(title, sub, up, extra = '') {
  const eye = isPrivate();
  return `<header class="topbar hero">
    ${A.upButton(up)}
    <span class="hero-icon">${icon('home')}</span>
    <div class="titles"><h1>${A.esc(title)}</h1><p>${A.esc(sub)}</p></div>
    <button class="icon-btn" data-act="loan-privacy" aria-pressed="${eye}" aria-label="${eye ? 'Show amounts' : 'Hide amounts'}" title="${eye ? 'Show amounts' : 'Hide amounts'}">${icon(eye ? 'eyeOff' : 'eye')}</button>
    ${extra}${A.menuButton}
  </header>`;
}

const stat = (label, value, note = '') => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-note">${note}</span></div>`;
const loadButton = (label = 'Load schedule PDF') => `<label class="btn sm primary">${icon('upload')}<span>${label}</span><input id="loan-files" type="file" multiple accept=".pdf,application/pdf" hidden></label>`;

// How much of the loan is repaid, as one bar: principal repaid, and what's still owed.
function progress(loan, s) {
  return `<div class="loan-progress" role="img" aria-label="${pct(s.principalShare)} of the amount borrowed repaid">
    <span class="loan-repaid" style="width:${Math.min(100, s.principalShare)}%"></span>
  </div>
  <div class="loan-progress-key"><span>${pct(s.principalShare)} repaid · ${money(s.principalPaid)}</span><span>${money(s.outstanding)} to go</span></div>`;
}

function homeView() {
  const list = loans();
  if (!list.length) {
    A.view.innerHTML = `${hero('Loans', 'Housing and other loans', '#/')}
      <div class="scroll"><div class="empty">${icon('home')}<p>Load your loan's amortization schedule PDF from your lender. Every EMI due up to today is taken as paid, so you see how much principal and interest has gone, and what's left.</p>
      <div class="pf-start"><div class="btn-row">${loadButton()}</div></div>
      <p class="muted small">Only the loan number's last four digits, the rate and the schedule are kept, never your name, customer ID or branch.</p></div></div>`;
    return bindFiles();
  }
  const sums = list.map(l => ({ l, s: loanSummary(l) }));
  const add = key => sums.reduce((n, x) => n + x.s[key], 0);
  const monthly = sums.filter(x => x.s.next).reduce((n, x) => n + x.s.next.total, 0);
  const next = sums.filter(x => x.s.next).sort((p, q) => p.s.next.date.localeCompare(q.s.next.date))[0];
  A.view.innerHTML = `${hero('Loans', A.plural(list.length, 'loan'), '#/')}
    <div class="scroll"><div class="pay-page pf-page">
      <div class="btn-row">${loadButton()}</div>
      <div class="stats five">
        ${stat('Still owed', money(add('outstanding')), 'Principal left after the EMIs paid so far')}
        ${stat('Repaid so far', money(add('principalPaid')), `Plus ${money(add('interestPaid'))} interest`)}
        ${stat('EMIs each month', money(monthly), next ? `Next on ${day(next.s.next.date)}` : 'None left')}
        ${stat('Interest still to come', money(add('interestLeft')), 'If the rate stays as scheduled')}
      </div>
      <div class="rows pf-accounts">${sums.map(({ l, s }) => `<a class="sub pf-account" href="${loanPath(l.id)}">
        <span class="sub-main"><span class="sub-text"><span class="card-title">${A.esc(l.name)}</span>
        <span class="card-meta">${[l.loanTail && `Loan ending ${l.loanTail}`, `${s.emisPaid} of ${s.emisTotal} EMIs paid`, s.closed ? 'repaid' : `ends ${monthName(s.last.date)}`].filter(Boolean).join(' · ')}</span></span></span>
        <span class="pay-side"><span class="pay-amount">${money(s.outstanding)}</span><span class="pf-delta">${pct(s.principalShare)} repaid</span></span>
      </a>`).join('')}</div>
    </div></div>`;
  bindFiles();
}

// One bar per EMI, principal below and interest above. EMIs still to come are faded,
// and a line marks today.
function emiChart(loan, s) {
  const rows = loan.schedule;
  const W = 640, H = 190, top = 10, bottom = 22, left = 4;
  const max = Math.max(...rows.map(x => x.total)) || 1;
  const step = (W - left) / rows.length;
  const bw = Math.max(2, step - 2);
  const y = v => (H - bottom) - v / max * (H - bottom - top);
  const bars = rows.map((x, i) => {
    const bx = left + i * step;
    const yp = y(x.principal), yi = y(x.total);
    const upcoming = !s.paid.includes(x);
    const tip = `EMI ${x.no} · ${day(x.date)}${upcoming ? ' · to come' : ' · paid'}\nPrincipal ${money(x.principal)} · interest ${money(x.interest)}\nOwed after it ${money(x.balance)}`;
    return `<g class="loan-bar${upcoming ? ' upcoming' : ''}"><title>${A.esc(tip)}</title>
      <rect class="hit" x="${bx}" y="${top}" width="${step}" height="${H - bottom - top}"></rect>
      <rect class="s-principal" x="${bx}" y="${yp}" width="${bw}" height="${Math.max(0, H - bottom - yp)}" rx="1.5"></rect>
      <rect class="s-interest" x="${bx}" y="${yi}" width="${bw}" height="${Math.max(0, yp - yi - 2)}" rx="1.5"></rect></g>`;
  }).join('');
  // The plot stretches to the width at a fixed height, so labels sit in HTML to keep their size.
  const at = x => `${(x / W * 100).toFixed(2)}%`;
  const split = s.emisPaid && s.emisLeft ? left + s.emisPaid * step - 1 : null;
  const years = rows.filter((x, i) => i && x.date.slice(0, 4) !== rows[i - 1].date.slice(0, 4))
    .map(x => `<span style="left:${at(left + rows.indexOf(x) * step)}">${x.date.slice(0, 4)}</span>`).join('');
  return `<div class="loan-legend"><span><i class="sw s-principal"></i>Principal</span><span><i class="sw s-interest"></i>Interest</span><span class="muted"><i class="sw faded"></i>Faded: still to pay</span></div>
    <div class="loan-plot">
      <svg class="loan-chart" viewBox="0 0 ${W} ${H - bottom}" preserveAspectRatio="none" role="img" aria-label="Each EMI split into principal and interest. The full schedule table below has every figure.">
        <line class="loan-base" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" vector-effect="non-scaling-stroke"></line>
        ${bars}
        ${split != null ? `<line class="loan-today" x1="${split}" x2="${split}" y1="0" y2="${H - bottom}" vector-effect="non-scaling-stroke"></line>` : ''}
      </svg>
      ${split != null ? `<span class="loan-today-label" style="left:${at(split)}">Today</span>` : ''}
      <div class="loan-years">${years}</div>
    </div>`;
}

function loanView(r) {
  const l = loanById(r.id);
  const s = loanSummary(l);
  const first = l.schedule[0];
  const crossover = l.schedule.find(x => x.principal > x.interest);
  const tick = ok => (ok ? `<span class="up">${icon('check')} Matches</span>` : '<span class="down">Differs</span>');
  A.view.innerHTML = `${hero(l.name, [l.loanTail && `Loan ending ${l.loanTail}`, l.lender, l.rate != null && `${l.rate}%`].filter(Boolean).join(' · '), HOME, `<button class="icon-btn" data-act="loan-menu" data-id="${l.id}" aria-label="Loan options">${icon('more')}</button>`)}
    <div class="scroll"><div class="pay-page pf-page">
      <div class="stats five">
        ${stat('Still owed', money(s.outstanding), `Of ${money(l.amount)} borrowed${l.disbursed ? ` on ${day(l.disbursed)}` : ''}`)}
        ${stat('EMIs paid', `${s.emisPaid} <small class="muted">of ${s.emisTotal}</small>`, s.closed ? 'All paid' : `${A.plural(s.emisLeft, 'EMI')} left, ending ${monthName(s.last.date)}`)}
        ${stat('Principal paid', money(s.principalPaid), `${pct(s.principalShare)} of the loan`)}
        ${stat('Interest paid', money(s.interestPaid), s.preEmiPaid ? `Includes ${money(s.preEmiPaid)} pre-EMI interest` : `${pct(s.interestShareSoFar)} of what you've paid`)}
        ${stat('Next EMI', s.next ? money(s.next.total) : '–', s.next ? `${day(s.next.date)} · ${money(s.next.principal)} principal, ${money(s.next.interest)} interest` : 'Loan repaid')}
        ${stat('Rate', l.rate != null ? `${l.rate}%` : '–', l.benchmark ? `Floating, ${A.esc(l.benchmark)}` : 'As scheduled')}
      </div>
      ${progress(l, s)}
      <section class="panel"><h2>What it all costs</h2>
        <div class="stats five">
          ${stat('Paid so far', money(s.paidSoFar), `${money(s.principalPaid)} principal + ${money(s.interestPaid)} interest`)}
          ${stat('Still to pay', money(s.leftToPay), `${money(s.outstanding)} principal + ${money(s.interestLeft)} interest`)}
          ${stat('Interest over the loan', money(l.totalInterest), `${(s.interestPerRupee * 100).toFixed(1)} paise for every rupee borrowed`)}
          ${stat('Time left', s.closed ? 'Done' : span(s.monthsLeft), s.closed ? '' : `Last EMI ${day(s.last.date)}`)}
        </div>
        <ul class="loan-insights">
          <li>${icon('info')}<span>Of the ${money(s.paidSoFar)} you've paid, ${pct(s.interestShareSoFar)} went to interest and ${pct(100 - s.interestShareSoFar)} to the loan itself.</span></li>
          ${s.next ? `<li>${icon('info')}<span>The next EMI is ${pct(s.next.principal / s.next.total * 100)} principal. Interest's share shrinks every month as the balance falls${crossover === first ? ', and principal has been the bigger part from the first EMI' : crossover ? `; principal becomes the bigger part from ${monthName(crossover.date)}` : ''}.</span></li>` : ''}
          ${s.emisLeft ? `<li>${icon('info')}<span>${pct(s.interestLeft / l.totalInterest * 100)} of the loan's interest, ${money(s.interestLeft)}, is still ahead. Paying some principal early cuts it, as interest runs on what's owed.</span></li>` : ''}
        </ul>
      </section>
      <section class="panel"><h2>Every EMI, principal and interest</h2>
        ${emiChart(l, s)}
      </section>
      <section class="panel"><h2>Year by year</h2>
        <p class="muted small chart-note">Financial years, April to March.${l.preEmi ? ` The first year includes ${money(l.preEmi.amount)} of pre-EMI interest, charged ${l.preEmi.date ? `on ${day(l.preEmi.date)}` : 'before the first EMI'} for the days between the loan and the EMI cycle.` : ''}</p>
        <div class="holdings-wrap"><table class="holdings pf-summary">
          <thead><tr><th>Year</th>${['EMIs', 'Principal', 'Interest', 'Owed at the end', 'Status'].map(h => `<th class="num">${h}</th>`).join('')}</tr></thead>
          <tbody>${s.years.map(y => `<tr><th scope="row">${fyName(y.fy)}</th><td class="num">${y.emis}</td><td class="num">${money(y.principal)}</td><td class="num">${money(y.interest)}</td><td class="num">${money(y.closing)}</td>
            <td class="num">${y.paid === y.emis ? '<span class="up">Paid</span>' : y.paid ? `${y.paid} of ${y.emis} paid` : '<span class="muted">To come</span>'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td class="num">${s.emisTotal}</td><td class="num">${money(l.amount)}</td><td class="num">${money(l.totalInterest)}</td><td></td><td></td></tr></tfoot>
        </table></div>
      </section>
      <section class="panel"><details class="pf-details"><summary>Full schedule · ${A.plural(s.emisTotal, 'EMI')}</summary>
        <div class="holdings-wrap"><table class="holdings lots">
          <thead><tr><th>No.</th><th>Date</th>${['EMI', 'Principal', 'Interest', 'Owed after'].map(h => `<th class="num">${h}</th>`).join('')}<th>Status</th></tr></thead>
          <tbody>${l.preEmi ? `<tr class="${l.preEmi.date && l.preEmi.date > s.next?.date ? 'ret-due' : ''}"><td>–</td><td>${l.preEmi.date ? day(l.preEmi.date) : '–'}</td><td class="num">${money(l.preEmi.amount)}</td><td class="num">${money(0)}</td><td class="num">${money(l.preEmi.amount)}</td><td class="num">${money(l.amount)}</td><td>Pre-EMI interest</td></tr>` : ''}
          ${l.schedule.map(x => {
            const paid = s.paid.includes(x);
            return `<tr class="${paid ? '' : 'ret-due'}${x === s.next ? ' loan-next' : ''}"><td>${x.no}</td><td>${day(x.date)}</td><td class="num">${money(x.total)}</td><td class="num">${money(x.principal)}</td><td class="num">${money(x.interest)}</td><td class="num">${money(x.balance)}</td>
              <td>${paid ? `${icon('check')} Paid` : x === s.next ? 'Next' : 'To come'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </details></section>
      <div class="status">${icon('clock')}<span>From the schedule printed ${l.generated ? `on ${day(l.generated)}` : 'by your lender'}. Every EMI due up to today is taken as paid. ${l.benchmark ? 'The rate floats with the lender\'s benchmark, so a change in it changes the EMIs or the term: load a fresh schedule when that happens.' : 'Load a fresh schedule if the rate or EMI changes.'} Schedule checks against its own figures: ${tick(l.matches)}</span></div>
    </div></div>`;
  bindFiles();
}

// A schedule loaded again replaces the loan with the same last four digits, keeping its name.
async function saveSchedule(p) {
  const now = Date.now();
  const old = p.loanTail ? A.S.loans.find(l => l.loanTail === p.loanTail) : null;
  const loan = {
    ...p, id: old?.id ?? A.uid(), name: old?.name ?? p.type.replace(/^(\w)/, c => c.toUpperCase()).replace(/ Loan$/, ' loan'), lender: old?.lender ?? '',
    createdAt: old?.createdAt ?? now, updatedAt: now,
  };
  delete loan.checks;
  A.S.loans = [...A.S.loans.filter(l => l.id !== loan.id), loan];
  await db.put('loans', loan);
  return loan;
}

async function loadFiles(files) {
  const saved = [];
  const problems = [];
  for (const file of files) {
    try {
      saved.push(await saveSchedule(parseSchedule(await pdfLines(await file.arrayBuffer()))));
    } catch (e) {
      problems.push(`${file.name}: ${e.message}`);
    }
  }
  A.markDirty();
  if (saved.length === 1 && A.S.route?.page !== 'loan') A.go(loanPath(saved[0].id));
  else A.refresh();
  const unchecked = saved.filter(l => !l.matches).length;
  A.toast([saved.length && `Loaded ${A.plural(saved.length, 'loan schedule')}, ${unchecked ? `${unchecked} not matching its own figures` : 'matching its own figures'}`, problems.length && `Couldn't use ${problems.join('; ')}`].filter(Boolean).join('. '));
}

function bindFiles() {
  A.view.querySelector('#loan-files')?.addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) loadFiles(files);
  });
}

export function loansView(r) {
  if (r.page === 'loan') loanView(r);
  else homeView();
}

export async function loansAction(b) {
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'loan-privacy':
      A.ls.set('pfPrivate', !isPrivate());
      return A.refresh();
    case 'loan-menu': {
      const l = loanById(id);
      const pick = await A.choose(l.name, [
        { icon: 'edit', label: 'Rename loan' },
        { icon: 'edit', label: l.lender ? 'Change lender' : 'Add lender' },
        { icon: 'trash', label: 'Remove loan', danger: true },
      ]);
      if (pick === 0 || pick === 1) {
        const key = pick === 0 ? 'name' : 'lender';
        const value = (await A.ask(pick === 0 ? 'Rename loan' : 'Lender', l[key] ?? ''))?.trim();
        if (value == null || (key === 'name' && !value)) return undefined;
        Object.assign(l, { [key]: value.slice(0, 80), updatedAt: Date.now() });
        await db.put('loans', l);
        A.markDirty();
        return A.refresh();
      }
      if (pick !== 2 || !(await A.confirmDlg(`Remove “${l.name}”?`, 'Its schedule is removed from this device. You can load the PDF again later.', 'Remove'))) return undefined;
      await db.del('loans', id);
      A.S.loans = A.S.loans.filter(x => x.id !== id);
      A.markDirty();
      return A.go(HOME, true);
    }
    default:
      return undefined;
  }
}
