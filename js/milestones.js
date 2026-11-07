// Milestones: how long until a value reaches ₹1, 2, 5 and 10 crore, and what-ifs
// on the return, a monthly investment and its yearly step-up. Portfolio uses it on
// its own value; Net worth uses assets less what the loans still owe, which falls
// month by month along each loan's schedule, and can put a repaid loan's EMI to work.

import { icon } from './icons.js';

const GOALS = [[1e7, '₹1 Cr'], [2e7, '₹2 Cr'], [5e7, '₹5 Cr'], [1e8, '₹10 Cr']];
const GOAL_RATES = [6, 8, 10, 12, 15, 18, 20];
const MAX_MONTHS = 600;
const crText = v => `₹${Number((v / 1e7).toFixed(2))} Cr`;

// A start is { assets, debt: owed by month from now (optional), freed: [{ from, amount, name }] (optional), xirr, monthly }.
const debtAt = (start, m) => (start.debt?.length ? start.debt[Math.min(m, start.debt.length - 1)] : 0);
const netNow = start => start.assets - debtAt(start, 0);

// Net value month by month: assets compound and take the monthly amount, which rises
// each year by the step-up, plus any repaid loan's EMI when it's reinvested. Growth
// alone adds no new money, though loans still fall as their EMIs are paid.
function path(start, { cagr, monthly, stepUp, reinvest }, months, bare = false) {
  const rate = (1 + cagr / 100) ** (1 / 12) - 1;
  const values = [netNow(start)];
  let assets = start.assets, add = bare ? 0 : monthly;
  for (let m = 1; m <= months; m++) {
    const freed = !bare && reinvest ? (start.freed ?? []).filter(f => m > f.from).reduce((n, f) => n + f.amount, 0) : 0;
    assets = assets * (1 + rate) + add + freed;
    values.push(assets - debtAt(start, m));
    if (m % 12 === 0 && !bare) add *= 1 + stepUp / 100;
  }
  return values;
}

function monthsTo(target, start, plan, bare = false) {
  if (netNow(start) >= target) return 0;
  const values = path(start, plan, MAX_MONTHS, bare);
  const m = values.findIndex(v => v >= target);
  return m < 0 ? null : m;
}

// The yearly return that reaches the target in the given months, found by halving.
function rateNeeded(target, start, plan, months) {
  let low = -20, high = 80;
  if ((monthsTo(target, start, { ...plan, cagr: high }) ?? Infinity) > months) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const m = monthsTo(target, start, { ...plan, cagr: mid });
    if (m != null && m <= months) high = mid; else low = mid;
  }
  return high;
}

const spanText = m => (m === 0 ? 'Reached' : m == null ? 'Over 50 years' : [Math.floor(m / 12) && `${Math.floor(m / 12)} yr`, m % 12 && `${m % 12} mo`].filter(Boolean).join(' '));
const shortSpan = m => (m === 0 ? 'Done' : m == null ? '50+' : `${(m / 12).toFixed(1)} yrs`);

const goalTargets = plan => [...GOALS, ...(plan.custom > 0 ? [[plan.custom * 1e7, `${crText(plan.custom * 1e7)}, your goal`]] : [])]
  .sort((a, b) => a[0] - b[0]);

