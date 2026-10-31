import { icon, googleLogo } from './icons.js';
import * as db from './db.js';
import { renderMarkdown, toggleTask } from './markdown.js';
import * as drive from './drive.js';
import { CONFIG, VERSION } from './config.js';
import { SECTIONS, NOTE_SECTIONS, DEFAULT_SECTION, sectionById, isNoteSection } from './sections.js';
import { cleanPayment, cleanRecord, cleanCategory, cleanType } from './payments.js';
import { PAY_PAGES, initPayments, paymentsView, paymentAction, payRouteValid, attentionNow } from './payments-view.js';

const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const drawer = $('#drawer');
const scrim = $('#scrim');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const S = {
  notebooks: [],
  notes: [],
  payments: [],
  paymentRecords: [],
  paymentCategories: [],
  paymentTypes: [],
  open: new Set(ls.get('open', [])),
  route: null,
  query: '',
  mode: 'edit',
  navigated: false,
  dirty: false,
  installPrompt: null,
};

/* ---------- helpers ---------- */

const nbById = id => S.notebooks.find(n => n.id === id);
const noteById = id => S.notes.find(n => n.id === id);
const sortedNotebooks = () => [...S.notebooks].sort((a, b) => a.createdAt - b.createdAt);
const subsOf = sectionId => sortedNotebooks().filter(nb => nb.sectionId === sectionId);
const nbLabel = nb => `${sectionById(nb.sectionId).name} / ${nb.name}`;
const nameTaken = (sectionId, name, exceptId) => subsOf(sectionId).some(nb => nb.id !== exceptId && nb.name.toLowerCase() === name.toLowerCase());
const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
const clientId = () => CONFIG.googleClientId || ls.get('gClientId', '');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const fmt = (ts, opts) => new Intl.DateTimeFormat(undefined, opts).format(ts);
const ymKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ymDate = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1); };
const monthName = ym => fmt(ymDate(ym), { month: 'long' });
const monthLabel = ym => fmt(ymDate(ym), { month: 'long', year: 'numeric' });
const daysLeft = n => Math.max(0, Math.ceil((n.deletedAt + TRASH_DAYS * DAY - Date.now()) / DAY));

function relDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmt(ts, { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return fmt(ts, { month: 'short', day: 'numeric' });
  return fmt(ts, { year: 'numeric', month: 'short', day: 'numeric' });
}

const plain = md => md
  .replace(/```[\s\S]*?(```|$)/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
  .replace(/[*_~`=|#>]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const fmtBytes = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

/* ---------- UI primitives ---------- */

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.fn(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 3000);
}

// One dialog for prompts, confirms and option sheets. Resolves to the input
// value, true, the chosen option index, or null when dismissed.
function modal({ title, message, input, placeholder, ok = 'OK', cancel = 'Cancel', danger, options }) {
  const d = $('#modal');
  d.className = 'modal' + (options ? ' sheet' : '');
  d.innerHTML = `<form method="dialog">
    <h2>${esc(title)}</h2>
    ${message ? `<p>${esc(message)}</p>` : ''}
    ${input !== undefined ? `<input name="v" value="${esc(input)}" placeholder="${esc(placeholder || '')}" autocomplete="off" maxlength="80">` : ''}
    ${options ? `<div class="opts">${options.map((o, i) => `<button value="opt${i}" class="opt${o.danger ? ' danger' : ''}${o.current ? ' current' : ''}"${o.disabled ? ' disabled' : ''}>${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span></button>`).join('')}</div>` : ''}
    <div class="actions">
      ${options ? '' : `<button value="ok" class="btn ok ${danger ? 'solid-danger' : 'primary'}">${esc(ok)}</button>`}
      ${cancel ? `<button value="" class="btn ghost">${esc(cancel)}</button>` : ''}
    </div>
  </form>`;
  return new Promise(resolve => {
    d.onclose = () => {
      const v = d.returnValue;
      if (!v) return resolve(null);
      if (v.startsWith('opt')) return resolve(Number(v.slice(3)));
      resolve(input !== undefined ? d.querySelector('input').value : true);
    };
    d.onclick = e => { if (e.target === d) d.close(''); };
    d.returnValue = '';
    d.showModal();
    const inp = d.querySelector('input');
    if (inp) { inp.focus(); inp.select(); }
  });
}
const ask = (title, value = '', placeholder) => modal({ title, input: value, placeholder, ok: 'Save' });
const confirmDlg = (title, message, ok = 'OK', danger = true) => modal({ title, message, ok, danger });
const choose = (title, options) => modal({ title, options });

function openDrawer() { drawer.classList.add('open'); scrim.hidden = false; }
function closeDrawer() { drawer.classList.remove('open'); scrim.hidden = true; }

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function shareOrDownload(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadFile(file);
}

/* ---------- data ---------- */

async function persist(store, obj) {
  try {
    await db.put(store, obj);
    markDirty();
  } catch (e) {
    toast('Could not save: ' + e.message);
  }
}

function newNotebook(name, sectionId = DEFAULT_SECTION) {
  const t = Date.now();
  return { id: uid(), name, sectionId, createdAt: t, updatedAt: t };
}

async function createSubsection(sectionId, name) {
  const nb = newNotebook(name, sectionId);
  S.notebooks.push(nb);
  await persist('notebooks', nb);
  return nb;
}

async function createNote(notebookId) {
  const t = Date.now();
  const n = { id: uid(), notebookId, title: '', body: '', createdAt: t, updatedAt: t, archived: false, deletedAt: null };
  S.notes.push(n);
  await persist('notes', n);
  go(`#/note/${n.id}`);
}

async function updateNote(n, patch) {
  Object.assign(n, patch, { updatedAt: Date.now() });
  await persist('notes', n);
}

async function trashNote(n) {
  await updateNote(n, { deletedAt: Date.now() });
  toast('Moved to trash', { label: 'Undo', fn: () => restoreNote(n) });
}

async function restoreNote(n) {
  const patch = { deletedAt: null };
  if (!nbById(n.notebookId)) patch.notebookId = (sortedNotebooks()[0] ?? await createSubsection(DEFAULT_SECTION, 'General')).id;
  await updateNote(n, patch);
  toast(`Restored to ${nbById(n.notebookId).name}`);
  refresh();
}

async function destroyNote(n) {
  S.notes = S.notes.filter(x => x !== n);
  await db.del('notes', n.id);
  markDirty();
}

async function purgeTrash() {
  const cutoff = Date.now() - TRASH_DAYS * DAY;
  for (const n of S.notes.filter(n => n.deletedAt && n.deletedAt < cutoff)) await destroyNote(n);
}

const snapshot = () => ({
  app: 'superapp-notes',
  version: 1,
  exportedAt: new Date().toISOString(),
  notebooks: S.notebooks,
  notes: S.notes,
  payments: S.payments,
  paymentRecords: S.paymentRecords,
  paymentCategories: S.paymentCategories,
  paymentTypes: S.paymentTypes,
});

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d) => (Number.isFinite(v) ? v : d);

function cleanNotebook(x) {
  if (!x || typeof x.id !== 'string') return null;
  const t = Date.now();
  return {
    id: x.id,
    name: str(x.name, 80) || 'Notebook',
    sectionId: isNoteSection(x.sectionId) ? x.sectionId : DEFAULT_SECTION,
    createdAt: num(x.createdAt, t),
    updatedAt: num(x.updatedAt, t),
  };
}

function cleanNote(x) {
  if (!x || typeof x.id !== 'string') return null;
  const t = Date.now();
  return {
    id: x.id,
    notebookId: str(x.notebookId, 100),
    title: str(x.title, 200),
    body: str(x.body, 5_000_000),
    createdAt: num(x.createdAt, t),
    updatedAt: num(x.updatedAt, t),
    archived: !!x.archived,
    deletedAt: Number.isFinite(x.deletedAt) ? x.deletedAt : null,
  };
}

// Merge a backup into local data. For items that exist on both sides the
// most recently updated version wins; nothing local is deleted.
async function importData(data) {
  if (!data || data.app !== 'superapp-notes' || !Array.isArray(data.notebooks) || !Array.isArray(data.notes)) {
    throw new Error('This file is not a SuperApp backup.');
  }
  let added = 0, updated = 0;
  const merge = (list, item, count) => {
    const cur = list.find(x => x.id === item.id);
    if (!cur) { list.push(item); if (count) added++; return item; }
    if (item.updatedAt > cur.updatedAt) { Object.assign(cur, item); if (count) updated++; return cur; }
    return null;
  };

  const nbChanged = data.notebooks.map(cleanNotebook).filter(Boolean).map(nb => merge(S.notebooks, nb, false)).filter(Boolean);
  const noteChanged = [];
  const cutoff = Date.now() - TRASH_DAYS * DAY;
  let orphanHome = null;
  for (const raw of data.notes) {
    const n = cleanNote(raw);
    if (!n || (n.deletedAt && n.deletedAt < cutoff)) continue;
    if (!nbById(n.notebookId)) {
      if (!orphanHome) { orphanHome = newNotebook('Imported'); S.notebooks.push(orphanHome); nbChanged.push(orphanHome); }
      n.notebookId = orphanHome.id;
    }
    const changed = merge(S.notes, n, true);
    if (changed) noteChanged.push(changed);
  }
  await db.putMany('notebooks', nbChanged);
  await db.putMany('notes', noteChanged);
  for (const [store, clean] of [['paymentCategories', cleanCategory], ['paymentTypes', cleanType], ['payments', cleanPayment], ['paymentRecords', cleanRecord]]) {
    const items = (Array.isArray(data[store]) ? data[store] : []).map(clean).filter(Boolean);
    await db.putMany(store, items.map(x => merge(S[store], x, true)).filter(Boolean));
  }
  await purgeTrash();
  markDirty();
  render();
  return { added, updated };
}

/* ---------- autosave & auto-backup ---------- */

let saveTimer = null, pendingSave = null;

function queueSave(n, patch) {
  Object.assign(n, patch, { updatedAt: Date.now() });
  pendingSave = n;
  setSaved('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}

function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingSave) return;
  const n = pendingSave;
  pendingSave = null;
  persist('notes', n).then(() => setSaved('Saved'));
}

function setSaved(text) {
  const el = $('#saved');
  if (el) el.textContent = text;
}

let backupTimer;
function markDirty() {
  S.dirty = true;
  if (!ls.get('autoBackup', false)) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(autoBackup, 30000);
}

async function autoBackup() {
  if (!S.dirty || !ls.get('autoBackup', false) || !drive.hasToken()) return;
  try {
    await drive.upload(snapshot());
    S.dirty = false;
    ls.set('lastBackup', Date.now());
  } catch { /* retried on the next change */ }
}

/* ---------- routing ---------- */

function parseRoute(hash) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!p.length) return { name: 'home' };
  if (p[0] === 's' && p[1] === 'payments') return { name: 'payments', section: p[1], page: p[2] || 'dashboard', id: p[3] };
  if (p[0] === 's' && p[1]) return { name: 'section', section: p[1] };
  if (p[0] === 'nb' && p[1]) {
    if (p[2] === 'archive') return { name: 'archive', nb: p[1] };
    if (p[2] === 'm' && /^\d{4}-\d{2}$/.test(p[3] || '')) return { name: 'month', nb: p[1], month: p[3] };
    return { name: 'notebook', nb: p[1] };
  }
  if (p[0] === 'note' && p[1]) return { name: 'note', id: p[1] };
  if (p[0] === 'trash') return { name: 'trash' };
  if (p[0] === 'settings') return { name: 'settings' };
  return null;
}

const routeValid = r => !!r && (!r.section || !!sectionById(r.section)) && (!r.nb || !!nbById(r.nb)) && (r.name !== 'note' || !!noteById(r.id)) && (r.name !== 'payments' || payRouteValid(r));

function go(hash, replace = false) {
  if (replace) location.replace(hash);
  else location.hash = hash;
}

const defaultHash = () => '#/';

// The section a route belongs to, or undefined for the main page, trash and settings.
function routeSection(r) {
  if (r?.section) return sectionById(r.section);
  const nb = r?.nb ? nbById(r.nb) : r?.name === 'note' ? nbById(noteById(r.id)?.notebookId) : null;
  return sectionById(nb?.sectionId);
}

function listHashFor(n) {
  if (!n || n.deletedAt) return '#/trash';
  return n.archived ? `#/nb/${n.notebookId}/archive` : `#/nb/${n.notebookId}`;
}

function goBack() {
  if (S.navigated) history.back();
  else go(S.route?.name === 'note' ? listHashFor(noteById(S.route.id)) : defaultHash(), true);
}

