import { icon } from './icons.js';
import * as db from './db.js';
import { CONFIG } from './config.js';
import {
  CATEGORIES, FREQUENCIES, WHEN, CHANNELS, MODES,
  today, addDays, daysBetween, parseDate, monthRange, yearRange,
  freqLabel, occurrencesIn, openDues, statusOf, attention, summarize, byDue,
} from './payments.js';

export const PAY_PAGES = [
  { id: 'dashboard', name: 'Dashboard', icon: 'chart', href: '#/s/payments' },
  { id: 'manage', name: 'Manage payments', icon: 'card', href: '#/s/payments/manage' },
  { id: 'report', name: 'Report', icon: 'file', href: '#/s/payments/report' },
];

const STATUS = {
  paid: ['Paid', 'check'],
  overdue: ['Overdue', 'alert'],
  soon: ['Due soon', 'clock'],
  upcoming: ['Upcoming', 'calendar'],
};

const MANAGE = '#/s/payments/manage';
const now = new Date();
// The period is shared, so Report opens on whatever the Dashboard was showing.
const P = { mode: 'month', year: now.getFullYear(), month: now.getMonth() + 1, list: 'active', q: '' };

// Helpers that live in app.js.
let A;
export function initPayments(helpers) {
  A = helpers;
  installTooltip();
}

const paymentById = id => A.S.payments.find(p => p.id === id);
const records = () => A.S.paymentRecords;
const money = v => new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
const fullDate = s => A.fmt(parseDate(s), { dateStyle: 'medium' });
const shortDate = s => A.fmt(parseDate(s), { month: 'short', day: 'numeric' });
const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const cycleLabel = p => `${ordinal(p.cycleFrom)} to ${ordinal(p.cycleTo)}`;

const categoryList = () => [...CATEGORIES, ...[...A.S.paymentCategories].sort((a, b) => a.createdAt - b.createdAt)];
const categoryName = id => categoryList().find(c => c.id === id)?.name ?? 'Custom';
const typeLine = p => [categoryName(p.categoryId), p.type].filter(Boolean).join(' / ');

export const payRouteValid = r => (r.page === 'dashboard' || r.page === 'manage' || r.page === 'report' || r.page === 'add')
  ? !r.id
  : (r.page === 'p' || r.page === 'edit') && !!paymentById(r.id);

export const attentionNow = () => attention(A.S.payments, records());

/* ---------- shell ---------- */

function periodRange() {
  return P.mode === 'month' ? monthRange(P.year, P.month) : yearRange(P.year);
}
function periodLabel() {
  if (P.mode === 'year') return String(P.year);
  return A.fmt(new Date(P.year, P.month - 1, 1), { month: 'long', year: 'numeric' });
}

function shell(r, sub, body, extra = '') {
  const page = PAY_PAGES.find(x => x.id === r.page)?.id ?? 'manage';
  A.view.innerHTML = `
    <header class="topbar hero">
      ${A.upButton('#/')}
      <span class="hero-icon">${icon('card')}</span>
      <div class="titles"><h1>Payments</h1><p>${A.esc(sub)}</p></div>
      ${A.menuButton}
    </header>
    <div class="seg tabs" role="group" aria-label="Payments pages">
      ${PAY_PAGES.map(x => `<a href="${x.href}"${x.id === page ? ' aria-current="page"' : ''}>${icon(x.icon)}<span>${x.id === 'manage' ? 'Manage' : x.name}</span></a>`).join('')}
    </div>
    <div class="scroll">${body}</div>
    ${extra}`;
}

function periodBar() {
  const years = [...A.S.payments.map(p => Number(p.dueDate.slice(0, 4))), ...records().map(x => Number(x.due.slice(0, 4))), now.getFullYear(), P.year];
  const lo = Math.min(...years), hi = Math.max(...years) + 1;
  const months = Array.from({ length: 12 }, (_, i) => A.fmt(new Date(2000, i, 1), { month: 'long' }));
  return `<div class="period">
    <div class="seg" role="group" aria-label="Period type">
      <button data-period="month" aria-pressed="${P.mode === 'month'}">Month-wise</button>
      <button data-period="year" aria-pressed="${P.mode === 'year'}">Year-wise</button>
    </div>
    ${P.mode === 'month' ? `<select class="select" id="p-month" aria-label="Month">${months.map((m, i) => `<option value="${i + 1}"${i + 1 === P.month ? ' selected' : ''}>${m}</option>`).join('')}</select>` : ''}
    <select class="select" id="p-year" aria-label="Year">${Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map(y => `<option${y === P.year ? ' selected' : ''}>${y}</option>`).join('')}</select>
  </div>`;
}

