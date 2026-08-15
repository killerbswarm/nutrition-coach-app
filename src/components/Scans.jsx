import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import InBodyResultSheetModal from './InBodyResultSheetModal';
import AdminInBodyUploadModal from './AdminInBodyUploadModal';
import { useAuth } from '../context/AuthContext';

const parseScanDate = (dateVal) => {
  if (!dateVal) return null;
  if (typeof dateVal === 'object' && dateVal.seconds) return new Date(dateVal.seconds * 1000);
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
  const str = String(dateVal).trim();
  if (/^\d{8,14}$/.test(str)) {
    const year = str.substring(0, 4);
    const month = str.substring(4, 6);
    const day = str.substring(6, 8);
    const hour = str.length >= 10 ? str.substring(8, 10) : '12';
    const min = str.length >= 12 ? str.substring(10, 12) : '00';
    const sec = str.length >= 14 ? str.substring(12, 14) : '00';
    const d = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const cleaned = str.replace(/\./g, '-').replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
};

const formatDate = (dateVal) => {
  const d = parseScanDate(dateVal);
  if (!d) return 'Unknown Date';
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

const toTitleCase = (str) => {
  if (!str) return '';
  return String(str).toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const PAGE_SIZE = 50;

export default function Scans({ focusScanId, onFocusConsumed }) {
  const [scans, setScans] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editingScan, setEditingScan] = useState(null);
  const [selectedScan, setSelectedScan] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [editForm, setEditForm] = useState({
    clientName: '', phone: '', weight: '', smm: '', pbf: '', score: '', scanDate: '',
  });
  const { isOwner, currentUserRole } = useAuth();
  const [isAdminUploadOpen, setIsAdminUploadOpen] = useState(false);
  const [clients, setClients] = useState([]);

  useEffect(() => {
  const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
    setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
  return () => unsub();
}, []);

  useEffect(() => {
    const q = query(collection(db, 'inbody_scans'), orderBy('scanDate', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setScans(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => { setPage(0); }, [search]);

  useEffect(() => {
    if (!focusScanId || scans.length === 0) return;
    const idx = scans.findIndex((s) => s.id === focusScanId);
    if (idx >= 0) {
      setSearch('');
      setPage(Math.floor(idx / PAGE_SIZE));
      setHighlightedId(focusScanId);
      setSelectedScan(scans[idx]); // auto-open View Sheet
      setTimeout(() => {
        const el = document.getElementById(`scan-row-${focusScanId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
    if (onFocusConsumed) onFocusConsumed();
    const t = setTimeout(() => setHighlightedId(null), 4000);
    return () => clearTimeout(t);
  }, [focusScanId, scans]);

  const filtered = scans.filter((s) => {
    const term = search.toLowerCase().trim();
    if (!term) return true;
    return (
      (s.clientName || '').toLowerCase().includes(term) ||
      (s.name || '').toLowerCase().includes(term) ||
      (s.phone || '').includes(term) ||
      (s.memberName || '').toLowerCase().includes(term)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageScans = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this scan permanently?')) return;
    try {
      await deleteDoc(doc(db, 'inbody_scans', id));
      if (selectedScan?.id === id) setSelectedScan(null);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const openEdit = (scan) => {
    setEditingScan(scan);
    const d = parseScanDate(scan.scanDate);
    setEditForm({
      clientName: scan.clientName || scan.name || '',
      phone: scan.phone || '',
      weight: scan.weight || '',
      smm: scan.smm || '',
      pbf: scan.pbf || '',
      score: scan.score || '',
      scanDate: d ? d.toISOString().slice(0, 16) : '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingScan) return;
    try {
      const payload = {
        clientName: editForm.clientName.trim(),
        name: editForm.clientName.trim(),
        phone: editForm.phone.trim(),
        weight: parseFloat(editForm.weight) || 0,
        smm: parseFloat(editForm.smm) || 0,
        pbf: parseFloat(editForm.pbf) || 0,
        score: parseFloat(editForm.score) || 0,
        updatedAt: new Date(),
      };
      if (editForm.scanDate) payload.scanDate = new Date(editForm.scanDate).toISOString();
      await updateDoc(doc(db, 'inbody_scans', editingScan.id), payload);
      setEditingScan(null);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  };
  return (
    <main className="flex-1 overflow-y-auto bg-slate-950 p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-black text-white">All Scans</h2>
          <p className="text-xs text-slate-400 mt-1">{scans.length} total scans in database</p>
        </div>
        {(isOwner || currentUserRole === 'Owner') && (
  <button
    type="button"
    onClick={() => setIsAdminUploadOpen(true)}
    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-lg"
  >
    Upload Master CSV
  </button>
)}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone..."
          className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 w-64"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider">
                <th className="text-left px-4 py-3 font-bold">Date</th>
                <th className="text-left px-4 py-3 font-bold">Name</th>
                <th className="text-left px-4 py-3 font-bold">Phone</th>
                <th className="text-right px-4 py-3 font-bold">Weight</th>
                <th className="text-right px-4 py-3 font-bold">SMM</th>
                <th className="text-right px-4 py-3 font-bold">BF%</th>
                <th className="text-right px-4 py-3 font-bold">Score</th>
                <th className="text-right px-4 py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageScans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">No scans found</td>
                </tr>
              ) : (
                pageScans.map((scan) => (
                  <tr
                    key={scan.id}
                    id={`scan-row-${scan.id}`}
                    className={`border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors ${
                      highlightedId === scan.id ? 'bg-blue-600/20 ring-1 ring-blue-500/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{formatDate(scan.scanDate)}</td>
                    <td className="px-4 py-3 font-semibold text-white">{toTitleCase(scan.clientName || scan.name || 'Unknown')}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono">{scan.phone || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{scan.weight > 0 ? scan.weight : '—'}</td>
                    <td className="px-4 py-3 text-right text-blue-400">{scan.smm > 0 ? scan.smm : '—'}</td>
                    <td className="px-4 py-3 text-right text-purple-400">{scan.pbf > 0 ? `${scan.pbf}%` : '—'}</td>
                    <td className="px-4 py-3 text-right text-amber-400">{scan.score > 0 ? scan.score : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setSelectedScan(scan)}
                          className="px-2 py-1 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 font-bold"
                        >
                          View
                        </button>
                        <button
                          onClick={() => openEdit(scan)}
                          className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(scan.id)}
                          className="px-2 py-1 rounded-lg text-red-400 hover:bg-red-500/10 font-bold"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
          <div className="text-xs text-slate-500">
            Showing {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40 hover:bg-slate-700"
            >
              ← Prev
            </button>
            <span className="px-2 py-1.5 text-xs text-slate-400">
              Page {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40 hover:bg-slate-700"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {editingScan && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Edit Scan</h3>
              <button onClick={() => setEditingScan(null)} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 font-medium">Name</label>
                <input type="text" value={editForm.clientName} onChange={(e) => setEditForm({ ...editForm, clientName: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Phone</label>
                <input type="text" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Scan Date</label>
                <input type="datetime-local" value={editForm.scanDate} onChange={(e) => setEditForm({ ...editForm, scanDate: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Weight</label>
                  <input type="number" step="0.1" value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">SMM</label>
                  <input type="number" step="0.1" value={editForm.smm} onChange={(e) => setEditForm({ ...editForm, smm: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">Body Fat %</label>
                  <input type="number" step="0.1" value={editForm.pbf} onChange={(e) => setEditForm({ ...editForm, pbf: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">Score</label>
                  <input type="number" step="0.1" value={editForm.score} onChange={(e) => setEditForm({ ...editForm, score: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditingScan(null)} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">Cancel</button>
              <button onClick={handleSaveEdit} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {selectedScan && (
        <InBodyResultSheetModal
          scan={selectedScan}
          onClose={() => setSelectedScan(null)}
          onDelete={handleDelete}
        />
      )}
      <AdminInBodyUploadModal
  isOpen={isAdminUploadOpen}
  onClose={() => setIsAdminUploadOpen(false)}
  clients={clients}
  onComplete={() => {}}
/>
    </main>
  );
}