function leaveNote() {
  if (S.route?.name !== 'note') return;
  flushSave();
  const n = noteById(S.route.id);
  if (n && !n.deletedAt && !n.title.trim() && !n.body.trim()) destroyNote(n);
}

function onRoute() {
  leaveNote();
  const r = parseRoute(location.hash);
  if (!routeValid(r)) return go(defaultHash(), true);
  if (S.route) S.navigated = true;
  S.route = r;
  S.query = '';
  if (r.nb && !S.open.has('nb:' + r.nb)) { S.open.add('nb:' + r.nb); ls.set('open', [...S.open]); }
  if (r.name === 'note') {
    const n = noteById(r.id);
    S.mode = n.deletedAt || n.body.trim() ? 'preview' : 'edit';
  }
  closeDrawer();
  render();
}

/* ---------- rendering ---------- */

function render() {
  applyTheme();
  renderDrawer();
  renderView();
}

// Re-render after a data change without rebuilding an open editor.
function refresh() {
  renderDrawer();
  if (S.route?.name !== 'note') renderView();
}

function renderView() {
  const r = S.route;
  if (r.name === 'note') noteView(noteById(r.id));
  else if (r.name === 'home') homeView();
  else if (r.name === 'section') sectionView(sectionById(r.section));
  else if (r.name === 'payments') paymentsView(r);
  else if (r.name === 'settings') settingsView();
  else listView(r);
}

// Only the current section's sub-sections appear here; the main page is how
// you get to everything else.
function renderDrawer() {
  const r = S.route || {};
  const sec = routeSection(r);
  const thisYear = String(new Date().getFullYear());
  const trashCount = S.notes.filter(n => n.deletedAt).length;
  const row = (current, inner) => `<div class="row${current ? ' current' : ''}">${inner}</div>`;
  let tree = '';

  for (const nb of sec ? subsOf(sec.id) : []) {
    const notes = S.notes.filter(n => n.notebookId === nb.id && !n.deletedAt);
    const active = notes.filter(n => !n.archived);
    const archived = notes.length - active.length;
    const open = S.open.has('nb:' + nb.id);
    tree += `<li>${row(r.name === 'notebook' && r.nb === nb.id, `
      <button class="twisty" data-toggle="nb:${nb.id}" aria-expanded="${open}" aria-label="Show months">${icon('chevron')}</button>
      <a class="label" href="#/nb/${nb.id}">${icon('book')}<span>${esc(nb.name)}</span></a>
      <span class="count">${active.length || ''}</span>
      <button class="icon-btn sm" data-act="nb-menu" data-id="${nb.id}" aria-label="Sub-section options">${icon('dots')}</button>`)}`;

    if (open) {
      const years = {};
      for (const n of active) {
        const ym = ymKey(n.createdAt), y = ym.slice(0, 4);
        years[y] ??= {};
        years[y][ym] = (years[y][ym] || 0) + 1;
      }
      tree += '<ul>';
      for (const y of Object.keys(years).sort().reverse()) {
        // The current year is expanded by default; the stored key flips that.
        const key = `y:${nb.id}:${y}`;
        const yOpen = S.open.has(key) !== (y === thisYear);
        const months = years[y];
        const total = Object.values(months).reduce((a, b) => a + b, 0);
        tree += `<li>${row(false, `
          <button class="twisty" data-toggle="${key}" aria-expanded="${yOpen}" aria-label="Show months of ${y}">${icon('chevron')}</button>
          <button class="label plain" data-toggle="${key}">${icon('calendar')}<span>${y}</span></button>
          <span class="count">${total}</span>`)}`;
        if (yOpen) {
          tree += '<ul>';
          for (const ym of Object.keys(months).sort().reverse()) {
            tree += `<li>${row(r.name === 'month' && r.nb === nb.id && r.month === ym, `
              <span class="twisty-spacer"></span>
              <a class="label" href="#/nb/${nb.id}/m/${ym}"><span>${monthName(ym)}</span></a>
              <span class="count">${months[ym]}</span>`)}</li>`;
          }
          tree += '</ul>';
        }
        tree += '</li>';
      }
      tree += `<li>${row(r.name === 'archive' && r.nb === nb.id, `
        <span class="twisty-spacer"></span>
        <a class="label" href="#/nb/${nb.id}/archive">${icon('archive')}<span>Archive</span></a>
        <span class="count">${archived || ''}</span>`)}</li></ul>`;
    }
    tree += '</li>';
  }

  const payPage = ['add', 'edit', 'p'].includes(r.page) ? 'manage' : r.page;
  const nav = sec?.app
    ? `<div class="section-label"><span>${esc(sec.name)}</span></div>
      <ul class="tree">${PAY_PAGES.map(p => `<li>${row(payPage === p.id, `<a class="label" href="${p.href}">${icon(p.icon)}<span>${p.name}</span></a>`)}</li>`).join('')}</ul>`
    : sec
    ? `${row(r.name === 'section', `
        <a class="label" href="#/s/${sec.id}">${icon(sec.icon)}<span>${esc(sec.name)}</span></a>
        <button class="icon-btn sm" data-act="new-notebook" data-id="${sec.id}" aria-label="New sub-section">${icon('plus')}</button>`)}
      <ul class="tree">${tree}</ul>`
    : `<div class="section-label"><span>Sections</span></div>
      <ul class="tree">${SECTIONS.map(s => `<li>${row(false, `<a class="label" href="#/s/${s.id}">${icon(s.icon)}<span>${esc(s.name)}</span></a>`)}</li>`).join('')}</ul>`;

  drawer.innerHTML = `
    <div class="drawer-head"><span class="brand-mark">${icon('edit')}</span><span>SuperApp</span></div>
    <div class="drawer-scroll">
      ${row(r.name === 'home', `<a class="label" href="#/">${icon('home')}<span>All sections</span></a>`)}
      ${nav}
    </div>
    <div class="drawer-foot">
      ${row(r.name === 'trash', `<a class="label" href="#/trash">${icon('trash')}<span>Trash</span></a><span class="count">${trashCount || ''}</span>`)}
      ${row(r.name === 'settings', `<a class="label" href="#/settings">${icon('settings')}<span>Settings &amp; backup</span></a>`)}
    </div>`;
}

const menuButton = `<button class="icon-btn menu-btn" data-act="drawer" aria-label="Open navigation">${icon('menu')}</button>`;
const upButton = href => `<a class="icon-btn" href="${href}" aria-label="Back">${icon('back')}</a>`;

