/*
MobiLedger
Le registre numérique du mobile money
Fichier unique: MobiLedger.jsx
Contenu: React component + IndexedDB wrapper + Service Worker registration instructions

Instructions rapides:
1. Crée une application React (Vite ou create-react-app).
2. Place ce fichier en tant que src/App.jsx ou mobile_money.jsx (ou adapte).
3. Ajoute `public/service-worker.js` avec le contenu indiqué plus bas.
4. Lancer `npm start`.

Cette application stocke les transactions Mobile Money dans IndexedDB (hors-ligne) et propose une synchronisation manuelle.
*/

import React, { useEffect, useState } from 'react';

/* ---------- Simple IndexedDB helper (no external libs) ---------- */
const DB_NAME = 'mm_transactions_db';
const STORE_NAME = 'transactions';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addTransaction(tx) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txDB = db.transaction(STORE_NAME, 'readwrite');
    const store = txDB.objectStore(STORE_NAME);
    const req = store.add(tx);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllTransactions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txDB = db.transaction(STORE_NAME, 'readonly');
    const store = txDB.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function updateTransaction(id, patch) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txDB = db.transaction(STORE_NAME, 'readwrite');
    const store = txDB.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return reject(new Error('Not found'));
      const updated = { ...record, ...patch };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/* ---------- Utility: generate UUID (simple) ---------- */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ---------- Main App Component ---------- */
export default function App() {
  const [form, setForm] = useState({
    type: 'deposit',
    prenom: '',
    nom: '',
    id_document: '',
    telephone: '',
    montant: ''
  });
  const [transactions, setTransactions] = useState([]);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadTransactions();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // register service worker (optional but recommended)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((err) => {
        console.warn('SW registration failed:', err);
      });
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function loadTransactions() {
    try {
      const all = await getAllTransactions();
      // sort by date desc
      all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setTransactions(all);
    } catch (err) {
      console.error('Failed loading transactions', err);
    }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // validation minimal
    if (!form.prenom || !form.nom || !form.id_document || !form.telephone || !form.montant) {
      alert('Remplissez tous les champs.');
      return;
    }
    const tx = {
      id: uuidv4(),
      type: form.type,
      prenom: form.prenom,
      nom: form.nom,
      id_document: form.id_document,
      telephone: form.telephone,
      montant: parseFloat(form.montant),
      status: 'pending',
      created_at: new Date().toISOString()
    };
    try {
      await addTransaction(tx);
      setForm({ type: 'deposit', prenom: '', nom: '', id_document: '', telephone: '', montant: '' });
      await loadTransactions();
      if (typeof navigator !== 'undefined' && navigator.onLine) await trySync();
    } catch (err) {
      console.error(err);
      alert('Erreur sauvegarde locale');
    }
  }

  /*
    trySync: Tentative simplifiée de synchronisation
    Ici on simule un envoi au serveur. Remplace `fakeSendToServer` par un fetch réel
  */
  async function fakeSendToServer(batch) {
    // simulation: résoud après 800ms
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, syncedIds: batch.map((b) => b.id) }), 800));
  }

  async function trySync() {
    setSyncing(true);
    try {
      // récupérer pending
      const pending = transactions.filter((t) => t.status === 'pending');
      if (pending.length === 0) return;
      // ici: envoi en batch vers l'API
      const res = await fakeSendToServer(pending);
      if (res && res.ok) {
        // marquer comme synced
        await Promise.all(res.syncedIds.map((id) => updateTransaction(id, { status: 'synced', synced_at: new Date().toISOString() })));
        await loadTransactions();
      }
    } catch (err) {
      console.error('Sync error', err);
    } finally {
      setSyncing(false);
    }
  }

  async function forceSync() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return alert('Pas de connexion — impossible de synchroniser.');
    await trySync();
    alert('Synchronisation terminée (si le serveur a répondu OK).');
  }

  return (
    <div style={{ fontFamily: 'system-ui, Arial', padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Mobile Money — Enregistrements (PWA Prototype)</h1>
        <div>
          <strong>{online ? 'En ligne' : 'Hors-ligne'}</strong>
          <button onClick={forceSync} style={{ marginLeft: 12 }} disabled={!online || syncing}>
            {syncing ? 'Synchronisation...' : 'Forcer sync'}
          </button>
        </div>
      </header>

      <section style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <form onSubmit={handleSubmit} style={{ padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2>Nouvelle transaction</h2>
          <label>Type
            <select name="type" value={form.type} onChange={handleChange} style={{ width: '100%', marginTop: 6 }}>
              <option value="deposit">Dépôt</option>
              <option value="withdrawal">Retrait</option>
            </select>
          </label>

          <label>Prénom
            <input name="prenom" value={form.prenom} onChange={handleChange} style={{ width: '100%', marginTop: 6 }} />
          </label>

          <label>Nom
            <input name="nom" value={form.nom} onChange={handleChange} style={{ width: '100%', marginTop: 6 }} />
          </label>

          <label>CNIB / Passport
            <input name="id_document" value={form.id_document} onChange={handleChange} style={{ width: '100%', marginTop: 6 }} />
          </label>

          <label>Téléphone
            <input name="telephone" value={form.telephone} onChange={handleChange} style={{ width: '100%', marginTop: 6 }} />
          </label>

          <label>Montant
            <input name="montant" value={form.montant} onChange={handleChange} type="number" step="0.01" style={{ width: '100%', marginTop: 6 }} />
          </label>

          <div style={{ marginTop: 12 }}>
            <button type="submit">Enregistrer</button>
          </div>
        </form>

        <div style={{ padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2>Historique</h2>
          <p>Affiche les enregistrements locaux. Les statuts possibles : <em>pending</em> / <em>synced</em>.</p>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '6px 4px' }}>Date</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '6px 4px' }}>Nom</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '6px 4px' }}>Tel</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '6px 4px' }}>Montant</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '6px 4px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: '6px 4px' }}>{new Date(t.created_at).toLocaleString()}</td>
                  <td style={{ padding: '6px 4px' }}>{t.prenom} {t.nom}</td>
                  <td style={{ padding: '6px 4px' }}>{t.telephone}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{t.montant}</td>
                  <td style={{ padding: '6px 4px' }}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer style={{ marginTop: 20, color: '#666' }}>
        Prototype PWA — stocke localement dans IndexedDB. Remplace <code>{`fakeSendToServer`}</code> par <code>{`fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) })`}</code> côté serveur.
      </footer>
    </div>
  );
}

/* ---------- service-worker.js (place in public/service-worker.js) ----------
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  clients.claim();
});

// Basic fetch handler: try cache first or network fallback. For prototype we keep it minimal.
self.addEventListener('fetch', (event) => {
  // You can add caching strategies here with Workbox for a production app.
});

*/

/* ---------- Notes / Next steps ----------
- Pour la sync automatique: remplacer `fakeSendToServer` par un appel réel à votre API et gérer les erreurs.
- Pour une meilleure UX et résilience: utiliser Background Sync (Service Worker) et Workbox.
- Chiffrement local: si nécessaire, chiffrer le `montant` ou les identifiants avec Web Crypto avant de stocker.
- Ajoute une route serveur `POST /api/sync/transactions` pour recevoir un tableau JSON de transactions et renvoyer les IDs synchronisés.
*/
