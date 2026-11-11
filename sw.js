// Offline app shell. Bump VERSION when shipping changes so clients update.
const VERSION = 'v1.37.0';
const CACHE = `notes-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/config.js',
  'js/db.js',
  'js/drive.js',
  'js/icons.js',
  'js/markdown.js',
  'js/payments.js',
  'js/payments-view.js',
  'js/portfolio.js',
  'js/portfolio-import.js',
  'js/tickers.js',
  'js/ratings.js',
  'js/disclosures.js',
  'js/portfolio-view.js',
  'js/corporate-actions.js',
  'js/market.js',
  'js/public-data.js',
  'js/format.js',
  'js/pdf-text.js',
  'js/epf.js',
  'js/lic.js',
  'js/nps.js',
  'js/loan.js',
  'js/loans-view.js',
  'js/milestones.js',
  'js/networth-view.js',
  'js/retirals-view.js',
  'js/xlsx.js',
  'js/sections.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('notes-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate for same-origin files; Google APIs go straight to the network.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    const network = fetch(req)
      .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => cached);
    if (cached) { e.waitUntil(network); return cached; }
    return network;
  }));
});