function homeView() {
  const countIn = sectionId => {
    const ids = new Set(subsOf(sectionId).map(nb => nb.id));
    return S.notes.filter(n => ids.has(n.notebookId) && !n.deletedAt && !n.archived).length;
  };
  // Reminders can only show while the app is open: there is no server to push them.
  const dues = attentionNow();
  const tileCount = s => {
    if (s.app) return dues.length ? `${dues.length} to pay` : '';
    const k = countIn(s.id);
    return k ? plural(k, 'note') : '';
  };
  view.innerHTML = `
    <header class="topbar">
      <div class="titles"><h1>SuperApp</h1><p>Choose a section</p></div>
      ${menuButton}
    </header>
    ${dues.length ? `<div class="banner">${icon('card')}<span>${dues.length === 1 ? `${esc(dues[0].payment.name)} needs paying` : `${dues.length} payments need paying`}</span><a class="btn sm" href="#/s/payments">View</a></div>` : ''}
    <div class="scroll"><nav class="home" aria-label="Sections">${SECTIONS.map(s => `<a class="tile" href="#/s/${s.id}" style="--tile:${s.light}">
        <span class="tile-icon">${icon(s.icon)}</span>
        <span class="tile-name">${esc(s.name)}</span>
        <span class="tile-count">${tileCount(s)}</span>
      </a>`).join('')}</nav></div>`;
}

function subRow(nb) {
  const notes = S.notes.filter(n => n.notebookId === nb.id && !n.deletedAt);
  const archived = notes.filter(n => n.archived).length;
  const active = notes.length - archived;
  const meta = [active ? plural(active, 'note') : 'No notes yet', archived ? `${archived} archived` : ''].filter(Boolean).join(', ');
  return `<div class="sub">
    <a class="sub-main" href="#/nb/${nb.id}">
      <span class="sub-icon">${icon('book')}</span>
      <span class="sub-text"><span class="card-title">${esc(nb.name)}</span><span class="card-meta">${meta}</span></span>
    </a>
    <button class="icon-btn" data-act="new-note" data-id="${nb.id}" aria-label="New note in ${esc(nb.name)}">${icon('plus')}</button>
    <button class="icon-btn" data-act="nb-menu" data-id="${nb.id}" aria-label="${esc(nb.name)} options">${icon('dots')}</button>
  </div>`;
}

function sectionView(sec) {
  const subs = subsOf(sec.id);
  const ids = new Set(subs.map(nb => nb.id));
  const noteCount = S.notes.filter(n => ids.has(n.notebookId) && !n.deletedAt && !n.archived).length;
  const presets = sec.presets.filter(p => !nameTaken(sec.id, p));

  view.innerHTML = `
    <header class="topbar hero">
      ${upButton('#/')}
      <span class="hero-icon">${icon(sec.icon)}</span>
      <div class="titles"><h1>${esc(sec.name)}</h1><p>${plural(subs.length, 'sub-section')}, ${plural(noteCount, 'note')}</p></div>
      ${menuButton}
    </header>
    <div class="scroll"><div class="list section-list">
      ${subs.map(subRow).join('')}
      <div class="add-sub">
        ${icon('plus')}
        <select id="add-sub" aria-label="Add sub-section">
          <option value="" selected hidden>Add sub-section</option>
          ${presets.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
          <option value="custom">Custom sub-section…</option>
        </select>
        ${icon('chevron')}
      </div>
      ${subs.length ? '' : `<div class="empty">${icon(sec.icon)}<p>Add a sub-section to start taking notes in ${esc(sec.name)}.</p></div>`}
    </div></div>`;

  $('#add-sub').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    const preset = opt.value === 'custom' ? undefined : opt.value;
    e.target.value = '';
    addSubsection(sec.id, preset);
  });
}

function listView(r) {
  const nb = r.nb && nbById(r.nb);
  const sec = nb && sectionById(nb.sectionId);
  const title = r.name === 'trash' ? 'Trash' : nb.name;
  const sub = {
    notebook: sec?.name,
    month: monthLabel(r.month || '2000-01'),
    archive: sec?.name,
    trash: `Deleted permanently after ${TRASH_DAYS} days`,
  }[r.name];
  const canCreate = r.name === 'notebook' || r.name === 'month';
  const showEmpty = r.name === 'trash' && S.notes.some(n => n.deletedAt);
  const up = !nb ? '#/' : r.name === 'month' ? `#/nb/${nb.id}` : `#/s/${nb.sectionId}`;
  const archived = nb ? S.notes.filter(n => n.notebookId === nb.id && !n.deletedAt && n.archived).length : 0;
  const tabs = r.name === 'notebook' || r.name === 'archive'
    ? `<div class="seg tabs" role="group" aria-label="Notes or archive">
        <a href="#/nb/${nb.id}"${r.name === 'notebook' ? ' aria-current="page"' : ''}>${icon('file')}<span>Notes</span></a>
        <a href="#/nb/${nb.id}/archive"${r.name === 'archive' ? ' aria-current="page"' : ''}>${icon('archive')}<span>Archive${archived ? ` (${archived})` : ''}</span></a>
      </div>`
    : '';

  view.innerHTML = `
    <header class="topbar">
      ${upButton(up)}
      <div class="titles"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
      ${showEmpty ? '<button class="btn sm danger" data-act="empty-trash">Empty trash</button>' : ''}
      ${nb ? `<button class="icon-btn" data-act="nb-menu" data-id="${nb.id}" aria-label="Sub-section options">${icon('more')}</button>` : ''}
      ${menuButton}
    </header>
    ${tabs}
    <label class="search">${icon('search')}<input type="search" id="q" placeholder="Search notes" value="${esc(S.query)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="scroll"><div class="list" id="list"></div></div>
    ${canCreate ? `<button class="fab" data-act="new-note" aria-label="New note">${icon('plus')}</button>` : ''}`;

  $('#q').addEventListener('input', e => { S.query = e.target.value; renderList(); });
  renderList();
}