function bindPeriod(rerender) {
  A.view.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => { P.mode = b.dataset.period; rerender(); }));
  A.$('#p-month')?.addEventListener('change', e => { P.month = Number(e.target.value); rerender(); });
  A.$('#p-year').addEventListener('change', e => { P.year = Number(e.target.value); rerender(); });
}

const chip = o => { const [label, ic] = STATUS[statusOf(o)]; return `<span class="chip ${statusOf(o)}">${icon(ic)}${label}</span>`; };

function dueRow(o) {
  const p = o.payment;
  const paid = !!o.record;
  return `<div class="sub pay-row">
    <a class="sub-main" href="#/s/payments/p/${p.id}">
      <span class="sub-text"><span class="card-title">${A.esc(p.name)}</span>
      <span class="card-meta">${paid ? `Paid ${shortDate(o.record.paidOn)}` : `Due ${fullDate(o.due)}`} · ${A.esc(categoryName(p.categoryId))}</span></span>
    </a>
    <div class="pay-side"><span class="pay-amount">${money(o.amount)}</span>${chip(o)}</div>
    ${paid ? '' : `<button class="btn sm primary" data-act="pay-mark" data-id="${p.id}" data-due="${o.due}" aria-label="Mark ${A.esc(p.name)} as paid">${icon('check')}<span>Paid</span></button>`}
  </div>`;
}

const noPayments = `<div class="empty">${icon('card')}<p>No payments yet. Add your rent, bills and subscriptions to track what is due.</p><a class="btn primary" href="#/s/payments/add">${icon('plus')}<span>Add payment</span></a></div>`;

/* ---------- dashboard ---------- */

function stat(label, value, note = '') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-note">${note}</span></div>`;
}

function categoryChart(list) {
  const rows = categoryList().map(c => {
    const s = summarize(list.filter(o => o.payment.categoryId === c.id));
    return { name: c.name, ...s };
  }).filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  if (!rows.length) return '';
  const max = rows[0].total;
  return `<section class="panel">
    <div class="panel-head"><h2>Amount by category</h2>${legend}</div>
    ${rows.map(c => `<div class="bar-row" tabindex="0" data-tip="${A.esc(c.name)}: ${money(c.paid)} paid, ${money(c.pending)} pending">
      <div class="bar-head"><span>${A.esc(c.name)}</span><span class="num">${money(c.total)}</span></div>
      <div class="bar-track">
        ${c.paid ? `<span class="bar paid" style="width:${c.paid / max * 100}%"></span>` : ''}
        ${c.pending ? `<span class="bar pending" style="width:${c.pending / max * 100}%"></span>` : ''}
      </div>
    </div>`).join('')}
  </section>`;
}

const legend = `<div class="legend"><span><i class="bar paid"></i>Paid</span><span><i class="bar pending"></i>Pending</span></div>`;

