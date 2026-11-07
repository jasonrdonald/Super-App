// The Net worth section: Portfolio and Retirals as assets, less what Loans still owe,
// with a Milestones page that projects net worth as loans are paid down. Amounts
// follow Portfolio's privacy switch and the app's Short amounts setting.

import { icon } from './icons.js';
import { CONFIG } from './config.js';
import { shortAmounts, shortMoney } from './format.js';
import { portfolioParts, portfolioGoalStart } from './portfolio-view.js';
import { retiralsParts } from './retirals-view.js';
import { loanParts } from './loans-view.js';
import { createMilestones } from './milestones.js';

const HOME = '#/s/networth';
const MASK = '••••••';
let A;

export function initNetworth(helpers) { A = helpers; }

const isPrivate = () => A.ls.get('pfPrivate', false);
const full = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 });
const money = v => (v == null ? '–' : isPrivate() ? MASK : shortAmounts() ? shortMoney(v) : full.format(v));
const pct = v => `${v.toFixed(1)}%`;
const monthName = s => A.fmt(new Date(`${s}T00:00:00`), { month: 'short', year: 'numeric' });

export const networthNav = () => [
  { id: 'home', name: 'Overview', icon: 'pie', href: HOME },
  { id: 'milestones', name: 'Milestones', icon: 'chart', href: `${HOME}/milestones` },
];

// Asset groups in a fixed order, so each keeps its colour whatever else is there.
const GROUPS = [
  { id: 'portfolio', label: 'Portfolio', cls: 'nw-portfolio' },
  { id: 'EPF', label: 'EPF', cls: 'nw-epf' },
  { id: 'NPS', label: 'NPS', cls: 'nw-nps' },
  { id: 'LIC', label: 'LIC', cls: 'nw-lic' },
];

function worth() {
  const brokers = portfolioParts();
  const retirals = retiralsParts();
  const loans = loanParts();
  const groups = GROUPS.map(g => {
    const items = g.id === 'portfolio' ? brokers.filter(b => b.value != null) : retirals.filter(r => r.kind === g.id);
    return { ...g, items, value: items.reduce((n, x) => n + x.value, 0) };
  }).filter(g => g.items.length);
  const assets = groups.reduce((n, g) => n + g.value, 0);
  const owed = loans.reduce((n, l) => n + l.owed, 0);
  return { groups, assets, owed, net: assets - owed, loans, retirals, missing: brokers.filter(b => b.value == null) };
}

export const networthTileText = () => {
  const w = worth();
  return w.assets || w.owed ? money(w.net) : '';
};

function hero(title, sub) {
  const eye = isPrivate();
  return `<header class="topbar hero">
    ${A.upButton('#/')}
    <span class="hero-icon">${icon('columns')}</span>
    <div class="titles"><h1>${A.esc(title)}</h1><p>${A.esc(sub)}</p></div>
    <button class="icon-btn" data-act="nw-privacy" aria-pressed="${eye}" aria-label="${eye ? 'Show amounts' : 'Hide amounts'}" title="${eye ? 'Show amounts' : 'Hide amounts'}">${icon(eye ? 'eyeOff' : 'eye')}</button>
    ${A.menuButton}
  </header>`;
}

const stat = (label, value, note = '') => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-note">${note}</span></div>`;

// Assets as one bar split by group, and what's owed as a second bar on the same scale.
function balanceBars(w) {
  const scale = Math.max(w.assets, w.owed) || 1;
  return `<div class="nw-bars">
    <div class="nw-bar-row"><span class="nw-bar-label">Own</span>
      <div class="nw-bar" style="width:${w.assets / scale * 100}%">${w.groups.map(g => `<span class="${g.cls}" style="flex:${g.value}" title="${A.esc(`${g.label}: ${money(g.value)}`)}"></span>`).join('')}</div></div>
    ${w.owed ? `<div class="nw-bar-row"><span class="nw-bar-label">Owe</span>
      <div class="nw-bar" style="width:${w.owed / scale * 100}%"><span class="nw-owed" style="flex:1" title="${A.esc(`Loans: ${money(w.owed)}`)}"></span></div></div>` : ''}
  </div>
  <div class="nw-legend">${w.groups.map(g => `<span><i class="sw ${g.cls}"></i>${g.label} ${pct(g.value / w.assets * 100)}</span>`).join('')}${w.owed ? '<span><i class="sw nw-owed"></i>Loans</span>' : ''}</div>`;
}