function scopeNotes(r) {
  if (r.name === 'trash') return S.notes.filter(n => n.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  let list = S.notes.filter(n => n.notebookId === r.nb && !n.deletedAt && n.archived === (r.name === 'archive'));
  if (r.name === 'month') list = list.filter(n => ymKey(n.createdAt) === r.month);
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderList() {
  const r = S.route;
  const q = S.query.trim().toLowerCase();
  let notes = scopeNotes(r);
  if (q) notes = notes.filter(n => `${n.title}\n${n.body}`.toLowerCase().includes(q));
  $('#list').innerHTML = notes.length ? notes.map(n => card(n, r)).join('') : emptyState(r, q);
}

function card(n, r) {
  const snip = plain(n.body).slice(0, 180);
  const nb = nbById(n.notebookId);
  const meta = r.name === 'trash'
    ? `${esc(nb ? nbLabel(nb) : 'Deleted sub-section')} · ${daysLeft(n)} days left`
    : `Edited ${relDate(n.updatedAt)}`;
  return `<a class="card" href="#/note/${n.id}">
    <div class="card-title">${esc(n.title.trim() || 'Untitled')}</div>
    ${snip ? `<div class="card-snip">${esc(snip)}</div>` : ''}
    <div class="card-meta">${meta}</div>
  </a>`;
}

function emptyState(r, q) {
  if (q) return `<div class="empty">${icon('search')}<p>No notes match “${esc(q)}”.</p></div>`;
  const [ic, msg] = {
    notebook: ['file', 'No notes yet. Tap + to write your first one.'],
    month: ['calendar', 'No notes from this month.'],
    archive: ['archive', 'Archived notes will appear here.'],
    trash: ['trash', 'Trash is empty.'],
  }[r.name];
  return `<div class="empty">${icon(ic)}<p>${msg}</p></div>`;
}

const TOOLS = [
  ['bold', '<b>B</b>', 'Bold'],
  ['italic', '<i>I</i>', 'Italic'],
  ['strike', '<s>S</s>', 'Strikethrough'],
  ['heading', 'H', 'Heading'],
  ['ul', icon('list'), 'Bulleted list'],
  ['ol', '1.', 'Numbered list'],
  ['task', icon('checkbox'), 'Checklist'],
  ['quote', icon('quote'), 'Quote'],
  ['code', icon('code'), 'Inline code'],
  ['codeblock', '{ }', 'Code block'],
  ['link', icon('link'), 'Link'],
  ['hr', '—', 'Divider'],
  ['outdent', icon('outdent'), 'Outdent'],
  ['indent', icon('indent'), 'Indent'],
];

function noteView(n) {
  const nb = nbById(n.notebookId);
  const trashed = !!n.deletedAt;
  const ro = trashed ? ' readonly' : '';
  const banner = trashed
    ? `<div class="banner">${icon('trash')}<span>In trash · deleted permanently in ${daysLeft(n)} days</span><button class="btn sm" data-act="restore">Restore</button></div>`
    : n.archived
      ? `<div class="banner">${icon('archive')}<span>This note is archived</span><button class="btn sm" data-act="unarchive">Unarchive</button></div>`
      : '';

  view.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>
      <div class="seg" role="group" aria-label="Mode">
        <button data-mode="edit"${trashed ? ' disabled' : ''}>${icon('edit')}<span>Edit</span></button>
        <button data-mode="preview">${icon('eye')}<span>Preview</span></button>
      </div>
      <button class="icon-btn" data-act="note-menu" aria-label="Note actions">${icon('more')}</button>
    </header>
    ${banner}
    <div class="note">
      <input class="note-title" id="title" placeholder="Title" maxlength="200" value="${esc(n.title)}" enterkeyhint="next"${ro}>
      <div class="note-meta">
        ${nb ? `<a href="#/nb/${nb.id}">${icon('book')}${esc(nbLabel(nb))}</a>` : '<span>Deleted sub-section</span>'}
        <span>·</span><span>${fmt(n.createdAt, { dateStyle: 'medium' })}</span>
        <span class="saved" id="saved"></span>
      </div>
      <div class="toolbar" id="toolbar" role="toolbar" aria-label="Formatting">
        ${TOOLS.map(([k, label, name]) => `<button class="tool" data-tool="${k}" aria-label="${name}" title="${name}">${label}</button>`).join('')}
      </div>
      <textarea id="body" class="note-body" placeholder="Start writing… Markdown works too." spellcheck="true"${ro}></textarea>
      <article id="preview" class="md preview-pane"></article>
    </div>`;

  const title = $('#title'), body = $('#body'), preview = $('#preview'), bar = $('#toolbar');
  body.value = n.body;

  const renderPreview = () => {
    preview.innerHTML = body.value.trim()
      ? renderMarkdown(body.value, { readonly: trashed })
      : '<p class="md-empty">Nothing written yet. Double-tap to start.</p>';
  };
  const setMode = m => {
    S.mode = m;
    view.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    bar.hidden = body.hidden = m !== 'edit';
    preview.hidden = m === 'edit';
    if (m === 'preview') renderPreview();
  };

  view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  if (!trashed) {
    title.addEventListener('input', () => queueSave(n, { title: title.value }));
    title.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      setMode('edit');
      body.focus();
    });
    body.addEventListener('input', () => queueSave(n, { body: body.value }));
    body.addEventListener('beforeinput', e => continueList(e, body));
    // Keep the textarea focused (and the keyboard open) while tapping tools.
    bar.addEventListener('pointerdown', e => { if (e.target.closest('.tool')) e.preventDefault(); });
    bar.addEventListener('click', e => {
      const t = e.target.closest('.tool');
      if (t) format(body, t.dataset.tool);
    });
    preview.addEventListener('dblclick', e => {
      if (e.target.closest('a, input')) return;
      setMode('edit');
      body.focus();
    });
    preview.addEventListener('change', e => {
      const cb = e.target.closest('input[data-task]');
      if (!cb) return;
      body.value = toggleTask(body.value, Number(cb.dataset.task));
      queueSave(n, { body: body.value });
      flushSave();
      renderPreview();
    });
  }

  setMode(S.mode);
  if (S.mode === 'edit' && !n.title && !n.body) title.focus();
}

/* ---------- editor formatting ---------- */

// Replace [a, b) with text. execCommand keeps the native undo stack working.
function edit(ta, a, b, text, selA, selB = selA) {
  ta.focus();
  ta.setSelectionRange(a, b);
  const ok = document.execCommand?.(text ? 'insertText' : 'delete', false, text);
  if (!ok) {
    ta.setRangeText(text, a, b, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.setSelectionRange(selA, selB);
}

const LINE_MARK = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

function format(ta, kind) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e);

  const wrap = (l, r = l, placeholder = 'text') => {
    if (v.slice(s - l.length, s) === l && v.slice(e, e + r.length) === r) {
      return edit(ta, s - l.length, e + r.length, sel, s - l.length, e - l.length);
    }
    const t = sel || placeholder;
    edit(ta, s, e, l + t + r, s + l.length, s + l.length + t.length);
  };

  const lineStart = s > 0 ? v.lastIndexOf('\n', s - 1) + 1 : 0;
  let lineEnd = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
  if (lineEnd < 0) lineEnd = v.length;
  const lines = v.slice(lineStart, lineEnd).split('\n');

  const setLines = out => {
    const t = out.join('\n');
    if (s === e && lines.length === 1) {
      const pos = Math.max(lineStart, s + t.length - (lineEnd - lineStart));
      return edit(ta, lineStart, lineEnd, t, pos);
    }
    edit(ta, lineStart, lineEnd, t, lineStart, lineStart + t.length);
  };

  // Toggle a line prefix; switching list types replaces the old marker.
  const prefix = (test, make) => {
    const filled = lines.filter(l => l.trim());
    const on = filled.length > 0 && filled.every(l => test.test(l));
    let k = 0;
    setLines(lines.map(l => {
      if (!l.trim() && lines.length > 1) return l;
      const indent = l.match(/^\s*/)[0];
      const rest = l.replace(LINE_MARK, '$1').slice(indent.length);
      return on ? indent + rest : indent + make(k++) + rest;
    }));
  };

  const nl = s > 0 && v[s - 1] !== '\n' ? '\n' : '';

  switch (kind) {
    case 'bold': return wrap('**');
    case 'italic': return wrap('_');
    case 'strike': return wrap('~~');
    case 'code': return wrap('`', '`', 'code');
    case 'heading':
      return setLines(lines.map(l => {
        const level = (l.match(/^(#{1,6})\s/)?.[1] || '').length;
        const rest = l.replace(/^#{1,6}\s+/, '');
        return level >= 3 ? rest : '#'.repeat(level + 1) + ' ' + rest;
      }));
    case 'ul': return prefix(/^\s*[-*+]\s+(?!\[[ xX]\])/, () => '- ');
    case 'ol': return prefix(/^\s*\d+[.)]\s+/, k => `${k + 1}. `);
    case 'task': return prefix(/^\s*[-*+]\s+\[[ xX]\]/, () => '- [ ] ');
    case 'quote': return prefix(/^\s*>/, () => '> ');
    case 'indent': return setLines(lines.map(l => '  ' + l));
    case 'outdent': return setLines(lines.map(l => l.replace(/^(?: {1,2}|\t)/, '')));
    case 'codeblock': {
      const t = sel || 'code';
      const a = s + nl.length + 4;
      return edit(ta, s, e, `${nl}\`\`\`\n${t}\n\`\`\`\n`, a, a + t.length);
    }
    case 'link': {
      if (/^https?:\/\/\S+$/.test(sel)) return edit(ta, s, e, `[link](${sel})`, s + 1, s + 5);
      const t = sel || 'link';
      const a = s + t.length + 3;
      return edit(ta, s, e, `[${t}](https://)`, a, a + 8);
    }
    case 'hr': {
      const t = `${nl}\n---\n\n`;
      return edit(ta, s, e, t, s + t.length);
    }
  }
}

