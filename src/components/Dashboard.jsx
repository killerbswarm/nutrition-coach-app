import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, deleteDoc, doc, query, orderBy, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import Calendar from './Calendar';
import InBodyResultSheetModal from './InBodyResultSheetModal';
import AdminInBodyUploadModal from './AdminInBodyUploadModal';

// Robust parser that returns a real Date object (or null)
const parseScanDate = (dateVal) => {
  if (!dateVal) return null;

  // Firestore Timestamp
  if (typeof dateVal === 'object' && dateVal.seconds) {
    return new Date(dateVal.seconds * 1000);
  }

  // Already a Date
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    return dateVal;
  }

  const str = String(dateVal).trim();

  // LookinBody style: 20240512143000 or 20240512
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

  // Common formats: 2024.05.12, 2024.05.12 14:30:00, 2024/05/12, ISO, etc.
  const cleaned = str
    .replace(/\./g, '-')          // 2024.05.12 → 2024-05-12
    .replace(/\//g, '-')          // 2024/05/12 → 2024-05-12
    .replace(' ', 'T');           // make it more ISO-like

  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;

  // Last resort
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
};

// Display formatter
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


// =========================================================================
// COMPONENT: INBODY PROGRESS CHART
// =========================================================================
function InBodyProgressChart({ scans }) {
  const [metric, setMetric] = useState('weight'); // 'weight' | 'smm' | 'pbf' | 'score'

  if (!scans || scans.length === 0) return null;

  // Sort scans chronologically (oldest → newest)
  const sortedScans = [...scans].sort((a, b) => {
    const da = parseScanDate(a.scanDate)?.getTime() ?? 0;
    const db = parseScanDate(b.scanDate)?.getTime() ?? 0;
    return da - db;
  });

  if (sortedScans.length < 2) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl mb-6 text-xs text-slate-400 text-center">
        Log at least 2 scans to view progress trends over time.
      </div>
    );
  }

  // Safe number helper
  const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };

  const firstScan = sortedScans[0];
  const latestScan = sortedScans[sortedScans.length - 1];

  const weightDiff = (num(latestScan.weight) - num(firstScan.weight)).toFixed(1);
  const smmDiff = (num(latestScan.smm) - num(firstScan.smm)).toFixed(1);
  const pbfDiff = (num(latestScan.pbf) - num(firstScan.pbf)).toFixed(1);

  const metricConfigs = {
    weight: { label: 'Weight', unit: 'lbs', color: '#3b82f6', getValue: (s) => num(s.weight) },
    smm: { label: 'Muscle (SMM)', unit: 'lbs', color: '#10b981', getValue: (s) => num(s.smm) },
    pbf: { label: 'Body Fat %', unit: '%', color: '#a855f7', getValue: (s) => num(s.pbf) },
    score: { label: 'InBody Score', unit: 'pts', color: '#f59e0b', getValue: (s) => num(s.score) },
  };

  const config = metricConfigs[metric];
  const values = sortedScans.map(config.getValue).filter((v) => v > 0);

  if (values.length < 2) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl mb-6 text-xs text-slate-400 text-center">
        Not enough valid numeric data to draw the chart.
      </div>
    );
  }

  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values) * 1.05;
  const range = maxVal - minVal || 1;

  const width = 700;
  const height = 180;
  const padding = 35;

  const points = sortedScans.map((s, idx) => {
    const v = config.getValue(s);
    const x = padding + (idx / (sortedScans.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - minVal) / range) * (height - padding * 2);
    return { x, y, val: v, date: formatDate(s.scanDate) };
  });

  const pathD = points.reduce((acc, p, idx) => {
    return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, '');

  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl mb-6 space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Progress Trends ({scans.length} Scans)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Tracking body composition changes over time</p>
        </div>

        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          {Object.keys(metricConfigs).map((key) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={`px-3 py-1.5 font-bold rounded-lg transition-all ${
                metric === key ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {metricConfigs[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Weight Change</span>
          <span className={`text-base font-black ${Number(weightDiff) <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {Number(weightDiff) > 0 ? `+${weightDiff}` : weightDiff} lbs
          </span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Muscle (SMM) Change</span>
          <span className={`text-base font-black ${Number(smmDiff) >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {Number(smmDiff) > 0 ? `+${smmDiff}` : smmDiff} lbs
          </span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Body Fat % Change</span>
          <span className={`text-base font-black ${Number(pbfDiff) <= 0 ? 'text-emerald-400' : 'text-purple-400'}`}>
            {Number(pbfDiff) > 0 ? `+${pbfDiff}` : pbfDiff}%
          </span>
        </div>
      </div>

      <div className="relative w-full overflow-x-auto pt-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          <defs>
            <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={config.color} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <path d={areaD} fill={`url(#grad-${metric})`} />
          <path d={pathD} fill="none" stroke={config.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

          {points.map((p, idx) => (
            <g key={idx}>
              <circle
                cx={p.x}
                cy={p.y}
                r="5"
                fill="#0f172a"
                stroke={config.color}
                strokeWidth="2.5"
              />
              <text
                x={p.x}
                y={p.y - 10}
                fill="#e2e8f0"
                fontSize="10"
                fontWeight="bold"
                textAnchor="middle"
              >
                {p.val}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// =========================================================================
// MAIN DASHBOARD COMPONENT
// =========================================================================
export default function Dashboard() {
  const [currentNavView, setCurrentNavView] = useState('clients'); // 'clients' | 'calendar' | 'staff'
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('inbody');
  const [allScans, setAllScans] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);
  const [isAdminUploadOpen, setIsAdminUploadOpen] = useState(false);
  const [isGhlLookupOpen, setIsGhlLookupOpen] = useState(false);
  const [ghlSearchQuery, setGhlSearchQuery] = useState('');
  const [ghlSearchResults, setGhlSearchResults] = useState([]);
  const [isSearchingGhl, setIsSearchingGhl] = useState(false);
  const [ghlData, setGhlData] = useState({ notes: [], appointments: [], messages: [] });
  const [loadingGhl, setLoadingGhl] = useState(false);
  const [outgoingSms, setOutgoingSms] = useState('');
  const [isSendingSms, setIsSendingSms] = useState(false);

  const currentUserRole = 'Owner';

  const staffMembers = [
    { id: '1', name: 'Coach Brian', role: 'Head Coach & Owner', email: 'brian@crossfitswarm.com', assignedClients: 3 },
    { id: '2', name: 'Coach Mary', role: 'Nutrition & Operations', email: 'mary@crossfitswarm.com', assignedClients: 1 },
  ];

  // 1. Subscribe to Clients Collection
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'clients'), (snapshot) => {
      const clientDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClients(clientDocs);
      if (clientDocs.length > 0 && !selectedClient) {
        setSelectedClient(clientDocs[0]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Subscribe to InBody Scans Collection
  useEffect(() => {
    const q = query(collection(db, 'inbody_scans'), orderBy('scanDate', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllScans(docs);
    });
    return () => unsubscribe();
  }, []);

  // 3. Fetch GHL Details on Client Select
  useEffect(() => {
    if (!selectedClient) return;

    const fetchGhlDetails = async () => {
      setLoadingGhl(true);
      try {
        const ghlId =
          selectedClient.ghlContactId ||
          selectedClient.ghlId ||
          selectedClient.ghl ||
          selectedClient.contactId ||
          '';

        const params = new URLSearchParams();
        if (ghlId && ghlId !== 'N/A' && !ghlId.startsWith('dummy')) {
          params.append('contactId', ghlId);
        }
        if (selectedClient.email) params.append('email', selectedClient.email);
        if (selectedClient.phone) params.append('phone', selectedClient.phone);

        const res = await fetch(`https://getghlcontactdetails-mllpdtijza-uc.a.run.app?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setGhlData({
            notes: Array.isArray(data?.notes) ? data.notes : [],
            appointments: Array.isArray(data?.appointments) ? data.appointments : [],
            messages: Array.isArray(data?.messages) ? data.messages : [],
          });
        } else {
          setGhlData({ notes: [], appointments: [], messages: [] });
        }
      } catch (err) {
        console.error('GHL Fetch Error:', err);
        setGhlData({ notes: [], appointments: [], messages: [] });
      } finally {
        setLoadingGhl(false);
      }
    };

    fetchGhlDetails();
  }, [selectedClient]);

  // Member Search Filter
  const filteredClients = clients.filter((c) => {
    const term = clientSearchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      (c.name || '').toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term) ||
      (c.phone || '').includes(term) ||
      (c.ghlContactId || '').toLowerCase().includes(term)
    );
  });

  // GHL Direct Lookup & Import
  const handleSearchGhlContacts = async () => {
    setIsSearchingGhl(true);
    try {
      const res = await fetch(`https://searchghlcontacts-mllpdtijza-uc.a.run.app?query=${encodeURIComponent(ghlSearchQuery.trim())}`);
      const data = await res.json();

      if (data.success) {
        setGhlSearchResults(data.contacts || []);
      } else {
        alert(`GHL Search Error:\n${data.error || 'Request failed'}\n\nDetails: ${JSON.stringify(data.details || {})}`);
        setGhlSearchResults([]);
      }
    } catch (err) {
      console.error('GHL Contact Search Error:', err);
      alert(`Network Error: ${err.message}`);
    } finally {
      setIsSearchingGhl(false);
    }
  };

  const handleImportGhlContact = async (ghlContact) => {
    try {
      const newClientDoc = {
        name: ghlContact.name,
        email: ghlContact.email,
        phone: ghlContact.phone,
        ghlContactId: ghlContact.id,
        coach: 'Coach Brian',
        createdAt: new Date(),
      };
      const docRef = await addDoc(collection(db, 'clients'), newClientDoc);
      setSelectedClient({ id: docRef.id, ...newClientDoc });
      setIsGhlLookupOpen(false);
      setGhlSearchResults([]);
      setGhlSearchQuery('');
    } catch (err) {
      console.error('Import Client Error:', err);
      alert('Failed to import contact: ' + err.message);
    }
  };

  // Filter scans for selected client
  const clientScans = allScans.filter((s) => {
    if (!selectedClient) return false;
    if (s.clientId && s.clientId === selectedClient.id) return true;

    const clientPhone = String(selectedClient.phone || '').replace(/\D/g, '');
    const scanPhone = String(s.phone || '').replace(/\D/g, '');
    return clientPhone && scanPhone && (clientPhone.endsWith(scanPhone) || scanPhone.endsWith(clientPhone));
  });

  // Send SMS
  const handleSendSms = async () => {
    if (!outgoingSms.trim() || !selectedClient) return;

    const ghlId = selectedClient.ghlContactId || selectedClient.ghlId || selectedClient.ghl || selectedClient.contactId;
    if (!ghlId || ghlId === 'N/A' || ghlId.startsWith('dummy')) {
      alert('Cannot send SMS: Selected client does not have a valid GoHighLevel ID.');
      return;
    }

    setIsSendingSms(true);
    try {
      const res = await fetch('https://sendghlsms-mllpdtijza-uc.a.run.app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: ghlId, message: outgoingSms }),
      });

      if (res.ok) {
        setGhlData((prev) => ({
          ...prev,
          messages: [
            { body: outgoingSms, direction: 'outbound', dateAdded: new Date().toISOString() },
            ...prev.messages,
          ],
        }));
        setOutgoingSms('');
      } else {
        alert('Failed to send SMS message via GHL.');
      }
    } catch (err) {
      console.error('Send SMS error:', err);
    } finally {
      setIsSendingSms(false);
    }
  };

  // Delete Scan
  const handleDeleteScan = async (scanId) => {
    if (!window.confirm('Are you sure you want to permanently delete this scan record?')) return;
    try {
      await deleteDoc(doc(db, 'inbody_scans', scanId));
      if (selectedScan?.id === scanId) setSelectedScan(null);
    } catch (err) {
      console.error('Delete Error:', err);
      alert('Failed to delete scan: ' + err.message);
    }
  };

  const currentGhlId =
    selectedClient?.ghlContactId ||
    selectedClient?.ghlId ||
    selectedClient?.ghl ||
    selectedClient?.contactId ||
    'N/A';

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-4 shrink-0">
        <div>
          <div className="flex items-center gap-3 px-2 py-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-black text-white text-lg">
              S
            </div>
            <h1 className="text-lg font-extrabold tracking-wide text-white">Swarm Nutrition</h1>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setCurrentNavView('clients')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                currentNavView === 'clients'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>👥</span> Clients & Chat
            </button>
            <button
              onClick={() => setCurrentNavView('calendar')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                currentNavView === 'calendar'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📅</span> Master Calendar
            </button>
            <button
              onClick={() => setCurrentNavView('staff')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                currentNavView === 'staff'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>👤</span> Manage Staff
            </button>
          </nav>
        </div>

        <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 px-2">
          Logged in as: <span className="font-semibold text-slate-200">{currentUserRole}</span>
        </div>
      </aside>

      {/* VIEW PANEL 1: CLIENTS & CHAT */}
      {currentNavView === 'clients' && (
        <div className="flex flex-1 overflow-hidden">
          {/* CLIENT ROSTER */}
          <section className="w-72 border-r border-slate-800 bg-slate-900/50 flex flex-col">
            <div className="p-4 border-b border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Clients ({clients.length})</h2>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setIsGhlLookupOpen(true)}
                    className="px-2.5 py-1 text-[10px] font-bold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30"
                  >
                    🔍 GHL Lookup
                  </button>
                  <button className="px-2.5 py-1 text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 rounded-lg">
                    ⚙️ Bulk
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={clientSearchTerm}
                onChange={(e) => setClientSearchTerm(e.target.value)}
                placeholder="Search member name, email, phone..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredClients.map((c) => {
                const isSelected = selectedClient?.id === c.id;
                const ghlVal = c.ghlContactId || c.ghlId || c.ghl || c.contactId;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedClient(c)}
                    className={`p-3 rounded-xl cursor-pointer border transition-all ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500/50 text-white shadow-md'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-sm">{c.name}</div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">{c.email || c.phone || 'No Contact Info'}</div>
                    {ghlVal && <div className="text-[10px] font-mono text-blue-400 mt-1">GHL: {ghlVal}</div>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* CLIENT DETAIL AREA */}
          <main className="flex-1 flex flex-col overflow-y-auto bg-slate-950 p-6">
            {selectedClient ? (
              <>
                {/* HEADER */}
                <div className="flex justify-between items-start pb-6 border-b border-slate-800 mb-6">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black text-white">{selectedClient.name}</h2>
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Coach: {selectedClient.coach || 'Coach Brian'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Email: {selectedClient.email || 'N/A'} | Phone: {selectedClient.phone || 'N/A'} | GHL ID: {currentGhlId}
                    </div>
                  </div>

                  {currentUserRole === 'Owner' && (
                    <button
                      onClick={() => setIsAdminUploadOpen(true)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-lg transition-colors flex items-center gap-2"
                    >
                      <span>⚙️</span> Owner Admin: Upload Master CSV
                    </button>
                  )}
                </div>

                {/* TABS */}
                <div className="flex border-b border-slate-800 mb-6 gap-6">
                  <button
                    onClick={() => setActiveTab('inbody')}
                    className={`pb-3 text-sm font-bold transition-colors border-b-2 ${
                      activeTab === 'inbody'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚡ InBody Scans ({clientScans.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('messages')}
                    className={`pb-3 text-sm font-bold transition-colors border-b-2 ${
                      activeTab === 'messages'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    💬 GHL Live SMS ({ghlData.messages.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`pb-3 text-sm font-bold transition-colors border-b-2 ${
                      activeTab === 'notes'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    📝 GHL Notes ({ghlData.notes.length})
                  </button>
                </div>

                {/* TAB 1: INBODY SCANS & PROGRESS CHART */}
                {activeTab === 'inbody' && (
                  <div className="space-y-4">
                    {/* INBODY PROGRESS CHART */}
                    <InBodyProgressChart scans={clientScans} />

                    {clientScans.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
                        <p className="text-sm text-slate-400">No InBody scans logged yet for this client.</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Scans taken on your 270/570 or imported via CSV will automatically appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {clientScans.map((scan) => (
                          <div
                            key={scan.id}
                            className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl shadow-md transition-all flex justify-between items-center"
                          >
                            <div>
                              <div className="text-xs font-semibold text-slate-400">{formatDate(scan.scanDate)}</div>
                              <div className="flex gap-4 mt-2 text-xs">
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase block">Weight</span>
                                  <span className="font-bold text-white text-sm">{scan.weight || 0} lbs</span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase block">Muscle (SMM)</span>
                                  <span className="font-bold text-emerald-400 text-sm">{scan.smm || 0} lbs</span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase block">Body Fat %</span>
                                  <span className="font-bold text-purple-400 text-sm">{scan.pbf || 0}%</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setSelectedScan(scan)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg"
                              >
                                View Sheet
                              </button>
                              <button
                                onClick={() => handleDeleteScan(scan.id)}
                                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                                title="Delete scan"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: GHL LIVE SMS */}
                {activeTab === 'messages' && (
                  <div className="flex flex-col h-[calc(100%-80px)] border border-slate-800 rounded-2xl overflow-hidden bg-slate-900">
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {loadingGhl ? (
                        <div className="text-xs text-slate-400 text-center py-8">Loading messages from GHL...</div>
                      ) : ghlData.messages.length === 0 ? (
                        <div className="text-xs text-slate-400 text-center py-8">No SMS history found for this client.</div>
                      ) : (
                        ghlData.messages.map((m, idx) => {
                          const isClient = m.direction === 'inbound' || m.direction === 'Incoming';
                          const msgText = m.body || m.message || m.text;
                          const msgDate = formatDate(m.dateAdded || m.createdAt || m.date);

                          return (
                            <div
                              key={idx}
                              className={`max-w-[80%] p-3.5 rounded-2xl text-xs ${
                                isClient
                                  ? 'bg-slate-800 text-slate-200 border border-slate-700 mr-auto'
                                  : 'bg-blue-600 text-white ml-auto'
                              }`}
                            >
                              <div className="flex justify-between items-center mb-1 gap-4">
                                <span className="font-bold">{isClient ? '📱 Client' : '💬 Coach'}</span>
                                <span className="text-[10px] opacity-70">{msgDate}</span>
                              </div>
                              <div className="text-sm whitespace-pre-wrap">{msgText || '[Attachment]'}</div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* SMS SEND BOX */}
                    <div className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2">
                      <input
                        type="text"
                        value={outgoingSms}
                        onChange={(e) => setOutgoingSms(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendSms()}
                        placeholder={`Text ${selectedClient.name}...`}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleSendSms}
                        disabled={isSendingSms || !outgoingSms.trim()}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-colors"
                      >
                        {isSendingSms ? 'Sending...' : 'Send SMS'}
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 3: GHL NOTES */}
                {activeTab === 'notes' && (
                  <div className="space-y-3">
                    {loadingGhl ? (
                      <div className="text-xs text-slate-400">Loading notes from GHL...</div>
                    ) : ghlData.notes.length === 0 ? (
                      <div className="text-xs text-slate-400">No notes found in GHL for this client.</div>
                    ) : (
                      ghlData.notes.map((n, idx) => (
                        <div key={idx} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-slate-300">
                          <div className="text-slate-200 text-sm whitespace-pre-wrap">{n.body || n.note}</div>
                          <div className="text-[10px] text-slate-500 mt-2">{formatDate(n.dateAdded || n.createdAt)}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-24 text-slate-500">Select a client from the left roster.</div>
            )}
          </main>
        </div>
      )}

      {/* VIEW PANEL 2: RESTORED MASTER CALENDAR */}
      {currentNavView === 'calendar' && (
        <Calendar
          clients={clients}
          ghlAppointments={ghlData.appointments}
          selectedClient={selectedClient}
        />
      )}

      {/* VIEW PANEL 3: MANAGE STAFF */}
      {currentNavView === 'staff' && (
        <main className="flex-1 p-6 overflow-y-auto bg-slate-950">
          <div className="flex justify-between items-center pb-6 border-b border-slate-800 mb-6">
            <div>
              <h2 className="text-2xl font-black text-white">Manage Staff & Coaches</h2>
              <p className="text-xs text-slate-400 mt-1">CrossFit Swarm coaching team and assigned nutrition client rosters.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {staffMembers.map((staff) => (
              <div key={staff.id} className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-white">{staff.name}</h3>
                    <p className="text-xs text-blue-400 font-medium">{staff.role}</p>
                  </div>
                  <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Active
                  </span>
                </div>
                <div className="text-xs text-slate-400">{staff.email}</div>
                <div className="pt-2 border-t border-slate-800 text-xs">
                  <span className="text-slate-500">Assigned Clients:</span>{' '}
                  <span className="font-bold text-white">{staff.assignedClients}</span>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* GHL LOOKUP MODAL */}
      {isGhlLookupOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">GHL Contact Lookup</h3>
              <button onClick={() => setIsGhlLookupOpen(false)} className="text-slate-400 hover:text-white text-xl">
                ×
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={ghlSearchQuery}
                onChange={(e) => setGhlSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchGhlContacts()}
                placeholder="Search GHL by name, email, tag (or leave blank for all)..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleSearchGhlContacts}
                disabled={isSearchingGhl}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl text-white disabled:opacity-50"
              >
                {isSearchingGhl ? 'Searching...' : 'Search GHL'}
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {ghlSearchResults.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500">
                  Click "Search GHL" above to pull your contacts from GoHighLevel.
                </div>
              ) : (
                ghlSearchResults.map((contact) => (
                  <div key={contact.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-white">{contact.name}</div>
                      <div className="text-slate-400 text-[11px]">{contact.email || contact.phone || 'No Contact Info'}</div>
                    </div>
                    <button
                      onClick={() => handleImportGhlContact(contact)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-[11px] rounded-lg"
                    >
                      Import
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* RESULT SHEET MODAL */}
      {selectedScan && (
        <InBodyResultSheetModal
          scan={selectedScan}
          onClose={() => setSelectedScan(null)}
          onDelete={handleDeleteScan}
        />
      )}

      {/* OWNER CSV UPLOAD MODAL */}
      <AdminInBodyUploadModal
        isOpen={isAdminUploadOpen}
        onClose={() => setIsAdminUploadOpen(false)}
        clients={clients}
        onComplete={() => console.log('CSV Import Complete')}
      />
    </div>
  );
}