function monthChart(list) {
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${P.year}-${String(i + 1).padStart(2, '0')}`;
    return { i, ...summarize(list.filter(o => o.due.startsWith(key))) };
  });
  const max = Math.max(...months.map(m => m.total));
  if (!max) return '';
  const peak = months.find(m => m.total === max);
  return `<section class="panel">
    <div class="panel-head"><h2>Month by month</h2>${legend}</div>
    <p class="muted small chart-note">Highest: ${A.fmt(new Date(P.year, peak.i, 1), { month: 'long' })}, ${money(peak.total)}</p>
    <div class="months">${months.map(m => {
      const name = A.fmt(new Date(P.year, m.i, 1), { month: 'short' });
      const text = `${name}: ${money(m.paid)} paid, ${money(m.pending)} pending`;
      return `<button class="month" data-month="${m.i + 1}" data-tip="${text}" aria-label="${text}. Open this month.">
        <span class="month-plot">
          ${m.pending ? `<span class="bar pending" style="height:${m.pending / max * 100}%"></span>` : ''}
          ${m.paid ? `<span class="bar paid" style="height:${m.paid / max * 100}%"></span>` : ''}
        </span>
        <span class="month-name">${name}</span>
      </button>`;
    }).join('')}</div>
  </section>`;
}

function dashboardView(r) {
  if (!A.S.payments.length) return shell(r, 'Dashboard', noPayments);
  const [from, to] = periodRange();
  const list = occurrencesIn(A.S.payments, records(), from, to);
  const s = summarize(list);
  const pending = list.filter(o => !o.record);
  const earlier = from <= today() && today() <= to
    ? occurrencesIn(A.S.payments, records(), '0000-01-01', addDays(from, -1)).filter(o => !o.record)
    : [];
  const LIMIT = 8;

  shell(r, `Dashboard · ${periodLabel()}`, `<div class="pay-page">
    ${periodBar()}
    <div class="stats">
      ${stat('Total', money(s.total), A.plural(list.length, 'payment'))}
      ${stat('Paid', money(s.paid), `${list.length - pending.length} done`)}
      ${stat('Pending', money(s.pending), `${pending.length} left`)}
      ${stat('Overdue', money(s.overdue), `${s.overdueCount} late`)}
    </div>
    ${earlier.length ? `<section class="panel"><h2>Overdue from earlier</h2><div class="rows">${earlier.map(dueRow).join('')}</div></section>` : ''}
    <section class="panel">
      <h2>Pending payments</h2>
      ${pending.length
        ? `<div class="rows">${pending.slice(0, LIMIT).map(dueRow).join('')}</div>
           ${pending.length > LIMIT ? `<a class="btn sm" href="#/s/payments/report">View all ${pending.length} in Report</a>` : ''}`
        : `<p class="muted">Nothing pending for ${periodLabel()}.</p>`}
    </section>
    ${categoryChart(list)}
    ${P.mode === 'year' ? monthChart(list) : ''}
  </div>`);

  bindPeriod(() => dashboardView(r));
  A.view.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => {
    P.mode = 'month';
    P.month = Number(b.dataset.month);
    dashboardView(r);
  }));
}

/* ---------- manage ---------- */

function paymentRow(p) {
  const open = openDues(p, records());
  const next = open.at(-1);
  const first = open[0];
  const meta = p.endedAt ? `Ended ${fullDate(p.endedAt)}` : next ? `${open.length > 1 ? `${open.length - 1} overdue, next` : 'Next'} ${fullDate(next.due)}` : 'Nothing due';
  return `<div class="sub pay-row">
    <a class="sub-main" href="#/s/payments/p/${p.id}">
      <span class="sub-text"><span class="card-title">${A.esc(p.name)}</span>
      <span class="card-meta">${A.esc(p.type || categoryName(p.categoryId))} · ${A.esc(freqLabel(p))} · ${meta}</span></span>
    </a>
    <div class="pay-side"><span class="pay-amount">${money(p.tentative)}</span>${first ? chip(first) : ''}</div>
    <button class="icon-btn" data-act="pay-menu" data-id="${p.id}" aria-label="${A.esc(p.name)} options">${icon('dots')}</button>
  </div>`;
}

function renderManageList() {
  const q = P.q.trim().toLowerCase();
  const ended = P.list === 'ended';
  const list = A.S.payments
    .filter(p => !!p.endedAt === ended)
    .filter(p => !q || `${p.name} ${p.type} ${categoryName(p.categoryId)} ${p.comments}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = categoryList()
    .map(c => ({ c, items: list.filter(p => p.categoryId === c.id) }));
  const known = new Set(categoryList().map(c => c.id));
  const stray = list.filter(p => !known.has(p.categoryId));
  if (stray.length) groups.push({ c: { name: 'Custom' }, items: stray });
  const html = groups.filter(g => g.items.length).map(g => `
    <div class="section-label"><span>${A.esc(g.c.name)}</span></div>
    ${g.items.map(paymentRow).join('')}`).join('');
  const none = q ? `No payments match “${A.esc(q)}”.` : ended ? 'Ended payments will appear here, with their paid history.' : 'No active payments.';
  A.$('#pay-list').innerHTML = html || (q || ended || A.S.payments.length ? `<div class="empty">${icon('card')}<p>${none}</p></div>` : noPayments);
}