function overview() {
  const w = worth();
  if (!w.assets && !w.owed) {
    A.view.innerHTML = `${hero('Net worth', 'What you own, less what you owe')}
      <div class="scroll"><div class="empty">${icon('columns')}<p>Net worth adds up Portfolio and Retirals, and takes off what Loans still owe. Load your brokers, EPF, NPS, LIC or a loan schedule in those sections, and it shows here.</p>
      <div class="btn-row"><a class="btn sm" href="#/s/portfolio">Portfolio</a><a class="btn sm" href="#/s/retirals">Retirals</a><a class="btn sm" href="#/s/loans">Loans</a></div></div></div>`;
    return;
  }
  const retirals = w.groups.filter(g => g.id !== 'portfolio').reduce((n, g) => n + g.value, 0);
  const portfolio = w.groups.find(g => g.id === 'portfolio')?.value ?? 0;
  const repaid = w.loans.filter(l => l.owed > 0).sort((a, b) => b.endsIn - a.endsIn)[0];
  const insights = [
    w.owed ? `Loans are ${pct(w.owed / w.assets * 100)} of what you own. For every ₹100 of assets, you owe ₹${(w.owed / w.assets * 100).toFixed(0)}.` : 'You have no loans here, so your net worth is everything you own.',
    retirals ? `Retirals are ${pct(retirals / w.assets * 100)} of your assets. EPF and NPS are mostly locked until retirement, so the part you can reach sooner is your portfolio, ${money(portfolio)}${w.owed ? `, or ${money(portfolio - w.owed)} after loans` : ''}.` : '',
    repaid ? `Repaying your loan${w.loans.length > 1 ? 's' : ''} as scheduled adds ${money(w.owed)} to your net worth by ${monthName(repaid.last)}, even if nothing else grows.` : '',
    w.missing.length ? `${w.missing.map(b => A.esc(b.name)).join(', ')} ${w.missing.length === 1 ? "isn't" : "aren't"} counted, as there's no dollar rate yet. Open Portfolio online to fetch one.` : '',
  ].filter(Boolean);
  const row = (name, value, href, share, cls = '') => `<tr class="${cls}"><th scope="row">${href ? `<a href="${href}">${A.esc(name)}</a>` : A.esc(name)}</th><td class="num">${money(value)}</td><td class="num">${share == null ? '' : pct(share)}</td></tr>`;
  A.view.innerHTML = `${hero('Net worth', 'What you own, less what you owe')}
    <div class="scroll"><div class="pay-page pf-page">
      <div class="nw-hero"><span class="stat-label">Net worth</span><span class="nw-big">${money(w.net)}</span><span class="muted small">${money(w.assets)} owned − ${money(w.owed)} owed</span></div>
      <div class="stats five">
        ${stat('You own', money(w.assets), `Portfolio ${money(portfolio)} · retirals ${money(retirals)}`)}
        ${stat('You owe', money(w.owed), w.loans.length ? A.plural(w.loans.length, 'loan') : 'No loans')}
        ${stat('Debt to assets', w.assets ? pct(w.owed / w.assets * 100) : '–', 'What you owe for each rupee you own')}
        ${stat('Reachable now', money(portfolio - w.owed), 'Portfolio less loans, leaving retirals out')}
      </div>
      <section class="panel"><h2>What makes it up</h2>
        ${balanceBars(w)}
        <ul class="loan-insights">${insights.map(t => `<li>${icon('info')}<span>${t}</span></li>`).join('')}</ul>
      </section>
      <section class="panel"><h2>Balance sheet</h2>
        <div class="holdings-wrap"><table class="holdings pf-summary nw-sheet">
          <thead><tr><th>Item</th><th class="num">Value</th><th class="num">Share of assets</th></tr></thead>
          <tbody>
            ${w.groups.map(g => `<tr class="nw-group"><th scope="row"><i class="sw ${g.cls}"></i>${g.label}</th><td class="num">${money(g.value)}</td><td class="num">${pct(g.value / w.assets * 100)}</td></tr>
              ${g.items.length > 1 || g.id === 'portfolio' ? g.items.map(x => row(x.name, x.value, x.href, x.value / w.assets * 100, 'nw-item')).join('') : ''}`).join('')}
            <tr class="nw-group"><th scope="row">You own</th><td class="num">${money(w.assets)}</td><td class="num">100%</td></tr>
            ${w.loans.map(l => row(`${l.name}, still owed`, -l.owed, l.href, null, 'nw-item ret-out')).join('')}
          </tbody>
          <tfoot><tr><th scope="row">Net worth</th><td class="num">${money(w.net)}</td><td></td></tr></tfoot>
        </table></div>
        <p class="muted small chart-note">Portfolio is today's market value, with US holdings at today's dollar rate. EPF is its balance, leaving out the pension (EPS). NPS is its latest statement's value. LIC counts only its minimum surrender value, the certain part if surrendered today. Loans are what's owed after the EMIs paid so far.</p>
      </section>
    </div></div>`;
}

