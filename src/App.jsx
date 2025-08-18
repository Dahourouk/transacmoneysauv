/*
PWA Transaction Prototype (Option A)
Fichier unique: PWA_Transaction_Prototype.jsx
Contenu: React component + IndexedDB wrapper + Service Worker registration instructions

Instructions rapides:
1. Crée une application React (Vite ou create-react-app).
2. Place ce fichier en tant que src/App.jsx (ou adapte).
3. Ajoute `public/service-worker.js` avec le contenu indiqué plus bas.
4. Lancer `npm start`.

Ce prototype stocke les transactions dans IndexedDB (hors-ligne) et propose une synchronisation manuelle.
*/

import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

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
    nom_complet: '',
    id_document: '',
    telephone: '',
    montant: ''
  });
  const [transactions, setTransactions] = useState([]);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [notification, setNotification] = useState(null); // { message, type }
  const [theme, setTheme] = useState('light');
  const [page, setPage] = useState(1);
  const pageSize = 5;

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

  // Load saved theme on mount
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
    const initial = saved === 'dark' || saved === 'light' ? saved : 'light';
    setTheme(initial);
  }, []);

  // Apply theme to <html>
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    }
  }, [theme]);

  // Reset pagination when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  function toggleTheme() {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }

  function showNotification(message, type = 'success', timeoutMs = 3000) {
    setNotification({ message, type });
    if (typeof window !== 'undefined') {
      window.clearTimeout(showNotification._t);
      showNotification._t = window.setTimeout(() => setNotification(null), timeoutMs);
    }
  }

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

  // Format amount with thousand separators
  const formatAmountInput = (value) => {
    // Remove all non-digit characters
    const numericValue = value.replace(/\D/g, '');
    if (numericValue === '') return '';
    
    // Add thousand separators
    return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  // Parse amount from formatted string
  const parseAmount = (formattedAmount) => {
    const numericValue = formattedAmount.replace(/\s/g, '');
    return numericValue === '' ? 0 : parseInt(numericValue, 10);
  };

  async function handleSubmit(e) {
    e.preventDefault();
    // validation minimal
    if (!form.nom_complet || !form.id_document || !form.telephone || !form.montant) {
      showNotification('Remplissez tous les champs requis.', 'warning');
      return;
    }
    
    setIsSubmitting(true);
    const tx = {
      id: uuidv4(),
      type: form.type,
      nom_complet: form.nom_complet,
      id_document: form.id_document,
      telephone: form.telephone,
      montant: parseAmount(form.montant),
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    try {
      await addTransaction(tx);
      setForm({ type: 'deposit', nom_complet: '', id_document: '', telephone: '', montant: '' });
      await loadTransactions();
      if (typeof navigator !== 'undefined' && navigator.onLine) await trySync();
      showNotification('Transaction enregistrée.', 'success');
    } catch (err) {
      console.error(err);
      showNotification('Erreur lors de la sauvegarde locale.', 'danger');
    } finally {
      setIsSubmitting(false);
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
    if (typeof navigator !== 'undefined' && !navigator.onLine) return showNotification('Pas de connexion — impossible de synchroniser.', 'warning');
    await trySync();
    showNotification('Synchronisation terminée (si le serveur a répondu OK).', 'success');
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  function buildExportRows(source) {
    return source.map((t) => ({
      Date: formatDate(t.created_at),
      Type: t.type === 'deposit' ? 'Dépôt' : 'Retrait',
      Client: t.nom_complet,
      'CNIB/Passport': t.id_document,
      Téléphone: t.telephone,
      Montant: t.montant,
      Statut: t.status
    }));
  }

  function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function exportExcel() {
    if (!filteredTransactions.length) return showNotification('Aucune donnée à exporter.', 'warning');
    const rows = buildExportRows(filteredTransactions);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Transactions');
    worksheet.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
    rows.forEach(row => worksheet.addRow(row));

    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${timestamp()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ...existing code...

  function exportPDF() {
    if (!filteredTransactions.length) return showNotification('Aucune donnée à exporter.', 'warning');
    const doc = new jsPDF({ orientation: 'landscape' });
    const head = [[
      'Date',
      'Type',
      'Client',
      'CNIB/Passport',
      'Téléphone',
      'Montant (XOF)',
      'Statut'
    ]];
    const body = filteredTransactions.map((t) => [
      formatDate(t.created_at),
      t.type === 'deposit' ? 'Dépôt' : 'Retrait',
      t.nom_complet,
      t.id_document,
      t.telephone,
      formatCurrency(t.montant),
      t.status
    ]);
    doc.text('Historique des transactions', 14, 12);
    autoTable(doc, { head, body, startY: 16, styles: { fontSize: 8 } });
    doc.save(`transactions-${timestamp()}.pdf`);
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTransactions = normalizedSearch
    ? transactions.filter((t) => {
        const hay = [
          t.nom_complet,
          t.id_document,
          t.telephone,
          t.type,
          t.status,
          formatDate(t.created_at)
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(normalizedSearch);
      })
    : transactions;

  const totalResults = filteredTransactions.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pagedTransactions = filteredTransactions.slice(startIndex, startIndex + pageSize);

  function goToPage(p) {
    const clamped = Math.max(1, Math.min(totalPages, p));
    setPage(clamped);
  }

  function getPageItems() {
    const pages = [];
    const delta = 1;
    const range = [];
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }
    const withDots = [];
    if (totalPages >= 1) withDots.push(1);
    if (currentPage - delta > 2) withDots.push('…');
    withDots.push(...range);
    if (currentPage + delta < totalPages - 1) withDots.push('…');
    if (totalPages > 1) withDots.push(totalPages);
    return withDots;
  }

  const renderTransactionCard = (transaction) => (
    <div key={transaction.id} className="transaction-card">
      <div className="transaction-card-header">
        <span className="transaction-card-type">
          {transaction.type === 'deposit' ? '💰 Dépôt' : '💸 Retrait'}
        </span>
        <span className="transaction-card-amount">
          {formatCurrency(transaction.montant)}
        </span>
      </div>
      
      <div className="transaction-card-info">
        <div className="transaction-card-row">
          <span className="transaction-card-label">Client</span>
          <span className="transaction-card-value">{transaction.nom_complet}</span>
        </div>
        <div className="transaction-card-row">
          <span className="transaction-card-label">Téléphone</span>
          <span className="transaction-card-value">{transaction.telephone}</span>
        </div>
        <div className="transaction-card-row">
          <span className="transaction-card-label">Document</span>
          <span className="transaction-card-value">{transaction.id_document}</span>
        </div>
      </div>
      
      <div className="transaction-card-status">
        <span className="transaction-card-date">{formatDate(transaction.created_at)}</span>
        <span className={`status-badge ${transaction.status}`}>
          {transaction.status === 'pending' ? '⏳' : '✅'} {transaction.status}
        </span>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      <div className="app-content">
        <header className="header">
          <div className="header-content">
            <div>
              <h1>Mobile Money — Enregistrements</h1>
              <div className="header-subtitle">PWA Prototype avec stockage hors-ligne</div>
            </div>
            <div className="status-section">
              <button 
                className="theme-toggle" 
                type="button"
                aria-label="Basculer le thème"
                onClick={toggleTheme}
                title={theme === 'light' ? 'Passer en thème sombre' : 'Passer en thème clair'}
              >
                {theme === 'light' ? '🌙' : '☀️'}
              </button>
              <div className="online-status">
                <div className={`status-indicator ${online ? '' : 'offline'}`}></div>
                <span>{online ? 'En ligne' : 'Hors-ligne'}</span>
              </div>
              <button 
                className="sync-button" 
                onClick={forceSync} 
                disabled={!online || syncing}
              >
                {syncing ? '🔄 Synchronisation...' : '🔄 Forcer sync'}
              </button>
            </div>
          </div>
        </header>

        <main className="main-content">
          <section className="form-section">
            <h2>Nouvelle transaction</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="type">Type de transaction</label>
                <select 
                  id="type"
                  name="type" 
                  value={form.type} 
                  onChange={handleChange} 
                  className="form-select"
                  aria-label="Type de transaction"
                >
                  <option value="deposit">💰 Dépôt</option>
                  <option value="withdrawal">💸 Retrait</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="nom_complet">Nom complet</label>
                <input 
                  id="nom_complet"
                  name="nom_complet" 
                  value={form.nom_complet} 
                  onChange={handleChange} 
                  className="form-input"
                  placeholder="Prénom et nom du client"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="id_document">CNIB / Passport</label>
                <input 
                  id="id_document"
                  name="id_document" 
                  value={form.id_document} 
                  onChange={handleChange} 
                  className="form-input"
                  placeholder="Numéro de document"
                  autoComplete="off"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="telephone">Téléphone</label>
                <input 
                  id="telephone"
                  name="telephone" 
                  value={form.telephone} 
                  onChange={handleChange} 
                  className="form-input"
                  placeholder="Numéro de téléphone"
                  type="tel"
                  autoComplete="tel"
                  required
                />
              </div>

              {/* Champ "Compte receveur" supprimé */}

              <div className="form-group">
                <label className="form-label" htmlFor="montant">Montant (FCFA)</label>
                <input 
                  id="montant"
                  name="montant" 
                  value={form.montant} 
                  onChange={(e) => {
                    const formatted = formatAmountInput(e.target.value);
                    setForm(prev => ({ ...prev, montant: formatted }));
                  }}
                  className="form-input"
                  placeholder="0"
                  inputMode="numeric"
                  aria-describedby="montant-help"
                  required
                />
                <small id="montant-help" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                  Saisissez n'importe quel montant (ex: 50 000)
                </small>
              </div>

              <button 
                type="submit" 
                className="submit-button"
                disabled={isSubmitting}
              >
                {isSubmitting ? '⏳ Enregistrement...' : '✅ Enregistrer la transaction'}
              </button>
            </form>
          </section>

          <section className="transactions-section">
            <h2>Historique des transactions</h2>
            <div className="toolbar">
              <input
                className="form-input toolbar-search"
                placeholder="Rechercher (nom, doc, téléphone, type, statut)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Rechercher dans l'historique"
              />
              <div className="export-buttons" role="group" aria-label="Actions d'export">
                <button type="button" className="btn-export" onClick={exportExcel} aria-label="Exporter en Excel">📊 Export Excel</button>
                {/* Bouton Export CSV supprimé */}
                <button type="button" className="btn-export" onClick={exportPDF} aria-label="Exporter en PDF">🧾 Export PDF</button>
              </div>
            </div>
            <p className="transactions-description">
              Affiche tous les enregistrements locaux. Les statuts possibles : 
              <span className="status-badge pending">pending</span> (en attente) / 
              <span className="status-badge synced">synced</span> (synchronisé).
            </p>
            <div className="sr-only" aria-live="polite">Total transactions: {transactions.length}</div>

            {transactions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <div className="empty-state-text">Aucune transaction enregistrée</div>
                <div className="empty-state-subtext">Commencez par créer votre première transaction</div>
              </div>
            ) : (
              <>
                {/* Desktop table view */}
                <div className="transactions-table-container">
                  <table className="transactions-table" aria-label="Historique des transactions">
                    <caption className="sr-only">Historique des transactions</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Client</th>
                        <th scope="col">CNIB/Passport</th>
                        <th scope="col">Téléphone</th>
                        <th scope="col">Montant</th>
                        <th scope="col">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedTransactions.map((t) => (
                        <tr key={t.id}>
                          <td>{formatDate(t.created_at)}</td>
                          <td>
                            <strong>{t.nom_complet}</strong>
                            <br />
                            <small style={{ color: 'var(--text-secondary)' }}>
                              {t.type === 'deposit' ? '💰 Dépôt' : '💸 Retrait'}
                            </small>
                          </td>
                          <td>
                            <code style={{ 
                              background: 'var(--background)', 
                              padding: '0.25rem 0.5rem', 
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              fontFamily: 'monospace'
                            }}>
                              {t.id_document}
                            </code>
                          </td>
                          <td>{t.telephone}</td>
                          <td style={{ textAlign: 'right', fontWeight: '600' }}>
                            {formatCurrency(t.montant)}
                          </td>
                          <td>
                            <span className={`status-badge ${t.status}`}>
                              {t.status === 'pending' ? '⏳' : '✅'} {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card view */}
                <div className="transactions-mobile">
                  {pagedTransactions.map(renderTransactionCard)}
                </div>
                {totalPages > 1 && (
                  <div className="pagination" role="navigation" aria-label="Pagination des transactions">
                    <div className="pagination-info">
                      {totalResults} résultat(s) • Page {currentPage} / {totalPages}
                    </div>
                    <div className="pagination-controls">
                      <button
                        type="button"
                        className="page-btn"
                        onClick={() => goToPage(currentPage - 1)}
                        disabled={currentPage <= 1}
                        aria-label="Page précédente"
                      >
                        ←
                      </button>
                      {getPageItems().map((item, idx) => (
                        item === '…' ? (
                          <span key={`dots-${idx}`} className="page-ellipsis" aria-hidden>…</span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            className={`page-btn ${item === currentPage ? 'active' : ''}`}
                            onClick={() => goToPage(item)}
                            aria-current={item === currentPage ? 'page' : undefined}
                          >
                            {item}
                          </button>
                        )
                      ))}
                      <button
                        type="button"
                        className="page-btn"
                        onClick={() => goToPage(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        aria-label="Page suivante"
                      >
                        →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </main>

        <footer className="footer">
          <p>
            <strong>Prototype PWA</strong> — Stocke localement dans IndexedDB. 
            Remplace <code>fakeSendToServer</code> par un appel réel à votre API.
          </p>
        </footer>
      </div>
      {notification && (
        <div className={`toast ${notification.type}`} role="status" aria-live="polite">
          {notification.message}
        </div>
      )}
    </div>
  );
}