function manageView(r) {
  const endedCount = A.S.payments.filter(p => p.endedAt).length;
  const customs = A.S.paymentCategories.length;
  shell(r, `${A.plural(A.S.payments.length - endedCount, 'active payment')}`, `<div class="pay-page">
    <div class="period">
      <div class="seg" role="group" aria-label="Active or ended">
        <button data-list="active" aria-pressed="${P.list === 'active'}">Active</button>
        <button data-list="ended" aria-pressed="${P.list === 'ended'}">Ended${endedCount ? ` (${endedCount})` : ''}</button>
      </div>
      <button class="btn sm" data-act="pay-cats">${icon('folder')}<span>Categories${customs ? ` (${customs})` : ''}</span></button>
    </div>
    <label class="search flush">${icon('search')}<input type="search" id="pay-q" placeholder="Search payments" value="${A.esc(P.q)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="rows" id="pay-list"></div>
  </div>`, `<a class="fab" href="#/s/payments/add" aria-label="Add payment">${icon('plus')}</a>`);

  A.view.querySelectorAll('[data-list]').forEach(b => b.addEventListener('click', () => { P.list = b.dataset.list; manageView(r); }));
  A.$('#pay-q').addEventListener('input', e => { P.q = e.target.value; renderManageList(); });
  renderManageList();
}

/* ---------- add / edit ---------- */

const options = (list, value) => list.map(v => `<option${v === value ? ' selected' : ''}>${A.esc(v)}</option>`).join('');
const days = value => Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${d}"${d === value ? ' selected' : ''}>${ordinal(d)}</option>`).join('');

function formView(r) {
  const p = r.id ? paymentById(r.id) : null;
  const v = p ?? { name: '', categoryId: 'bills', type: '', tentative: '', cycleFrom: 1, cycleTo: 30, billDate: '', dueDate: today(), remindDays: 3, frequency: 'monthly', everyDays: 28, when: 'Post-payment', channel: 'Bank Account', mode: 'Manual', comments: '' };

  A.view.innerHTML = `
    <header class="topbar">
      ${A.upButton(p ? `#/s/payments/p/${p.id}` : MANAGE)}
      <div class="titles"><h1>${p ? 'Edit payment' : 'Add payment'}</h1><p>Payments</p></div>
      ${A.menuButton}
    </header>
    <div class="scroll"><form class="pay-form" id="pay-form" novalidate>
      <label class="f wide"><span>Payment name</span><input name="name" required maxlength="80" placeholder="e.g. Home rent" value="${A.esc(v.name)}" autocomplete="off"></label>
      <label class="f"><span>Payment category</span><select name="categoryId" id="f-cat"></select></label>
      <label class="f" id="f-type-wrap"><span>Type</span><select name="type" id="f-type"></select></label>
      <p class="muted small wide" id="f-hint"></p>
      <label class="f"><span>Tentative amount</span><input name="tentative" type="number" inputmode="decimal" min="0" step="0.01" required placeholder="0" value="${A.esc(v.tentative)}"></label>
      <label class="f"><span>Remind before due date (days)</span><input name="remindDays" type="number" inputmode="numeric" min="0" max="365" step="1" required value="${A.esc(v.remindDays)}"></label>
      <fieldset class="f wide"><legend>Billing cycle</legend><div class="f-pair">
        <select name="cycleFrom" aria-label="Billing cycle starts on">${days(v.cycleFrom)}</select><span>to</span>
        <select name="cycleTo" aria-label="Billing cycle ends on">${days(v.cycleTo)}</select>
      </div></fieldset>
      <label class="f"><span>Expected bill date</span><input name="billDate" type="date" value="${A.esc(v.billDate)}"></label>
      <label class="f"><span>Due date</span><input name="dueDate" type="date" required value="${A.esc(v.dueDate)}"></label>
      <label class="f"><span>Frequency of bill</span><select name="frequency" id="f-freq">${FREQUENCIES.map(f => `<option value="${f.id}"${f.id === v.frequency ? ' selected' : ''}>${f.label}</option>`).join('')}</select></label>
      <label class="f" id="f-days-wrap"><span>Number of days</span><input name="everyDays" type="number" inputmode="numeric" min="1" max="3650" step="1" value="${A.esc(v.everyDays)}"></label>
      <label class="f"><span>When</span><select name="when">${options(WHEN, v.when)}</select></label>
      <label class="f"><span>Payment channel</span><select name="channel">${options(CHANNELS, v.channel)}</select></label>
      <label class="f"><span>Payment mode</span><select name="mode">${options(MODES, v.mode)}</select></label>
      <label class="f wide"><span>Comments</span><textarea name="comments" rows="3" maxlength="2000">${A.esc(v.comments)}</textarea></label>
      <div class="f-actions wide">
        <button class="btn primary" type="submit">${p ? 'Save changes' : 'Add payment'}</button>
        <a class="btn ghost" href="${p ? `#/s/payments/p/${p.id}` : MANAGE}">Cancel</a>
      </div>
    </form></div>`;

  const form = A.$('#pay-form');
  const cat = A.$('#f-cat'), type = A.$('#f-type'), hint = A.$('#f-hint'), freq = A.$('#f-freq');
  let lastCat = v.categoryId;

  const fillCats = () => {
    cat.innerHTML = categoryList().map(c => `<option value="${c.id}"${c.id === lastCat ? ' selected' : ''}>${A.esc(c.name)}</option>`).join('')
      + '<option value="+">Add new category…</option>';
  };
  const showHint = () => {
    const c = CATEGORIES.find(x => x.id === cat.value);
    const t = c?.types.find(x => x[0] === type.value);
    hint.textContent = c ? `${c.tag}: ${c.about}${t?.[1] ? ` ${t[0]}: ${t[1]}` : ''}` : '';
    hint.hidden = !c;
  };
  const fillTypes = current => {
    const c = CATEGORIES.find(x => x.id === cat.value);
    A.$('#f-type-wrap').hidden = !c;
    type.innerHTML = c ? c.types.map(([t]) => `<option${t === current ? ' selected' : ''}>${A.esc(t)}</option>`).join('') : '';
    showHint();
  };
  const showDays = () => { A.$('#f-days-wrap').hidden = freq.value !== 'days'; };

  fillCats();
  fillTypes(v.type);
  showDays();

  cat.addEventListener('change', async () => {
    if (cat.value === '+') {
      const c = await addCategory();
      lastCat = c?.id ?? lastCat;
      fillCats();
    } else {
      lastCat = cat.value;
    }
    fillTypes();
  });
  type.addEventListener('change', showHint);
  freq.addEventListener('change', showDays);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form));
    const t = Date.now();
    const fields = {
      name: d.name.trim(),
      categoryId: d.categoryId,
      type: d.type ?? '',
      tentative: Number(d.tentative),
      remindDays: Number(d.remindDays),
      cycleFrom: Number(d.cycleFrom),
      cycleTo: Number(d.cycleTo),
      billDate: d.billDate,
      dueDate: d.dueDate,
      frequency: d.frequency,
      everyDays: Number(d.everyDays) || 28,
      when: d.when,
      channel: d.channel,
      mode: d.mode,
      comments: d.comments.trim(),
      updatedAt: t,
    };
    if (!fields.name) return A.toast('Give the payment a name.');
    const saved = p ? Object.assign(p, fields) : { id: A.uid(), endedAt: '', resumedOn: '', createdAt: t, ...fields };
    if (!p) A.S.payments.push(saved);
    await A.persist('payments', saved);
    A.toast(p ? 'Payment updated' : 'Payment added');
    A.go(`#/s/payments/p/${saved.id}`, true);
  });
}