// Net worth's milestones: assets grow at the blended return and take the monthly
// amount, while each loan's balance falls along its schedule.
function milestones() {
  const w = worth();
  const pf = portfolioGoalStart();
  const portfolio = w.groups.find(g => g.id === 'portfolio')?.value ?? 0;
  const rated = [...(pf.xirr != null && portfolio ? [[portfolio, pf.xirr]] : []), ...w.retirals.filter(r => r.rate != null && r.value).map(r => [r.value, r.rate])];
  const weight = rated.reduce((n, [v]) => n + v, 0);
  const blended = weight ? Math.round(Math.min(Math.max(rated.reduce((n, [v, r]) => n + v * r, 0) / weight, 1), 30) * 2) / 2 : null;
  const retiralMonthly = w.retirals.reduce((n, r) => n + (r.monthly || 0), 0);
  const monthly = Math.round((pf.monthly + retiralMonthly) / 1000) * 1000;
  const length = Math.max(1, ...w.loans.map(l => l.byMonth.length));
  const debt = Array.from({ length }, (_, m) => w.loans.reduce((n, l) => n + (l.byMonth[Math.min(m, l.byMonth.length - 1)] ?? 0), 0));
  const freed = w.loans.filter(l => l.owed > 0).map(l => ({ from: l.endsIn, amount: l.emi, name: l.name, until: l.last ? monthName(l.last) : null }));
  const page = createMilestones(A, {
    money, key: 'nwGoal', subject: 'your net worth', xirrLabel: 'Blended', monthlyLabel: 'Added to assets a month',
    start: { assets: w.assets, debt: w.owed ? debt : [], freed, xirr: blended, monthly },
    empty: `<div class="empty">${icon('chart')}<p>Net worth needs to be above zero to grow towards a milestone. Load your brokers and retirals first.</p></div>`,
    stats: `<div class="stats five">
      ${stat('Net worth today', money(w.net), `${money(w.assets)} owned − ${money(w.owed)} owed`)}
      ${stat('Blended return', blended != null ? `${blended}%` : '–', 'Portfolio XIRR, EPF and NPS rates, weighted by value')}
      ${stat('Going in a month', money(monthly), `Portfolio ${money(pf.monthly)} + EPF ${money(retiralMonthly)}`)}
      ${stat('Loans owed', money(w.owed), w.loans.length ? `Repaid by ${monthName(w.loans.map(l => l.last).sort().at(-1))}` : 'None')}
    </div>`,
    note: 'Assets grow at one return a year, with the monthly amount added each month. Loans fall along their schedules as EMIs are paid, which lifts net worth on its own; the EMIs themselves come from your income, so they aren\'t taken from the monthly amount. Real returns rise and fall, and rates on floating loans change, so treat these dates as rough guides, not a forecast or advice.',
  });
  A.view.innerHTML = `${hero('Net worth', 'Milestones')}
    <div class="scroll"><div class="pay-page pf-page">${page.page()}</div></div>`;
  page.bind();
}

export function networthView(r) {
  if (r.page === 'milestones') milestones();
  else overview();
}

export function networthAction(b) {
  if (b.dataset.act === 'nw-privacy') {
    A.ls.set('pfPrivate', !isPrivate());
    A.refresh();
  }
}
