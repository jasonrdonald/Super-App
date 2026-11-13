// The data import timeline: one entry each time data comes in, from broker files,
// public market data, retirals and loan statements, or a backup. Entries hold counts
// and dates only, never file names, as those can carry client IDs. The log is part of
// the app backup.

import * as db from './db.js';

let A;
export const initImportLog = helpers => { A = helpers; };

// Oldest entries go once the log passes this, so hourly market loads can't grow it forever.
const MAX_ENTRIES = 2000;

export const IMPORT_CATEGORIES = { broker: 'Broker data', public: 'Public data', retirals: 'Retirals', loans: 'Loans', backup: 'Backups' };

// Adds an entry. `points` is how many data points the load brought in, `dataTo` the
// latest date its data covers (yyyy-mm-dd) when there is one.
export async function logImport({ category, source, what, points = 0, detail = '', dataTo = '', accountId = '' }) {
  if (!A || !IMPORT_CATEGORIES[category]) return null;
  const at = Date.now();
  const entry = { id: A.uid(), at, category, source: String(source).slice(0, 120), what: String(what).slice(0, 120), points: Math.max(0, Math.round(points) || 0), detail: String(detail).slice(0, 400), dataTo, accountId, updatedAt: at };
  A.S.importLog.push(entry);
  try {
    await db.put('importLog', entry);
    const extra = A.S.importLog.length - MAX_ENTRIES;
    if (extra > 0) {
      A.S.importLog.sort((a, b) => a.at - b.at);
      for (const gone of A.S.importLog.splice(0, extra)) await db.del('importLog', gone.id);
    }
  } catch { /* the entry still shows until the app closes */ }
  // Public data loads hourly, so only the user's own loads set off an automatic backup.
  if (category !== 'public') A.markDirty();
  return entry;
}

const isIso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function cleanImportLog(x) {
  if (!x || typeof x.id !== 'string' || !Number.isFinite(x.at) || !IMPORT_CATEGORIES[x.category]) return null;
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: x.id.slice(0, 100), at: x.at, category: x.category,
    source: text(x.source, 120), what: text(x.what, 120),
    points: Number.isFinite(x.points) && x.points >= 0 ? Math.round(x.points) : 0,
    detail: text(x.detail, 400), dataTo: isIso(x.dataTo) ? x.dataTo : '', accountId: text(x.accountId, 100),
    ...(x.estimated ? { estimated: true } : {}),
    updatedAt: Number.isFinite(x.updatedAt) ? x.updatedAt : x.at,
  };
}

// Whole days from a time or a yyyy-mm-dd date to today, by the calendar.
export function daysSince(when) {
  if (!when) return null;
  const d = typeof when === 'string' ? new Date(`${when}T00:00:00`) : new Date(when);
  const today = new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((b - a) / 864e5));
}