async function addCategory() {
  const name = (await A.ask('New category', '', 'Category name'))?.trim();
  if (!name) return null;
  if (categoryList().some(c => c.name.toLowerCase() === name.toLowerCase())) {
    A.toast(`${name} already exists`);
    return null;
  }
  const t = Date.now();
  const c = { id: A.uid(), name, createdAt: t, updatedAt: t };
  A.S.paymentCategories.push(c);
  await A.persist('paymentCategories', c);
  return c;
}

async function categoriesMenu() {
  const customs = [...A.S.paymentCategories].sort((a, b) => a.createdAt - b.createdAt);
  const k = await A.choose('Custom categories', [
    ...customs.map(c => ({ icon: 'folder', label: c.name })),
    { icon: 'plus', label: 'Add new category' },
  ]);
  if (k == null) return;
  if (k === customs.length) {
    if (await addCategory()) A.refresh();
    return;
  }
  const c = customs[k];
  const j = await A.choose(c.name, [
    { icon: 'edit', label: 'Rename' },
    { icon: 'trash', label: 'Delete category', danger: true },
  ]);
  if (j === 0) {
    const name = (await A.ask('Rename category', c.name))?.trim();
    if (!name) return;
    if (categoryList().some(x => x !== c && x.name.toLowerCase() === name.toLowerCase())) return A.toast(`${name} already exists`);
    Object.assign(c, { name, updatedAt: Date.now() });
    await A.persist('paymentCategories', c);
    A.refresh();
  } else if (j === 1) {
    const used = A.S.payments.filter(p => p.categoryId === c.id).length;
    if (used) return A.toast(`${c.name} is used by ${A.plural(used, 'payment')}`);
    A.S.paymentCategories = A.S.paymentCategories.filter(x => x !== c);
    await db.del('paymentCategories', c.id);
    A.markDirty();
    A.toast('Category deleted');
    A.refresh();
  }
}

