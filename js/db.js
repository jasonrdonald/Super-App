// IndexedDB storage: notes live on the device, inside the browser's
// persistent storage for this app.

const DB_NAME = 'superapp-notes';
const DB_VERSION = 10;
let dbPromise;

function open() {
  return dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
      }
      for (const store of ['payments', 'paymentRecords', 'paymentCategories', 'paymentTypes', 'brokerAccounts', 'trades', 'brokerHoldings', 'portfolioActions', 'portfolioNotes', 'earnContracts', 'transfers', 'brokerFees', 'retiralAccounts', 'retiralEntries', 'retiralStatements', 'loans']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
      for (const store of ['market', 'priceMonths']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'symbol' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

export const all = store => run(store, 'readonly', s => s.getAll());
export const put = (store, value) => run(store, 'readwrite', s => { s.put(value); });
export const putMany = (store, values) => run(store, 'readwrite', s => { values.forEach(v => s.put(v)); });
export const del = (store, id) => run(store, 'readwrite', s => { s.delete(id); });
export const clear = store => run(store, 'readwrite', s => { s.clear(); });
