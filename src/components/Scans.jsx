import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';
import { masterDb, ensureMasterAuth } from '../masterFirebase';

const MASTER_SCANS_API = 'https://us-central1-swarm-checkins-5436d.cloudfunctions.net';
import InBodyResultSheetModal from './InBodyResultSheetModal';
import InBodyCompareModal from './InBodyCompareModal';
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
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const toTitleCase = (str) => {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const normalizePhone = (p) => String(p || '').replace(/\D/g, '');
const last10 = (p) => {
  const d = normalizePhone(p);
  return d.length >= 10 ? d.slice(-10) : d;
};

const PAGE_SIZE = 50;

const isPlaceholderName = (name) => {
  const n = String(name || '').trim().toLowerCase();
  return !n || n === 'member' || n === 'unknown' || n === 'unknown client' || n.startsWith('member ');
};

export default function Scans({ focusScanId, onFocusConsumed }) {
  const { currentUser, isOwner, userRole } = useAuth();
  const currentUserRole = isOwner ? 'Owner' : userRole === 'coach' ? 'Coach' : 'User';
  const canManage = isOwner || currentUserRole === 'Owner';

  const [scans, setScans] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editingScan, setEditingScan] = useState(null);
  const [selectedScan, setSelectedScan] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [editForm, setEditForm] = useState({
    clientName: '',
    phone: '',
    weight: '',
    smm: '',
    pbf: '',
    scanDate: '',
  });
  const [isAdminUploadOpen, setIsAdminUploadOpen] = useState(false);
  const [compareScans, setCompareScans] = useState([]); // max 2
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        await ensureMasterAuth();
      } catch (e) {
        console.warn('master auth', e);
      }
      const q = query(collection(masterDb, 'inbody_scans'), orderBy('scanDate', 'desc'));
      unsub = onSnapshot(q, (snap) => {
        setScans(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });
    })();
    return () => unsub();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    if (!focusScanId || scans.length === 0) return;
    const idx = scans.findIndex((s) => s.id === focusScanId);
    if (idx >= 0) {
      setSearch('');
      setPage(Math.floor(idx / PAGE_SIZE));
      setHighlightedId(focusScanId);
      setSelectedScan(scans[idx]);
      setTimeout(() => {
        const el = document.getElementById(`scan-row-${focusScanId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
    if (onFocusConsumed) onFocusConsumed();
    const t = setTimeout(() => setHighlightedId(null), 4000);
    return () => clearTimeout(t);
  }, [focusScanId, scans]);

  // Resolve display name from linked client / local roster by phone
  const enrichedScans = useMemo(() => {
    return scans.map((s) => {
      let displayName = s.clientName || s.name || s.memberName || 'Member';
      let email = s.email || '';
      let clientId = s.clientId || null;

      if (s.clientId) {
        const c = clients.find((x) => x.id === s.clientId);
        if (c) {
          displayName = c.name || displayName;
          email = c.email || email;
        }
      } else if (s.phone) {
        const sp = last10(s.phone);
        const c = clients.find((x) => last10(x.phone) === sp && sp.length >= 7);
        if (c) {
          displayName = c.name || displayName;
          email = c.email || email;
          clientId = c.id;
        }
      }

      return { ...s, displayName, email, resolvedClientId: clientId };
    });
  }, [scans, clients]);

  // Everyone sees all scans; coaches remain view-only via canManage
  const filtered = enrichedScans.filter((s) => {
    const term = search.toLowerCase().trim();
    if (!term) return true;
    const phoneDigits = term.replace(/\D/g, '');
    return (
      (s.displayName || '').toLowerCase().includes(term) ||
      (s.clientName || '').toLowerCase().includes(term) ||
      (s.name || '').toLowerCase().includes(term) ||
      (s.email || '').toLowerCase().includes(term) ||
      (s.phone || '').includes(term) ||
      (phoneDigits.length >= 3 && normalizePhone(s.phone).includes(phoneDigits))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageScans = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleDelete = async (id) => {
    if (!canManage) return;
    if (!window.confirm('Delete this scan permanently?')) return;
    try {
      const res = await fetch(`${MASTER_SCANS_API}/deleteInbodyScan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Delete failed');
      setCompareScans((prev) => prev.filter((s) => s.id !== id));
      if (selectedScan?.id === id) setSelectedScan(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const openEdit = (scan) => {
    if (!canManage) return;
    const d = parseScanDate(scan.scanDate);
    let local = '';
    if (d) {
      const pad = (n) => String(n).padStart(2, '0');
      local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    setEditForm({
      clientName: scan.displayName || scan.clientName || scan.name || '',
      phone: scan.phone || '',
      weight: scan.weight ?? '',
      smm: scan.smm ?? '',
      pbf: scan.pbf ?? '',
      bmi: scan.bmi ?? '',
      scanDate: local,
    });
    setEditingScan(scan);
  };

  const handleSaveEdit = async () => {
    if (!canManage || !editingScan) return;
    try {
      const payload = {
        clientName: editForm.clientName.trim(),
        name: editForm.clientName.trim(),
        phone: editForm.phone.trim(),
        weight: parseFloat(editForm.weight) || 0,
        smm: parseFloat(editForm.smm) || 0,
        pbf: parseFloat(editForm.pbf) || 0,
        bmi: parseFloat(editForm.bmi) || 0,
        updatedAt: new Date(),
      };
      if (editForm.scanDate) payload.scanDate = new Date(editForm.scanDate).toISOString();

      // Link to client by phone if possible
      const sp = last10(editForm.phone);
      if (sp.length >= 7) {
        const match = clients.find((c) => last10(c.phone) === sp);
        if (match) {
          payload.clientId = match.id;
          if (!editForm.clientName.trim() || isPlaceholderName(editForm.clientName)) {
            payload.clientName = match.name;
            payload.name = match.name;
          }
        }
      }

      const res = await fetch(`${MASTER_SCANS_API}/updateInbodyScan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: editingScan.id, updates: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed');
      setEditingScan(null);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  };

  const toggleCompare = (scan) => {
    setCompareScans((prev) => {
      if (prev.find((p) => p.id === scan.id)) return prev.filter((p) => p.id !== scan.id);
      if (prev.length >= 2) return [prev[1], scan];
      return [...prev, scan];
    });
  };

  /** Owner: resolve "Member" via GHL phone search + local clients */
  const resolveNameFromGhl = async (scan) => {
    if (!canManage) return;
    const phone = last10(scan.phone);
    if (phone.length < 7) {
      alert('No phone on this scan to look up.');
      return;
    }
    setResolvingId(scan.id);
    try {
      // 1) Local clients first
      const local = clients.find((c) => last10(c.phone) === phone);
      if (local) {
        const resLocal = await fetch(`${MASTER_SCANS_API}/updateInbodyScan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanId: scan.id,
            updates: {
              clientId: local.id,
              clientName: local.name,
              name: local.name,
            },
          }),
        });
        const dataLocal = await resLocal.json().catch(() => ({}));
        if (!resLocal.ok || dataLocal.error) throw new Error(dataLocal.error || 'Update failed');
        return;
      }

      // 2) GHL search
      const res = await fetch(
        `https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(phone)}`
      );
      const data = await res.json();
      if (!data.success || !Array.isArray(data.contacts) || data.contacts.length === 0) {
        alert('No match found in members for this phone.');
        return;
      }
      const match =
        data.contacts.find((c) => {
          const p = last10(c.phone);
          return p && (p === phone || p.endsWith(phone) || phone.endsWith(p));
        }) || data.contacts[0];

      const name = toTitleCase(match.name || 'Member');
      const res2 = await fetch(`${MASTER_SCANS_API}/updateInbodyScan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanId: scan.id,
          updates: {
            clientName: name,
            name,
            ghlContactId: match.id || '',
          },
        }),
      });
      const data2 = await res2.json().catch(() => ({}));
      if (!res2.ok || data2.error) throw new Error(data2.error || 'Update failed');
    } catch (err) {
      alert('Lookup failed: ' + err.message);
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto bg-slate-950 p-4 md:p-6 space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-black text-white">All Scans</h2>
          <p className="text-xs text-slate-400 mt-1">
            {filtered.length} shown
            {search ? ` (filtered)` : ''}
            {` · ${scans.length} total in database`}
            {!canManage && ' · view only'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsCompareMode((v) => !v);
              if (isCompareMode) {
                setCompareScans([]);
                setShowCompareModal(false);
              }
            }}
            className={`px-3 py-2 font-bold text-xs rounded-xl border ${
              isCompareMode
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
            }`}
          >
            {isCompareMode ? 'Comparing…' : 'Compare'}
          </button>
          {isCompareMode && compareScans.length === 2 && (
            <button
              type="button"
              onClick={() => setShowCompareModal(true)}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl"
            >
              Open comparison
            </button>
          )}
          {isCompareMode && (
            <button
              type="button"
              onClick={() => {
                setCompareScans([]);
                setShowCompareModal(false);
                setIsCompareMode(false);
              }}
              className="px-3 py-2 bg-slate-800 text-slate-300 font-bold text-xs rounded-xl"
            >
              {compareScans.length > 0 ? `Cancel compare (${compareScans.length})` : 'Cancel compare'}
            </button>
          )}
          {canManage && (
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
            placeholder="Filter name, email, or phone…"
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 w-full sm:w-56 md:w-64"
          />
        </div>
      </div>

      {isCompareMode && (
        <div className="text-xs text-blue-200 bg-blue-500/10 border border-blue-500/30 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="font-bold">Compare mode:</span>
          <span>
            {compareScans.length === 0 && 'Check 2 rows (same person works best), then Open comparison.'}
            {compareScans.length === 1 &&
              `Selected: ${compareScans[0].displayName || compareScans[0].clientName || 'Scan'} — select 1 more.`}
            {compareScans.length === 2 &&
              `${compareScans[0].displayName || compareScans[0].clientName || 'A'} vs ${compareScans[1].displayName || compareScans[1].clientName || 'B'}`}
          </span>
          {compareScans.length === 2 && (
            <button
              type="button"
              onClick={() => setShowCompareModal(true)}
              className="ml-auto px-3 py-1 bg-emerald-600 text-white font-bold rounded-lg"
            >
              Open comparison
            </button>
          )}
        </div>
      )}

      <div className="md:hidden space-y-2">
        {pageScans.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-10">No scans match this filter.</div>
        ) : (
          pageScans.map((scan) => {
            const selected = compareScans.some((c) => c.id === scan.id);
            const needsResolve = canManage && isPlaceholderName(scan.displayName || scan.clientName);
            return (
              <div
                key={scan.id}
                id={`scan-row-${scan.id}`}
                className={`bg-slate-900 border rounded-2xl p-3 ${selected ? 'border-blue-500/50' : 'border-slate-800'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">
                      {toTitleCase(scan.displayName || scan.clientName || 'Member')}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{formatDate(scan.scanDate)}</div>
                    <div className="text-[11px] text-slate-500">{scan.phone || '—'}</div>
                  </div>
                  {isCompareMode && (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleCompare(scan)}
                      className="w-4 h-4 accent-blue-500 mt-1"
                    />
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <div>
                    <div className="text-[9px] uppercase text-slate-500">Wt</div>
                    <div className="text-xs font-bold text-white">{scan.weight > 0 ? scan.weight : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-slate-500">SMM</div>
                    <div className="text-xs font-bold text-blue-400">{scan.smm > 0 ? scan.smm : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-slate-500">BF%</div>
                    <div className="text-xs font-bold text-purple-400">{scan.pbf > 0 ? `${scan.pbf}%` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-slate-500">BMI</div>
                    <div className="text-xs font-bold text-amber-400">{scan.bmi > 0 ? scan.bmi : '—'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <button type="button" onClick={() => setSelectedScan(scan)} className="px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-400 font-bold text-[11px]">View</button>
                  {needsResolve && (
                    <button type="button" onClick={() => resolveNameFromGhl(scan)} className="px-2.5 py-1 rounded-lg text-amber-400 font-bold text-[11px]">
                      {resolvingId === scan.id ? 'Looking up…' : 'Find name'}
                    </button>
                  )}
                  {canManage && (
                    <>
                      <button type="button" onClick={() => openEdit(scan)} className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-bold text-[11px]">Edit</button>
                      <button type="button" onClick={() => handleDelete(scan.id)} className="px-2.5 py-1 rounded-lg text-red-400 font-bold text-[11px]">Delete</button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-3 font-bold w-8"></th>
                <th className="text-left px-4 py-3 font-bold">Date</th>
                <th className="text-left px-4 py-3 font-bold">Name</th>
                <th className="text-left px-4 py-3 font-bold">Phone</th>
                <th className="text-right px-4 py-3 font-bold">Weight</th>
                <th className="text-right px-4 py-3 font-bold">SMM</th>
                <th className="text-right px-4 py-3 font-bold">BF%</th>
                <th className="text-right px-4 py-3 font-bold">BMI</th>
                <th className="text-right px-4 py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {pageScans.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    No scans match this filter.
                  </td>
                </tr>
              ) : (
                pageScans.map((scan) => {
                  const selected = compareScans.some((c) => c.id === scan.id);
                  const needsResolve =
                    canManage && isPlaceholderName(scan.displayName || scan.clientName);
                  return (
                    <tr
                      key={scan.id}
                      id={`scan-row-${scan.id}`}
                      className={`hover:bg-slate-800/40 ${
                        highlightedId === scan.id ? 'bg-blue-500/10' : ''
                      } ${selected ? 'bg-blue-600/10' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        {isCompareMode ? (
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleCompare(scan)}
                            title="Select for compare"
                            className="w-4 h-4 accent-blue-500 cursor-pointer"
                          />
                        ) : (
                          <span className="text-slate-700">·</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                        {formatDate(scan.scanDate)}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-white">
                        {toTitleCase(scan.displayName || scan.clientName || 'Member')}
                        {needsResolve && (
                          <button
                            type="button"
                            onClick={() => resolveNameFromGhl(scan)}
                            disabled={resolvingId === scan.id}
                            className="ml-2 text-[10px] font-bold text-amber-400 hover:text-amber-300"
                          >
                            {resolvingId === scan.id ? 'Looking up…' : 'Find name'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{scan.phone || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-100">
                        {scan.weight > 0 ? scan.weight : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-blue-400">
                        {scan.smm > 0 ? scan.smm : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-purple-400">
                        {scan.pbf > 0 ? `${scan.pbf}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-amber-400 font-bold">
                        {scan.bmi > 0 ? scan.bmi : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectedScan(scan)}
                            className="px-2 py-1 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 font-bold"
                          >
                            View
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(scan)}
                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(scan.id)}
                                className="px-2 py-1 rounded-lg text-red-400 hover:bg-red-500/10 font-bold"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 py-3">
          <div className="text-xs text-slate-500">
            Showing {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="px-2 py-1.5 text-xs text-slate-400">
              Page {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>

      {editingScan && canManage && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Edit Scan</h3>
              <button type="button" onClick={() => setEditingScan(null)} className="text-slate-400 hover:text-white text-xl">
                ×
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 font-medium">Name</label>
                <input
                  type="text"
                  value={editForm.clientName}
                  onChange={(e) => setEditForm({ ...editForm, clientName: e.target.value })}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Phone</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Scan date</label>
                <input
                  type="datetime-local"
                  value={editForm.scanDate}
                  onChange={(e) => setEditForm({ ...editForm, scanDate: e.target.value })}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Weight</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editForm.weight}
                    onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })}
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">SMM</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editForm.smm}
                    onChange={(e) => setEditForm({ ...editForm, smm: e.target.value })}
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">Body Fat %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editForm.pbf}
                    onChange={(e) => setEditForm({ ...editForm, pbf: e.target.value })}
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">BMI</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editForm.bmi || ''}
                    onChange={(e) => setEditForm({ ...editForm, bmi: e.target.value })}
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingScan(null)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedScan && (
        <InBodyResultSheetModal
          scan={selectedScan}
          onClose={() => setSelectedScan(null)}
          onDelete={canManage ? handleDelete : undefined}
          canViewRaw={!!isOwner}
        />
      )}

      {showCompareModal && compareScans.length === 2 && (
        <InBodyCompareModal
          scanA={compareScans[0]}
          scanB={compareScans[1]}
          onClose={() => setShowCompareModal(false)}
        />
      )}

      {canManage && (
        <AdminInBodyUploadModal
          isOpen={isAdminUploadOpen}
          onClose={() => setIsAdminUploadOpen(false)}
          clients={clients}
          onComplete={() => {}}
        />
      )}
    </main>
  );
}