/* ---------- view one payment ---------- */

function detailView(r) {
  const p = paymentById(r.id);
  const open = openDues(p, records());
  const history = records().filter(x => x.paymentId === p.id).map(x => ({ ...x })).sort((a, b) => b.due.localeCompare(a.due));
  const spent = history.reduce((sum, x) => sum + x.actual, 0);
  const rows = [
    ['Category', typeLine(p)],
    ['Tentative amount', money(p.tentative)],
    ['Billing cycle', cycleLabel(p)],
    ['Expected bill date', p.billDate ? fullDate(p.billDate) : 'Not set'],
    ['Due date', fullDate(p.dueDate)],
    ['Remind before', `${A.plural(p.remindDays, 'day')} of due date`],
    ['Frequency', freqLabel(p)],
    ['When', p.when],
    ['Payment channel', p.channel],
    ['Payment mode', p.mode],
    ...(p.comments ? [['Comments', p.comments]] : []),
  ];

  A.view.innerHTML = `
    <header class="topbar">
      ${A.upButton(MANAGE)}
      <div class="titles"><h1>${A.esc(p.name)}</h1><p>${A.esc(typeLine(p))}</p></div>
      <button class="icon-btn" data-act="pay-menu" data-id="${p.id}" aria-label="Payment options">${icon('more')}</button>
      ${A.menuButton}
    </header>
    ${p.endedAt ? `<div class="banner">${icon('archive')}<span>Ended ${fullDate(p.endedAt)}. No future payments.</span><button class="btn sm" data-act="pay-resume" data-id="${p.id}">Resume</button></div>` : ''}
    <div class="scroll"><div class="pay-page">
      ${open.length ? `<section class="panel"><h2>Open dues</h2><div class="rows">${open.map(dueRow).join('')}</div></section>` : ''}
      <section class="panel"><h2>Details</h2><dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${A.esc(v)}</dd></div>`).join('')}</dl></section>
      <section class="panel">
        <h2>Payment history</h2>
        ${history.length ? `<p class="muted">${A.plural(history.length, 'payment')}, ${money(spent)} in total</p>
          <div class="rows">${history.map(x => `<button class="hist" data-act="pay-record" data-id="${x.id}">
            <span class="sub-text"><span class="card-title">${money(x.actual)}</span><span class="card-meta">Due ${fullDate(x.due)} · Paid ${fullDate(x.paidOn)}</span></span>
            ${icon('dots')}
          </button>`).join('')}</div>` : '<p class="muted">Nothing paid yet.</p>'}
      </section>
    </div></div>`;
}

/* ---------- report ---------- */

function reportView(r) {
  const [from, to] = periodRange();
  const list = occurrencesIn(A.S.payments, records(), from, to);
  const s = summarize(list);
  const tentative = list.reduce((sum, o) => sum + o.tentative, 0);
  const actual = list.reduce((sum, o) => sum + (o.record?.actual ?? 0), 0);
  const cols = ['Due date', 'Payment', 'Category', 'Bill date', 'Billing cycle', 'Frequency', 'When', 'Channel', 'Mode', 'Tentative', 'Actual', 'Status', 'Paid on', 'Comments'];
  const td = (i, html, cls = '') => `<td data-label="${cols[i]}"${cls ? ` class="${cls}"` : ''}>${html || '<span class="dash">–</span>'}</td>`;

  shell(r, `Report · ${periodLabel()}`, `<div class="pay-page report-page">
    ${periodBar()}
    <div class="report-head">
      <div><h2>Payments report</h2><p class="muted">${periodLabel()} · ${A.plural(list.length, 'payment')}</p></div>
      <button class="btn primary" data-act="pay-print"${list.length ? '' : ' disabled'}>${icon('download')}<span>Export to PDF</span></button>
    </div>
    <div class="stats">
      ${stat('Total', money(s.total))}
      ${stat('Paid', money(s.paid))}
      ${stat('Pending', money(s.pending))}
      ${stat('Overdue', money(s.overdue))}
    </div>
    ${list.length ? `<table class="report">
      <thead><tr>${cols.map((c, i) => `<th${i === 9 || i === 10 ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead>
      <tbody>${list.map(o => {
        const p = o.payment;
        return `<tr>
          ${td(0, fullDate(o.due))}
          ${td(1, `<a href="#/s/payments/p/${p.id}">${A.esc(p.name)}</a>`, 'strong')}
          ${td(2, A.esc(typeLine(p)))}
          ${td(3, o.bill ? fullDate(o.bill) : '')}
          ${td(4, cycleLabel(p))}
          ${td(5, A.esc(freqLabel(p)))}
          ${td(6, A.esc(p.when))}
          ${td(7, A.esc(o.channel))}
          ${td(8, A.esc(o.mode))}
          ${td(9, money(o.tentative), 'num')}
          ${td(10, o.record ? money(o.record.actual) : '', 'num')}
          ${td(11, chip(o))}
          ${td(12, o.record ? fullDate(o.record.paidOn) : '')}
          ${td(13, A.esc(p.comments), 'notes')}
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th colspan="9">Total</th><td class="num" data-label="Tentative">${money(tentative)}</td><td class="num" data-label="Actual">${money(actual)}</td><td colspan="3"></td></tr></tfoot>
    </table>` : `<div class="empty">${icon('file')}<p>No payments in ${periodLabel()}.</p></div>`}
  </div>`);
  bindPeriod(() => reportView(r));
}

// The browser's print dialog saves the PDF, so names and the currency symbol
// render in any script without bundling a PDF library and its fonts. The title
// becomes the suggested file name.
function exportPdf() {
  const title = document.title;
  const period = P.mode === 'month' ? `${P.year}-${String(P.month).padStart(2, '0')}` : String(P.year);
  document.title = `SuperApp-payments-${period}`;
  addEventListener('afterprint', () => { document.title = title; }, { once: true });
  print();
}

/* ---------- actions ---------- */

// A form in the shared dialog. Resolves to the form's values, or null.
function formDialog(title, fields, okLabel) {
  const d = A.$('#modal');
  d.className = 'modal';
  d.innerHTML = `<form method="dialog"><h2>${A.esc(title)}</h2>${fields}
    <div class="actions">
      <button value="ok" class="btn ok primary">${A.esc(okLabel)}</button>
      <button value="" class="btn ghost" formnovalidate>Cancel</button>
    </div></form>`;
  return new Promise(resolve => {
    const form = d.querySelector('form');
    let values = null;
    form.addEventListener('submit', e => { if (e.submitter?.value) values = Object.fromEntries(new FormData(form)); });
    d.onclose = () => resolve(d.returnValue ? values : null);
    d.onclick = e => { if (e.target === d) d.close(''); };
    d.returnValue = '';
    d.showModal();
    d.querySelector('input').select();
  });
}

function paidFields(amount, paidOn) {
  return `<label class="f"><span>Actual amount</span><input name="actual" type="number" inputmode="decimal" min="0" step="0.01" required value="${A.esc(amount)}"></label>
    <label class="f"><span>Paid on</span><input name="paidOn" type="date" required value="${A.esc(paidOn)}"></label>`;
}

async function markPaid(id, due) {
  const p = paymentById(id);
  const o = occurrencesIn([p], records(), due, due).find(x => !x.record);
  if (!o) return;
  const v = await formDialog(`Mark ${p.name} as paid`, `<p>Due ${fullDate(due)} · Tentative ${money(o.tentative)}</p>${paidFields(o.tentative, today())}`, 'Mark as paid');
  if (!v) return;
  const t = Date.now();
  const rec = {
    id: `${p.id}:${due}`, paymentId: p.id, due, bill: o.bill, tentative: o.tentative,
    actual: Number(v.actual), paidOn: v.paidOn, channel: o.channel, mode: o.mode, createdAt: t, updatedAt: t,
  };
  A.S.paymentRecords.push(rec);
  await A.persist('paymentRecords', rec);
  A.toast(`${p.name} marked as paid`, { label: 'Undo', fn: () => removeRecord(rec) });
  A.refresh();
}

async function removeRecord(rec) {
  A.S.paymentRecords = A.S.paymentRecords.filter(x => x !== rec);
  await db.del('paymentRecords', rec.id);
  A.markDirty();
  A.refresh();
}

async function recordMenu(id) {
  const rec = records().find(x => x.id === id);
  const k = await A.choose(`${money(rec.actual)} paid ${fullDate(rec.paidOn)}`, [
    { icon: 'edit', label: 'Edit amount or date' },
    { icon: 'restore', label: 'Mark as unpaid', danger: true },
  ]);
  if (k === 0) {
    const v = await formDialog('Edit payment', paidFields(rec.actual, rec.paidOn), 'Save');
    if (!v) return;
    Object.assign(rec, { actual: Number(v.actual), paidOn: v.paidOn, updatedAt: Date.now() });
    await A.persist('paymentRecords', rec);
    A.refresh();
  } else if (k === 1) {
    await removeRecord(rec);
    A.toast('Marked as unpaid');
  }
}

async function endPayment(p) {
  if (!await A.confirmDlg(`End “${p.name}”?`, 'It moves to Ended and no future payments are scheduled. Paid history stays in your reports; unpaid dues are dropped.', 'End payment')) return;
  Object.assign(p, { endedAt: today(), updatedAt: Date.now() });
  await A.persist('payments', p);
  A.toast('Payment ended');
  A.refresh();
}

async function resumePayment(p) {
  Object.assign(p, { endedAt: '', resumedOn: today(), updatedAt: Date.now() });
  await A.persist('payments', p);
  A.toast('Payment resumed');
  A.refresh();
}

async function deletePayment(p) {
  const paid = records().filter(x => x.paymentId === p.id);
  const msg = paid.length
    ? `Its ${A.plural(paid.length, 'paid record')} will be removed from your reports too. To keep them, end the payment instead. This cannot be undone.`
    : 'This cannot be undone.';
  if (!await A.confirmDlg(`Delete “${p.name}”?`, msg, 'Delete')) return;
  A.S.payments = A.S.payments.filter(x => x !== p);
  A.S.paymentRecords = A.S.paymentRecords.filter(x => x.paymentId !== p.id);
  await db.del('payments', p.id);
  for (const x of paid) await db.del('paymentRecords', x.id);
  A.markDirty();
  A.toast('Payment deleted');
  if (A.S.route.id === p.id) A.go(MANAGE, true);
  else A.refresh();
}

async function paymentMenu(id) {
  const p = paymentById(id);
  const next = openDues(p, records())[0];
  const acts = [
    ...(next ? [[{ icon: 'check', label: `Mark ${shortDate(next.due)} as paid` }, () => markPaid(p.id, next.due)]] : []),
    ...(A.S.route.page === 'p' ? [] : [[{ icon: 'eye', label: 'View details' }, () => A.go(`#/s/payments/p/${p.id}`)]]),
    [{ icon: 'edit', label: 'Edit' }, () => A.go(`#/s/payments/edit/${p.id}`)],
    p.endedAt
      ? [{ icon: 'restore', label: 'Resume payment' }, () => resumePayment(p)]
      : [{ icon: 'archive', label: 'End payment' }, () => endPayment(p)],
    [{ icon: 'trash', label: 'Delete', danger: true }, () => deletePayment(p)],
  ];
  const k = await A.choose(p.name, acts.map(a => a[0]));
  if (k != null) acts[k][1]();
}

export function paymentAction(b) {
  const { act, id, due } = b.dataset;
  switch (act) {
    case 'pay-mark': return markPaid(id, due);
    case 'pay-menu': return paymentMenu(id);
    case 'pay-record': return recordMenu(id);
    case 'pay-resume': return resumePayment(paymentById(id));
    case 'pay-cats': return categoriesMenu();
    case 'pay-print': return exportPdf();
  }
}

export function paymentsView(r) {
  if (r.page === 'manage') manageView(r);
  else if (r.page === 'report') reportView(r);
  else if (r.page === 'add' || r.page === 'edit') formView(r);
  else if (r.page === 'p') detailView(r);
  else dashboardView(r);
}

/* ---------- chart tooltip ---------- */

// Hover and keyboard only: on touch, every value is already written out.
function installTooltip() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.append(tip);
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${Math.min(x, innerWidth - tip.offsetWidth / 2 - 8)}px`;
    tip.style.top = `${y}px`;
  };
  A.view.addEventListener('pointermove', e => {
    const el = e.pointerType === 'mouse' && e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY - 12);
    else tip.hidden = true;
  });
  A.view.addEventListener('pointerleave', () => { tip.hidden = true; });
  A.view.addEventListener('focusin', e => {
    const el = e.target.closest('[data-tip]');
    if (!el || !el.matches(':focus-visible')) return;
    const box = el.getBoundingClientRect();
    show(el, box.left + box.width / 2, box.top - 6);
  });
  A.view.addEventListener('focusout', () => { tip.hidden = true; });
}
