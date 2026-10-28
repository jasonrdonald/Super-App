// Google Drive backup using Google Identity Services (OAuth token flow).
// Scope drive.file only lets the app see files it created itself.

const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email profile';
const FILE_NAME = 'superapp-notes-backup.json';
const API = 'https://www.googleapis.com';

let token = null;
try { token = JSON.parse(sessionStorage.getItem('gToken')); } catch {}

let gisPromise;
export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('Could not reach Google. Are you offline?')); };
    document.head.appendChild(s);
  });
}

export function user() {
  try { return JSON.parse(localStorage.getItem('gUser')); } catch { return null; }
}

export const hasToken = () => !!token && token.exp > Date.now();

export async function signIn(clientId) {
  if (!clientId) throw new Error('Add a Google Client ID in Settings first.');
  await loadGis();
  const known = user();
  const resp = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: resolve,
      error_callback: err => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in was cancelled.' : err?.message || 'Sign-in failed.')),
    });
    client.requestAccessToken({ prompt: known ? '' : 'select_account', login_hint: known?.email });
  });
  if (resp.error) throw new Error(resp.error_description || resp.error);
  token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
  sessionStorage.setItem('gToken', JSON.stringify(token));
  const info = await api('/oauth2/v3/userinfo');
  localStorage.setItem('gUser', JSON.stringify({ email: info.email, name: info.name, picture: info.picture }));
  return user();
}

export async function ensureToken(clientId) {
  if (!hasToken()) await signIn(clientId);
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
  sessionStorage.removeItem('gToken');
  localStorage.removeItem('gUser');
}

async function api(path, { raw, ...opts } = {}) {
  if (!hasToken()) throw new Error('Google session expired. Sign in again.');
  const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token.value}`, ...opts.headers } });
  if (res.status === 401) {
    token = null;
    sessionStorage.removeItem('gToken');
    throw new Error('Google session expired. Sign in again.');
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return raw ? res : res.json();
}

async function findBackup() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await api(`/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime,size)`);
  return r.files?.[0] || null;
}

export async function upload(data) {
  const existing = await findBackup();
  const boundary = 'notes' + Math.random().toString(36).slice(2);
  const meta = existing ? {} : { name: FILE_NAME, mimeType: 'application/json', description: 'SuperApp Notes backup' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const path = existing
    ? `/upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime`
    : '/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';
  return api(path, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function download() {
  const file = await findBackup();
  if (!file) return null;
  const res = await api(`/drive/v3/files/${file.id}?alt=media`, { raw: true });
  return { file, data: await res.json() };
}