// Pressing Enter on a list or quote line continues it; on an empty item it ends it.
function continueList(e, ta) {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  const { selectionStart: s, selectionEnd: end, value: v } = ta;
  if (s !== end) return;
  const lineStart = s > 0 ? v.lastIndexOf('\n', s - 1) + 1 : 0;
  const line = v.slice(lineStart, s);
  const m = line.match(/^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/);
  const q = !m && line.match(/^(\s*>\s?)(.*)$/);
  if (!m && !q) return;
  e.preventDefault();
  const content = m ? m[7] : q[2];
  if (!content.trim()) return edit(ta, lineStart, s, '', lineStart);
  const marker = m ? m[1] + (m[2] || `${Number(m[3]) + 1}${m[4]}`) + m[5] + (m[6] ? '[ ] ' : '') : q[1];
  edit(ta, s, s, '\n' + marker, s + 1 + marker.length);
}

/* ---------- menus ---------- */

async function noteMenu(n) {
  flushSave();
  if (n.deletedAt) {
    const k = await choose('Note in trash', [
      { icon: 'restore', label: 'Restore' },
      { icon: 'trash', label: 'Delete forever', danger: true },
    ]);
    if (k === 0) { await restoreNote(n); render(); }
    if (k === 1 && await confirmDlg('Delete forever?', 'This note will be permanently deleted. This cannot be undone.', 'Delete')) {
      await destroyNote(n);
      goBack();
    }
    return;
  }
  const k = await choose(n.title.trim() || 'Untitled', [
    { icon: 'archive', label: n.archived ? 'Unarchive' : 'Archive' },
    { icon: 'folder', label: 'Move to sub-section…' },
    { icon: 'share', label: 'Share or save as Markdown' },
    { icon: 'trash', label: 'Move to trash', danger: true },
  ]);
  if (k === 0) {
    await updateNote(n, { archived: !n.archived });
    toast(n.archived ? 'Archived' : 'Moved out of archive');
    render();
  } else if (k === 1) {
    await moveNote(n);
  } else if (k === 2) {
    const name = (n.title.trim() || 'note').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.md';
    const text = (n.title.trim() ? `# ${n.title.trim()}\n\n` : '') + n.body;
    await shareOrDownload(new File([text], name, { type: 'text/markdown' }), n.title);
  } else if (k === 3) {
    await trashNote(n);
    goBack();
  }
}

async function moveNote(n) {
  const nbs = NOTE_SECTIONS.flatMap(s => subsOf(s.id));
  const k = await choose('Move to sub-section', nbs.map(nb => ({ icon: 'book', label: nbLabel(nb), current: nb.id === n.notebookId })));
  if (k == null || nbs[k].id === n.notebookId) return;
  await updateNote(n, { notebookId: nbs[k].id });
  toast(`Moved to ${nbLabel(nbs[k])}`);
  render();
}

// Without a preset, asks for a custom name.
async function addSubsection(sectionId, preset) {
  const name = (preset ?? await ask('New sub-section', '', 'Sub-section name'))?.trim();
  if (!name) return;
  if (nameTaken(sectionId, name)) return toast(`${name} already exists in ${sectionById(sectionId).name}`);
  await createSubsection(sectionId, name);
  toast(`Added ${name}`);
  refresh();
}