// One Milestones page. `opts` holds the helpers, money formatter, storage key, the
// start, the stats above the controls, labels and the closing note.
export function createMilestones(A, opts) {
  const { money, key, start } = opts;
  const freed = start.freed ?? [];
  const monthsAhead = m => {
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    return A.fmt(d, { month: 'short', year: 'numeric' });
  };
  // When a loan's last EMI falls, as the schedule has it.
  const endText = f => f.until ?? monthsAhead(f.from);
  const saved = () => A.ls.get(key, {});
  const settings = () => {
    const plan = saved();
    return { cagr: plan.cagr ?? start.xirr ?? 12, monthly: plan.monthly ?? start.monthly, stepUp: plan.stepUp ?? 0, custom: plan.custom ?? 0, reinvest: plan.reinvest ?? false };
  };

  function outputs(plan) {
    const now = netNow(start);
    const targets = goalTargets(plan);
    const times = targets.map(([target]) => monthsTo(target, start, plan));
    const bare = targets.map(([target]) => monthsTo(target, start, plan, true));
    const next = targets.findIndex(([target]) => target > now);
    const lead = next >= 0 ? times[next] : null;
    const faster = next >= 0 && times[next] != null ? monthsTo(targets[next][0], start, { ...plan, cagr: plan.cagr + 1 }) : null;
    const needed = next >= 0 ? rateNeeded(targets[next][0], start, plan, 60) : null;
    // A freed EMI only matters for milestones reached after the loan ends, so compare the first of those.
    const freedFrom = freed.length ? Math.min(...freed.map(f => f.from)) : null;
    const later = freed.length ? targets.findIndex((_, i) => times[i] != null && times[i] > freedFrom) : -1;
    const flip = later >= 0 ? monthsTo(targets[later][0], start, { ...plan, reinvest: !plan.reinvest }) : null;
    const gained = later < 0 ? 0 : plan.reinvest ? (flip ?? MAX_MONTHS) - times[later] : times[later] - (flip ?? MAX_MONTHS);
    const repaid = freed.length ? debtAt(start, 0) : 0;
    const insights = next < 0 ? [] : [
      bare[next] !== times[next] && plan.monthly > 0 ? `Investing ${money(plan.monthly)} a month gets you to ${targets[next][1]} ${spanText((bare[next] ?? MAX_MONTHS) - (times[next] ?? MAX_MONTHS))} sooner than growth alone.` : '',
      faster != null && times[next] - faster > 0 ? `Each extra 1% a year brings ${targets[next][1]} about ${spanText(times[next] - faster)} closer.` : '',
      needed != null && (times[next] == null || times[next] > 60) ? `To reach ${targets[next][1]} within 5 years at this investment, you'd need about ${needed.toFixed(1)}% a year.` : '',
      repaid ? `Paying off your loans as scheduled adds ${money(repaid)} to your net worth by ${endText([...freed].sort((a, b) => b.from - a.from)[0])}, with no new money.` : '',
      gained > 0 ? (plan.reinvest
        ? `Investing the EMI once ${freed.length === 1 ? 'the loan is' : 'each loan is'} repaid brings ${targets[later][1]} ${spanText(gained)} sooner.`
        : `Investing your ${money(freed.reduce((n, f) => n + f.amount, 0))} EMI once ${freed.length === 1 ? 'the loan is' : 'each loan is'} repaid would bring ${targets[later][1]} ${spanText(gained)} sooner. Turn it on above to see it.`) : '',
    ].filter(Boolean);
    const rates = [...new Set([...GOAL_RATES, plan.cagr])].sort((a, b) => a - b);
    return `
      <section class="panel goal-lead">
        ${next < 0 ? `<p class="goal-big">You've passed every milestone here. Set your own goal below.</p>`
          : `<p class="goal-big">At <b>${plan.cagr}%</b> a year${plan.monthly ? `, adding <b>${money(plan.monthly)}</b> a month` : ''}, ${opts.subject ?? 'you'} reach${opts.subject ? 'es' : ''} <b>${targets[next][1]}</b> ${lead == null ? '<b>in over 50 years</b>' : `in <b>${spanText(lead)}</b>, by <b>${monthsAhead(lead)}</b>`}.</p>`}
        ${insights.length ? `<ul class="goal-insights">${insights.map(t => `<li>${icon('chart')}<span>${t}</span></li>`).join('')}</ul>` : ''}
      </section>
      <div class="goal-cards">${targets.map(([target, label], i) => {
        const done = Math.max(0, Math.min(now / target * 100, 100));
        return `<div class="goal-card${times[i] === 0 ? ' reached' : ''}">
          <span class="goal-name">${A.esc(label)}</span>
          <span class="goal-time">${spanText(times[i])}</span>
          <span class="goal-when">${times[i] === 0 ? 'Already there' : times[i] == null ? 'Not within 50 years' : `By ${monthsAhead(times[i])}`}</span>
          <span class="goal-bar" role="img" aria-label="${done.toFixed(0)}% of the way"><i style="width:${done}%"></i></span>
          <span class="goal-note">${done.toFixed(0)}% there${times[i] && bare[i] !== times[i] ? ` · ${shortSpan(bare[i])} with no new money` : ''}</span>
        </div>`;
      }).join('')}</div>
      <section class="panel"><h2>Your path</h2>
        <div class="g-legend"><span><i class="g-key goal-key-plan"></i>With your monthly investment</span><span><i class="g-key goal-key-bare"></i>Growth alone${freed.length ? ', loans still repaid' : ''}</span></div>
        <div class="pf-growth" id="g-chart"></div>
      </section>
      <section class="panel"><h2>What if the return were different?</h2>
        <p class="muted small chart-note">Years to each milestone at your monthly investment and step-up. Your chosen return is highlighted.</p>
        <div class="holdings-wrap"><table class="holdings pf-summary goal-grid">
          <thead><tr><th>Return a year</th>${targets.map(([, label]) => `<th class="num">${A.esc(label.replace(', your goal', ''))}</th>`).join('')}</tr></thead>
          <tbody>${rates.map(rate => `<tr class="${rate === plan.cagr ? 'goal-pick' : ''}"><th scope="row"><button class="goal-rate" data-cagr="${rate}">${rate}%</button></th>${targets.map(([target]) => `<td class="num">${shortSpan(monthsTo(target, start, { ...plan, cagr: rate }))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </section>`;
  }

  function page() {
    const plan = settings();
    if (!(netNow(start) > 0)) return opts.empty;
    const presets = [...(start.xirr != null ? [[start.xirr, `${opts.xirrLabel ?? 'Your XIRR'} ${start.xirr}%`]] : []), [8, '8%'], [10, '10%'], [12, '12%'], [15, '15%']]
      .filter(([v], i, all) => all.findIndex(([w]) => w === v) === i);
    return `
      ${opts.stats}
      <section class="panel goal-controls">
        <div class="goal-field">
          <label for="g-cagr">${opts.rateLabel ?? 'Expected return a year'} <output id="g-cagr-out">${plan.cagr}%</output></label>
          <input type="range" id="g-cagr" min="0" max="30" step="0.5" value="${plan.cagr}">
          <div class="goal-presets">${presets.map(([v, l]) => `<button class="btn sm" data-cagr="${v}">${l}</button>`).join('')}</div>
        </div>
        <div class="goal-field">
          <label for="g-monthly">${opts.monthlyLabel ?? 'Monthly investment'} <output id="g-monthly-out">${money(plan.monthly)}</output></label>
          <input type="range" id="g-monthly" min="0" max="500000" step="5000" value="${plan.monthly}">
          <input class="input" type="number" id="g-monthly-exact" min="0" step="1000" value="${plan.monthly}" aria-label="Exact monthly amount">
        </div>
        <div class="goal-field">
          <label for="g-step">Yearly increase in investment <output id="g-step-out">${plan.stepUp}%</output></label>
          <input type="range" id="g-step" min="0" max="25" step="1" value="${plan.stepUp}">
        </div>
        <div class="goal-field">
          <label for="g-custom">Your own goal, in crores</label>
          <input class="input" type="number" id="g-custom" min="0" step="0.5" value="${plan.custom || ''}" placeholder="e.g. 3">
        </div>
        ${freed.length ? `<div class="goal-field">
          <label class="switch"><input type="checkbox" id="g-reinvest"${plan.reinvest ? ' checked' : ''}><span>Invest the EMI once ${freed.length === 1 ? 'the loan is' : 'each loan is'} repaid</span></label>
          <span class="muted small">${freed.map(f => `${money(f.amount)} a month after the last EMI in ${endText(f)}${freed.length > 1 ? `, ${A.esc(f.name)}` : ''}`).join('; ')}</span>
        </div>` : ''}
      </section>
      <div id="g-out">${outputs(plan)}</div>
      <p class="muted small chart-note">${opts.note}</p>`;
  }

  function drawChart(plan) {
    const box = A.$('#g-chart');
    if (!box) return;
    const targets = goalTargets(plan);
    const last = targets.map(([t]) => monthsTo(t, start, plan)).filter(m => m != null).at(-1) ?? 120;
    const months = Math.min(MAX_MONTHS, Math.max(120, Math.ceil((last + 12) / 12) * 12));
    const lines = [['plan', path(start, plan, months)], ['bare', path(start, plan, months, true)]];
    const w = box.clientWidth, narrow = w < 560, h = narrow ? 240 : 300;
    const m = { l: 58, r: 14, t: 14, b: 26 };
    const x = i => m.l + i / months * (w - m.l - m.r);
    const top = Math.max(...lines[0][1], targets.at(-1)[0]) * 1.05;
    const y = v => m.t + (1 - Math.max(0, Math.min(v, top)) / top) * (h - m.t - m.b);
    const year = new Date().getFullYear();
    const every = Math.ceil(months / 12 / (narrow ? 4 : 8));
    box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${targets.map(([t, label]) => `<line class="g-grid" x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="g-axis" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${A.esc(label.replace(', your goal', ''))}</text>`).join('')}
      <line class="g-zero" x1="${m.l}" x2="${w - m.r}" y1="${y(0)}" y2="${y(0)}"/>
      ${Array.from({ length: Math.floor(months / 12) + 1 }, (_, i) => i).filter(i => i % every === 0).map(i => `<text class="g-axis" x="${x(i * 12)}" y="${h - 8}" text-anchor="${i ? 'middle' : 'start'}">${year + i}</text>`).join('')}
      ${lines.map(([id, values]) => `<path class="goal-line goal-${id}" d="${values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}"/>`).join('')}
      ${targets.map(([t]) => monthsTo(t, start, plan)).map(mo => (mo && mo <= months ? `<circle class="goal-dot" cx="${x(mo)}" cy="${y(lines[0][1][mo])}" r="5"/>` : '')).join('')}
      <line class="g-cross" y1="${m.t}" y2="${h - m.b}" hidden/>
    </svg><div class="g-tip" hidden></div>`;
    const tip = box.querySelector('.g-tip'), cross = box.querySelector('.g-cross');
    box.onpointermove = e => {
      const i = Math.round(Math.min(Math.max((e.clientX - box.getBoundingClientRect().left - m.l) / (w - m.l - m.r), 0), 1) * months);
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.removeAttribute('hidden');
      tip.hidden = false;
      const owed = debtAt(start, i);
      tip.innerHTML = `<strong>${monthsAhead(i)}</strong><span>With your investment ${money(lines[0][1][i])}</span><span>Growth alone ${money(lines[1][1][i])}</span>${start.debt?.length && owed ? `<span>Loans still owed ${money(owed)}</span>` : ''}`;
      tip.style.left = `${Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), w - tip.offsetWidth)}px`;
    };
    box.onpointerleave = () => { tip.hidden = true; cross.setAttribute('hidden', ''); };
  }

  // The sliders redraw only the results, so typing and dragging stay smooth.
  function bind() {
    if (!(netNow(start) > 0) || !A.$('#g-cagr')) return;
    const read = () => ({
      cagr: Number(A.$('#g-cagr').value), monthly: Number(A.$('#g-monthly-exact').value) || 0,
      stepUp: Number(A.$('#g-step').value), custom: Number(A.$('#g-custom').value) || 0, reinvest: !!A.$('#g-reinvest')?.checked,
    });
    const update = () => {
      const plan = read();
      A.ls.set(key, plan);
      A.$('#g-cagr-out').textContent = `${plan.cagr}%`;
      A.$('#g-monthly-out').textContent = money(plan.monthly);
      A.$('#g-step-out').textContent = `${plan.stepUp}%`;
      A.$('#g-out').innerHTML = outputs(plan);
      drawChart(plan);
    };
    for (const id of ['#g-cagr', '#g-step', '#g-custom']) A.$(id).addEventListener('input', update);
    A.$('#g-reinvest')?.addEventListener('change', update);
    A.$('#g-monthly').addEventListener('input', e => { A.$('#g-monthly-exact').value = e.target.value; update(); });
    A.$('#g-monthly-exact').addEventListener('input', e => { A.$('#g-monthly').value = e.target.value; update(); });
    const pick = e => {
      const b = e.target.closest('[data-cagr]');
      if (!b) return;
      A.$('#g-cagr').value = b.dataset.cagr;
      update();
    };
    A.$('.goal-presets').addEventListener('click', pick);
    A.$('#g-out').addEventListener('click', pick);
    const box = A.$('#g-chart');
    drawChart(settings());
    const watcher = new ResizeObserver(() => (box.isConnected ? drawChart(read()) : watcher.disconnect()));
    watcher.observe(box);
  }

  return { page, bind };
}