async function notebookMenu(id) {
  const nb = nbById(id);
  const k = await choose(nb.name, [
    { icon: 'edit', label: 'Rename' },
    { icon: 'folder', label: 'Move to section…' },
    { icon: 'trash', label: 'Delete sub-section', danger: true },
  ]);
  if (k === 0) {
    const name = (await ask('Rename sub-section', nb.name))?.trim();
    if (!name) return;
    if (nameTaken(nb.sectionId, name, nb.id)) return toast(`${name} already exists in ${sectionById(nb.sectionId).name}`);
    Object.assign(nb, { name, updatedAt: Date.now() });
    await persist('notebooks', nb);
    render();
  } else if (k === 1) {
    const j = await choose('Move to section', NOTE_SECTIONS.map(s => ({ icon: s.icon, label: s.name, current: s.id === nb.sectionId })));
    if (j == null || NOTE_SECTIONS[j].id === nb.sectionId) return;
    if (nameTaken(NOTE_SECTIONS[j].id, nb.name)) return toast(`${nb.name} already exists in ${NOTE_SECTIONS[j].name}`);
    Object.assign(nb, { sectionId: NOTE_SECTIONS[j].id, updatedAt: Date.now() });
    await persist('notebooks', nb);
    toast(`Moved to ${NOTE_SECTIONS[j].name}`);
    render();
  } else if (k === 2) {
    const notes = S.notes.filter(n => n.notebookId === id && !n.deletedAt);
    const msg = notes.length ? `Its ${notes.length} note${notes.length > 1 ? 's' : ''} will be moved to the trash.` : 'This sub-section is empty.';
    if (!await confirmDlg(`Delete “${nb.name}”?`, msg, 'Delete')) return;
    const t = Date.now();
    notes.forEach(n => Object.assign(n, { deletedAt: t, updatedAt: t }));
    await db.putMany('notes', notes);
    S.notebooks = S.notebooks.filter(x => x !== nb);
    await db.del('notebooks', id);
    markDirty();
    toast('Sub-section deleted');
    const r = S.route;
    if (r.nb === id || (r.name === 'note' && noteById(r.id)?.notebookId === id)) go(`#/s/${nb.sectionId}`, true);
    else render();
  }
}

async function emptyTrash() {
  const trashed = S.notes.filter(n => n.deletedAt);
  if (!trashed.length) return;
  if (!await confirmDlg('Empty trash?', `${trashed.length} note${trashed.length > 1 ? 's' : ''} will be permanently deleted.`, 'Empty trash')) return;
  for (const n of trashed) await destroyNote(n);
  toast('Trash emptied');
  refresh();
}

/* ---------- settings ---------- */

function applyTheme() {
  const t = ls.get('theme', 'system');
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  // Each section recolours the app; the main page, trash and settings stay neutral.
  const sec = routeSection(S.route);
  if (sec) {
    root.dataset.section = sec.id;
    root.style.setProperty('--accent', dark ? sec.dark : sec.light);
    root.style.setProperty('--tile', sec.light);
  } else {
    delete root.dataset.section;
    root.style.removeProperty('--accent');
    root.style.removeProperty('--tile');
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = sec ? sec.light : dark ? '#131416' : '#f5f3ee';
  document.head.append(meta);
}

function driveSection() {
  const cid = clientId();
  const u = drive.user();
  if (!cid) {
    return `<p class="muted">To back up to Google Drive, this app needs a Google OAuth Client ID. See the README for the two-minute setup, then paste it here.</p>
      <div class="field"><input id="cid" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off"><button class="btn" data-act="save-cid">Save</button></div>`;
  }
  if (!u) {
    return `<p class="muted">Sign in with Google to back up your notes to your Drive. The app can only see the backup file it creates.</p>
      <button class="btn google" data-act="g-signin">${googleLogo}<span>Sign in with Google</span></button>
      ${CONFIG.googleClientId ? '' : '<button class="btn ghost sm" data-act="clear-cid">Change Client ID</button>'}`;
  }
  const last = ls.get('lastBackup', 0);
  return `<div class="account">
      ${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc((u.name || u.email || '?')[0])}</span>`}
      <div><strong>${esc(u.name || 'Google account')}</strong><span>${esc(u.email)}</span></div>
    </div>
    <p class="muted">Last Drive backup: ${last ? `${relDate(last)}` : 'never'}</p>
    <div class="btn-row">
      <button class="btn primary" data-act="g-backup">${icon('cloud')}<span>Back up now</span></button>
      <button class="btn" data-act="g-restore">${icon('restore')}<span>Restore</span></button>
    </div>
    <label class="switch"><input type="checkbox" id="auto-backup"${ls.get('autoBackup', false) ? ' checked' : ''}><span>Back up automatically after changes (while signed in this session)</span></label>
    <button class="btn ghost sm" data-act="g-signout">Sign out</button>`;
}

function settingsView() {
  const theme = ls.get('theme', 'system');
  const trashCount = S.notes.filter(n => n.deletedAt).length;
  const canShare = !!navigator.canShare?.({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const install = isStandalone() ? '' : S.installPrompt
    ? `<section><h2>Install</h2><p class="muted">Install the app for offline use and a full-screen experience.</p><button class="btn primary" data-act="install">${icon('install')}<span>Install app</span></button></section>`
    : ios ? `<section><h2>Install</h2><p class="muted">In Safari, tap Share, then “Add to Home Screen” to install this app.</p></section>` : '';

  view.innerHTML = `
    <header class="topbar">${upButton('#/')}<div class="titles"><h1>Settings</h1><p>Appearance, storage and backup</p></div>${menuButton}</header>
    <div class="scroll"><div class="settings">
      ${install}
      <section>
        <h2>Appearance</h2>
        <div class="seg wide" role="group" aria-label="Theme">
          ${['system', 'light', 'dark'].map(t => `<button data-theme-set="${t}" aria-pressed="${t === theme}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
      </section>
      <section>
        <h2>On this device</h2>
        <p class="muted" id="storage-info">Checking storage…</p>
        <div class="btn-row">
          <button class="btn" data-act="export">${icon('download')}<span>Download backup</span></button>
          ${canShare ? `<button class="btn" data-act="share-backup">${icon('share')}<span>Share backup</span></button>` : ''}
          <label class="btn">${icon('upload')}<span>Import backup</span><input type="file" id="import" accept=".json,application/json" hidden></label>
        </div>
        <p class="muted small">Backups are a single .json file with every sub-section, note and payment. Importing merges: newer versions win and nothing is deleted.</p>
      </section>
      <section><h2>Google Drive backup</h2>${driveSection()}</section>
      <section>
        <h2>Trash</h2>
        <p class="muted">Notes in the trash are deleted permanently after ${TRASH_DAYS} days.</p>
        <button class="btn danger" data-act="empty-trash"${trashCount ? '' : ' disabled'}>${icon('trash')}<span>Empty trash (${trashCount})</span></button>
      </section>
      <p class="muted center small">SuperApp v${VERSION}</p>
    </div></div>`;

  view.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => {
    ls.set('theme', b.dataset.themeSet);
    applyTheme();
    settingsView();
  }));
  $('#import').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!await confirmDlg('Import backup?', `Merge “${file.name}” into this device? Newer versions of each item win; nothing is deleted.`, 'Import', false)) return;
      const { added, updated } = await importData(data);
      toast(`Imported: ${added} new, ${updated} updated`);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
  });
  $('#auto-backup')?.addEventListener('change', e => {
    ls.set('autoBackup', e.target.checked);
    if (e.target.checked) markDirty();
  });
  if (clientId()) drive.loadGis().catch(() => {});
  fillStorageInfo();
}

async function fillStorageInfo() {
  const live = S.notes.filter(n => !n.deletedAt).length;
  const parts = [`${plural(live, 'note')} in ${plural(S.notebooks.length, 'sub-section')}`, plural(S.payments.length, 'payment')];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) parts.push(`${fmtBytes(est.usage)} used`);
    const persisted = await navigator.storage?.persisted?.();
    parts.push(persisted
      ? 'Stored persistently on this device.'
      : 'Stored on this device. The browser may clear it if space runs low, so install the app and keep backups.');
  } catch {}
  const el = $('#storage-info');
  if (el) el.textContent = parts.join(' · ');
}

async function driveAction(fn) {
  try {
    await drive.ensureToken(clientId());
    await fn();
  } catch (e) {
    toast(e.message);
  }
  if (S.route.name === 'settings') settingsView();
}

/* ---------- events ---------- */

drawer.addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const k = t.dataset.toggle;
    if (!S.open.delete(k)) S.open.add(k);
    ls.set('open', [...S.open]);
    renderDrawer();
    return;
  }
  const a = e.target.closest('[data-act]');
  if (a?.dataset.act === 'new-notebook') return addSubsection(a.dataset.id);
  if (a?.dataset.act === 'nb-menu') return notebookMenu(a.dataset.id);
  if (e.target.closest('a')) closeDrawer();
});

scrim.addEventListener('click', closeDrawer);

view.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const r = S.route;
  const n = r.name === 'note' ? noteById(r.id) : null;
  if (b.dataset.act.startsWith('pay-')) return paymentAction(b);
  switch (b.dataset.act) {
    case 'drawer': return openDrawer();
    case 'back': return goBack();
    case 'new-note': return createNote(b.dataset.id ?? r.nb);
    case 'nb-menu': return notebookMenu(b.dataset.id);
    case 'note-menu': return noteMenu(n);
    case 'restore': await restoreNote(n); return render();
    case 'unarchive': await updateNote(n, { archived: false }); return render();
    case 'empty-trash': return emptyTrash();
    case 'export': return downloadFile(backupFile());
    case 'share-backup': return shareOrDownload(backupFile(), 'SuperApp backup');
    case 'install':
      S.installPrompt?.prompt();
      S.installPrompt = null;
      return;
    case 'save-cid': {
      const v = $('#cid').value.trim();
      if (!/\.apps\.googleusercontent\.com$/.test(v)) return toast('That does not look like a Google OAuth Client ID.');
      ls.set('gClientId', v);
      return settingsView();
    }
    case 'clear-cid':
      ls.del('gClientId');
      return settingsView();
    case 'g-signin':
      return driveAction(async () => toast(`Signed in as ${drive.user().email}`));
    case 'g-signout':
      drive.signOut();
      return settingsView();
    case 'g-backup':
      return driveAction(async () => {
        await drive.upload(snapshot());
        S.dirty = false;
        ls.set('lastBackup', Date.now());
        toast('Backed up to Google Drive');
      });
    case 'g-restore':
      return driveAction(async () => {
        const res = await drive.download();
        if (!res) return toast('No backup found in your Drive yet.');
        const when = relDate(new Date(res.file.modifiedTime).getTime());
        if (!await confirmDlg('Restore from Drive?', `Merge the Drive backup from ${when} into this device? Newer versions of each item win; nothing is deleted.`, 'Restore', false)) return;
        const { added, updated } = await importData(res.data);
        toast(`Restored: ${added} new, ${updated} updated`);
      });
  }
});

function backupFile() {
  const name = `superapp-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new File([JSON.stringify(snapshot(), null, 2)], name, { type: 'application/json' });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  flushSave();
  autoBackup();
});
window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  S.installPrompt = e;
  if (S.route?.name === 'settings') settingsView();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated', { label: 'Reload', fn: () => location.reload() });
    hadController = true;
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- start ---------- */

async function init() {
  applyTheme();
  initPayments({ S, $, view, esc, uid, fmt, plural, toast, ask, confirmDlg, choose, go, persist, refresh, markDirty, upButton, menuButton });
  try {
    [S.notebooks, S.notes, S.payments, S.paymentRecords, S.paymentCategories, S.paymentTypes] = await Promise.all(
      ['notebooks', 'notes', 'payments', 'paymentRecords', 'paymentCategories', 'paymentTypes'].map(db.all));
  } catch (e) {
    view.innerHTML = `<div class="empty">${icon('file')}<p>Could not open local storage: ${esc(e.message)}</p></div>`;
    return;
  }
  // Notebooks outside a note section become sub-sections of Personal.
  const stray = S.notebooks.filter(nb => !isNoteSection(nb.sectionId));
  if (stray.length) {
    stray.forEach(nb => { nb.sectionId = DEFAULT_SECTION; });
    await db.putMany('notebooks', stray);
  }
  await purgeTrash();
  setInterval(purgeTrash, 60 * 60 * 1000);
  window.addEventListener('hashchange', onRoute);
  onRoute();
  registerSW();
  navigator.storage?.persist?.().catch(() => {});
}

init();
