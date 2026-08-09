import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  query,
  orderBy,
  addDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import Calendar from './Calendar';
import InBodyResultSheetModal from './InBodyResultSheetModal';
import AdminInBodyUploadModal from './AdminInBodyUploadModal';
import InBodyCompareModal from './InBodyCompareModal';
import UserManagement from './UserManagement';

// ---------- Date helpers ----------
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

// ---------- Progress Chart (clean for many scans) ----------
function InBodyProgressChart({ scans }) {
  const [metric, setMetric] = useState('weight');
  if (!scans || scans.length === 0) return null;

  const sortedScans = [...scans].sort((a, b) => {
    const da = parseScanDate(a.scanDate)?.getTime() ?? 0;
    const db = parseScanDate(b.scanDate)?.getTime() ?? 0;
    return da - db;
  });

  if (sortedScans.length < 2) {
    return <div className="text-xs text-slate-400 text-center py-4">Log at least 2 scans to view progress trends.</div>;
  }

  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const firstScan = sortedScans[0];
  const latestScan = sortedScans[sortedScans.length - 1];
  const weightDiff = (num(latestScan.weight) - num(firstScan.weight)).toFixed(1);
  const smmDiff = (num(latestScan.smm) - num(firstScan.smm)).toFixed(1);
  const pbfDiff = (num(latestScan.pbf) - num(firstScan.pbf)).toFixed(1);

  const metricConfigs = {
    weight: { label: 'Weight', color: '#3b82f6', getValue: (s) => num(s.weight) },
    smm: { label: 'Muscle (SMM)', color: '#10b981', getValue: (s) => num(s.smm) },
    pbf: { label: 'Body Fat %', color: '#a855f7', getValue: (s) => num(s.pbf) },
    score: { label: 'InBody Score', color: '#f59e0b', getValue: (s) => num(s.score) },
  };

  const config = metricConfigs[metric];
  const values = sortedScans.map(config.getValue).filter((v) => v > 0);
  if (values.length < 2) return <div className="text-xs text-slate-400 text-center py-4">Not enough valid data.</div>;

  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values) * 1.05;
  const range = maxVal - minVal || 1;
  const width = 700;
  const height = 160;
  const padding = 30;

  const points = sortedScans.map((s, idx) => {
    const v = config.getValue(s);
    const x = padding + (idx / (sortedScans.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - minVal) / range) * (height - padding * 2);
    return { x, y, val: v };
  });

  const pathD = points.reduce((acc, p, idx) => (idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
  const showLabels = sortedScans.length <= 20;

  return (
    <div className="space-y-4">
      <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs w-fit">
        {Object.keys(metricConfigs).map((key) => (
          <button key={key} onClick={() => setMetric(key)}
            className={`px-3 py-1.5 font-bold rounded-lg transition-all ${metric === key ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
            {metricConfigs[key].label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Weight Change</span>
          <span className={`text-base font-black ${Number(weightDiff) <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {Number(weightDiff) > 0 ? `+${weightDiff}` : weightDiff} lbs
          </span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Muscle Change</span>
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
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          <defs>
            <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={config.color} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill={`url(#grad-${metric})`} />
          <path d={pathD} fill="none" stroke={config.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, idx) => (
            <g key={idx}>
              <circle cx={p.x} cy={p.y} r={showLabels ? 4 : 2.5} fill="#0f172a" stroke={config.color} strokeWidth="2" />
              {showLabels && (
                <text x={p.x} y={p.y - 9} fill="#e2e8f0" fontSize="9" fontWeight="bold" textAnchor="middle">{p.val}</text>
              )}
            </g>
          ))}
        </svg>
      </div>
      {!showLabels && <p className="text-[10px] text-slate-500 text-center">Labels hidden (many scans). Use metric buttons above.</p>}
    </div>
  );
}
// ---------- Main Dashboard ----------
export default function Dashboard() {
  const [currentNavView, setCurrentNavView] = useState('clients');
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
  const [compareScans, setCompareScans] = useState([]);
  const [clientBookings, setClientBookings] = useState([]);
  const [isChartOpen, setIsChartOpen] = useState(true);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const messagesEndRef = React.useRef(null);

  // Client CRUD
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', coach: '', ghlContactId: '' });
  const [coaches, setCoaches] = useState([]);

  // Habits
  const [habits, setHabits] = useState([]);
  const [clientHabits, setClientHabits] = useState([]);
  const [isHabitLibraryOpen, setIsHabitLibraryOpen] = useState(false);
  const [isAssignHabitOpen, setIsAssignHabitOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);
  const [habitForm, setHabitForm] = useState({ name: '', category: 'Nutrition', description: '' });
  const [assignForm, setAssignForm] = useState({ habitId: '', weeksAssigned: 4, startDate: new Date().toISOString().split('T')[0] });

  const currentUserRole = 'Owner';
  useEffect(() => {
  if (activeTab === 'messages' && messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }
}, [ghlData.messages, activeTab]);

  // Load clients
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClients(docs);
      if (docs.length > 0 && !selectedClient) setSelectedClient(docs[0]);
    });
    return () => unsub();
  }, []);

  const toTitleCase = (str) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  // Load scans
  useEffect(() => {
    const q = query(collection(db, 'inbody_scans'), orderBy('scanDate', 'desc'));
    const unsub = onSnapshot(q, (snap) => setAllScans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  // Load coaches
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCoaches(docs.filter((u) => u.role === 'coach' || u.role === 'owner' || u.role === 'admin'));
    });
    return () => unsub();
  }, []);

  // Load bookings for client
  useEffect(() => {
    if (!selectedClient) { setClientBookings([]); return; }
    const q = query(collection(db, 'bookings'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClientBookings(all.filter((b) =>
        b.clientId === selectedClient.id ||
        (selectedClient.ghlContactId && b.ghlContactId === selectedClient.ghlContactId)
      ));
    });
    return () => unsub();
  }, [selectedClient]);

  // Load habit library
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'habits'), (snap) => {
      setHabits(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Load client habits
  useEffect(() => {
    if (!selectedClient) { setClientHabits([]); return; }
    const q = query(collection(db, 'client_habits'), where('clientId', '==', selectedClient.id));
    const unsub = onSnapshot(q, (snap) => {
      setClientHabits(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [selectedClient]);

  // GHL details
  useEffect(() => {
    if (!selectedClient) return;
    const fetchGhl = async () => {
      setLoadingGhl(true);
      try {
        const ghlId = selectedClient.ghlContactId || selectedClient.ghlId || selectedClient.ghl || selectedClient.contactId || '';
        const params = new URLSearchParams();
        if (ghlId && ghlId !== 'N/A' && !String(ghlId).startsWith('dummy')) params.append('contactId', ghlId);
        if (selectedClient.email) params.append('email', selectedClient.email);
        if (selectedClient.phone) params.append('phone', selectedClient.phone);
        const res = await fetch(`https://us-central1-swarm-nutrition-app.cloudfunctions.net/getGhlContactDetails?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setGhlData({
            notes: Array.isArray(data?.notes) ? data.notes : [],
            appointments: Array.isArray(data?.appointments) ? data.appointments : [],
            messages: Array.isArray(data?.messages) ? data.messages : [],
          });
        } else setGhlData({ notes: [], appointments: [], messages: [] });
      } catch (err) {
        console.error(err);
        setGhlData({ notes: [], appointments: [], messages: [] });
      } finally { setLoadingGhl(false); }
    };
    fetchGhl();
  }, [selectedClient]);

  const filteredClients = clients.filter((c) => {
    const term = clientSearchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      (c.name || '').toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term) ||
      (c.phone || '').includes(term) ||
      (c.ghlContactId || '').toLowerCase().includes(term) ||
      (c.coach || '').toLowerCase().includes(term)
    );
  });

  const clientsByCoach = {};
  filteredClients.forEach((c) => {
    const name = c.coach || 'Unassigned';
    if (!clientsByCoach[name]) clientsByCoach[name] = [];
    clientsByCoach[name].push(c);
  });
  const sortedCoachNames = Object.keys(clientsByCoach).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  const clientScans = allScans.filter((s) => {
    if (!selectedClient) return false;
    if (s.clientId && s.clientId === selectedClient.id) return true;
    const cp = String(selectedClient.phone || '').replace(/\D/g, '');
    const sp = String(s.phone || '').replace(/\D/g, '');
    return cp && sp && (cp.endsWith(sp) || sp.endsWith(cp));
  });

  // Client CRUD
  const openAddClient = () => {
    setEditingClient(null);
    setClientForm({ name: '', email: '', phone: '', coach: '', ghlContactId: '' });
    setIsClientModalOpen(true);
  };
  const openEditClient = (c) => {
    setEditingClient(c);
    setClientForm({ name: c.name || '', email: c.email || '', phone: c.phone || '', coach: c.coach || '', ghlContactId: c.ghlContactId || c.ghlId || '' });
    setIsClientModalOpen(true);
  };
  const handleSaveClient = async () => {
    if (!clientForm.name.trim()) return alert('Name is required');
    try {
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), { ...clientForm, name: clientForm.name.trim(), email: clientForm.email.trim(), phone: clientForm.phone.trim(), coach: clientForm.coach.trim(), ghlContactId: clientForm.ghlContactId.trim(), updatedAt: new Date() });
      } else {
        await addDoc(collection(db, 'clients'), { ...clientForm, name: clientForm.name.trim(), email: clientForm.email.trim(), phone: clientForm.phone.trim(), coach: clientForm.coach.trim(), ghlContactId: clientForm.ghlContactId.trim(), createdAt: new Date() });
      }
      setIsClientModalOpen(false);
    } catch (err) { alert('Failed to save: ' + err.message); }
  };
  const handleDeleteClient = async (c) => {
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'clients', c.id));
      if (selectedClient?.id === c.id) setSelectedClient(null);
    } catch (err) { alert('Failed to delete: ' + err.message); }
  };

  const handleDeleteScan = async (id) => {
    if (!window.confirm('Delete this scan?')) return;
    try {
      await deleteDoc(doc(db, 'inbody_scans', id));
      if (selectedScan?.id === id) setSelectedScan(null);
      setCompareScans((p) => p.filter((s) => s.id !== id));
    } catch (err) { alert(err.message); }
  };

  const toggleCompareScan = (scan) => {
    setCompareScans((prev) => {
      if (prev.find((s) => s.id === scan.id)) return prev.filter((s) => s.id !== scan.id);
      if (prev.length >= 2) return [prev[1], scan];
      return [...prev, scan];
    });
  };

  const handleSendSms = async () => {
    if (!outgoingSms.trim() || !selectedClient) return;
    const ghlId = selectedClient.ghlContactId || selectedClient.ghlId || selectedClient.ghl || selectedClient.contactId;
    if (!ghlId || ghlId === 'N/A' || String(ghlId).startsWith('dummy')) return alert('No valid GHL ID');
    setIsSendingSms(true);
    try {
      const res = await fetch('https://us-central1-swarm-nutrition-app.cloudfunctions.net/sendGhlSms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: ghlId, message: outgoingSms }),
      });
      if (res.ok) {
        setGhlData((p) => ({ ...p, messages: [{ body: outgoingSms, direction: 'outbound', dateAdded: new Date().toISOString() }, ...p.messages] }));
        setOutgoingSms('');
      }
    } catch (err) { console.error(err); }
    finally { setIsSendingSms(false); }
  };

  // Habits
  const openAddHabit = () => { setEditingHabit(null); setHabitForm({ name: '', category: 'Nutrition', description: '' }); setIsHabitLibraryOpen(true); };
  const openEditHabit = (h) => { setEditingHabit(h); setHabitForm({ name: h.name || '', category: h.category || 'Nutrition', description: h.description || '' }); setIsHabitLibraryOpen(true); };
  const handleSaveHabit = async () => {
    if (!habitForm.name.trim()) return alert('Habit name is required');
    try {
      if (editingHabit) {
        await updateDoc(doc(db, 'habits', editingHabit.id), { name: habitForm.name.trim(), category: habitForm.category, description: habitForm.description.trim(), updatedAt: new Date() });
      } else {
        await addDoc(collection(db, 'habits'), { name: habitForm.name.trim(), category: habitForm.category, description: habitForm.description.trim(), createdAt: new Date() });
      }
      setIsHabitLibraryOpen(false); setEditingHabit(null);
    } catch (err) { alert('Failed to save habit: ' + err.message); }
  };
  const handleDeleteHabit = async (h) => {
    if (!window.confirm(`Delete habit "${h.name}" from the library?`)) return;
    try { await deleteDoc(doc(db, 'habits', h.id)); } catch (err) { alert(err.message); }
  };
  const openAssignHabit = () => {
    setAssignForm({ habitId: habits[0]?.id || '', weeksAssigned: 4, startDate: new Date().toISOString().split('T')[0] });
    setIsAssignHabitOpen(true);
  };
  const handleAssignHabit = async () => {
    if (!assignForm.habitId || !selectedClient) return alert('Select a habit');
    const habit = habits.find((h) => h.id === assignForm.habitId);
    if (!habit) return;
    if (clientHabits.some((ch) => ch.habitId === habit.id && ch.status === 'active')) return alert('Already assigned.');
    try {
      await addDoc(collection(db, 'client_habits'), {
        clientId: selectedClient.id, habitId: habit.id, habitName: habit.name, category: habit.category || 'Nutrition',
        startDate: assignForm.startDate, weeksAssigned: Number(assignForm.weeksAssigned) || 4, status: 'active', checkIns: {}, createdAt: new Date(),
      });
      setIsAssignHabitOpen(false);
    } catch (err) { alert('Failed to assign: ' + err.message); }
  };
  const handleRemoveClientHabit = async (ch) => {
    if (!window.confirm(`Remove "${ch.habitName}" from this client?`)) return;
    try { await deleteDoc(doc(db, 'client_habits', ch.id)); } catch (err) { alert(err.message); }
  };

  const currentGhlId = selectedClient?.ghlContactId || selectedClient?.ghlId || selectedClient?.ghl || selectedClient?.contactId || 'N/A';
    return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-4 shrink-0">
        <div>
          <div className="flex items-center gap-3 px-2 py-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-black text-white text-lg">S</div>
            <h1 className="text-lg font-extrabold tracking-wide text-white">Swarm Nutrition</h1>
          </div>
          <nav className="space-y-1">
            <button onClick={() => setCurrentNavView('clients')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${currentNavView === 'clients' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
              <span>👥</span> Clients
            </button>
            <button onClick={() => setCurrentNavView('calendar')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${currentNavView === 'calendar' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
              <span>📅</span> Master Calendar
            </button>
            <button onClick={() => setCurrentNavView('staff')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${currentNavView === 'staff' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
              <span>👤</span> Manage Staff
            </button>
          </nav>
        </div>
        <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 px-2">
          Logged in as: <span className="font-semibold text-slate-200">{currentUserRole}</span>
        </div>
      </aside>

      {/* CLIENTS VIEW */}
      {currentNavView === 'clients' && (
        <div className="flex flex-1 overflow-hidden">
          <section className="w-72 border-r border-slate-800 bg-slate-900/50 flex flex-col">
            <div className="p-4 border-b border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Clients ({clients.length})</h2>
                <div className="flex gap-1.5">
                  <button onClick={openAddClient} className="px-2.5 py-1 text-[10px] font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/30">+ Add</button>
                  <button onClick={() => setIsGhlLookupOpen(true)} className="px-2.5 py-1 text-[10px] font-bold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30">🔍 GHL</button>
                </div>
              </div>
              <input type="text" value={clientSearchTerm} onChange={(e) => setClientSearchTerm(e.target.value)} placeholder="Search name, email, phone, coach..." className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {sortedCoachNames.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">No clients found</div>
              ) : (
                sortedCoachNames.map((coachName) => (
                  <div key={coachName} className="mb-4">
                    <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 bg-slate-900/95">{coachName} ({clientsByCoach[coachName].length})</div>
                    <div className="space-y-2 mt-1">
                      {clientsByCoach[coachName].map((c) => {
                        const isSelected = selectedClient?.id === c.id;
                        const ghlVal = c.ghlContactId || c.ghlId || c.ghl || c.contactId;
                        return (
                          <div key={c.id} onClick={() => { setSelectedClient(c); setCompareScans([]); setIsCompareMode(false); }}
                            className={`p-3 rounded-xl cursor-pointer border transition-all group ${isSelected ? 'bg-blue-600/10 border-blue-500/50 text-white shadow-md' : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'}`}>
                            <div className="flex justify-between items-start">
                              <div className="font-bold text-sm">{c.name}</div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); openEditClient(c); }} className="p-1 text-slate-400 hover:text-blue-400">✏️</button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteClient(c); }} className="p-1 text-slate-400 hover:text-red-400">🗑️</button>
                              </div>
                            </div>
                            <div className="text-xs text-slate-400 truncate mt-0.5">{c.email || c.phone || 'No Contact Info'}</div>
                            {ghlVal && <div className="text-[10px] font-mono text-blue-400 mt-1">GHL: {ghlVal}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <main className="flex-1 flex flex-col overflow-y-auto bg-slate-950 p-6">
            {selectedClient ? (
              <>
                <div className="flex justify-between items-start pb-6 border-b border-slate-800 mb-6">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black text-white">{selectedClient.name}</h2>
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Coach: {selectedClient.coach || 'Unassigned'}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Email: {selectedClient.email || 'N/A'} | Phone: {selectedClient.phone || 'N/A'} | GHL ID: {currentGhlId}</div>
                  </div>
                  {currentUserRole === 'Owner' && (
                    <button onClick={() => setIsAdminUploadOpen(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-lg">⚙️ Owner Admin: Upload Master CSV</button>
                  )}
                </div>

                <div className="flex border-b border-slate-800 mb-6 gap-6 flex-wrap">
                  {[
                    { id: 'inbody', label: `⚡ InBody Scans (${clientScans.length})` },
                    { id: 'habits', label: `✅ Habits (${clientHabits.length})` },
                    { id: 'appointments', label: `📅 Appointments (${clientBookings.length})` },
                    { id: 'messages', label: `💬 GHL Live SMS (${ghlData.messages.length})` },
                    { id: 'notes', label: `📝 GHL Notes (${ghlData.notes.length})` },
                  ].map((tab) => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className={`pb-3 text-sm font-bold transition-colors border-b-2 ${activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* INBODY TAB */}
                {activeTab === 'inbody' && (
                  <div className="space-y-4">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                      <button onClick={() => setIsChartOpen(!isChartOpen)} className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-800/50 transition-colors">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Progress Trends ({clientScans.length} Scans)</h3>
                          <p className="text-xs text-slate-400 mt-0.5">Click to {isChartOpen ? 'collapse' : 'expand'} chart</p>
                        </div>
                        <span className="text-slate-400 text-lg">{isChartOpen ? '−' : '+'}</span>
                      </button>
                      {isChartOpen && <div className="px-5 pb-5"><InBodyProgressChart scans={clientScans} /></div>}
                    </div>

                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-300">All Scans ({clientScans.length})</h3>
                      <div className="flex items-center gap-2">
                        {isCompareMode && compareScans.length > 0 && <span className="text-xs text-slate-400">{compareScans.length}/2 selected</span>}
                        <button onClick={() => { setIsCompareMode(!isCompareMode); if (isCompareMode) setCompareScans([]); }}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${isCompareMode ? 'bg-slate-700 text-white' : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'}`}>
                          {isCompareMode ? 'Cancel Compare' : 'Compare'}
                        </button>
                      </div>
                    </div>

                    {clientScans.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-sm text-slate-400">No InBody scans logged yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {clientScans.map((scan) => {
                          const isSelected = compareScans.some((s) => s.id === scan.id);
                          return (
                            <div key={scan.id} className={`bg-slate-900 border p-4 rounded-2xl flex items-center gap-4 transition-all ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-slate-800 hover:border-slate-700'}`}>
                              {isCompareMode && (
                                <input type="checkbox" checked={isSelected} onChange={() => toggleCompareScan(scan)} className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 cursor-pointer" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-slate-400 mb-1">{formatDate(scan.scanDate)}</div>
                                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                  <div><span className="text-[10px] text-slate-500 uppercase font-bold mr-1">Weight</span><span className="font-black text-slate-100">{scan.weight > 0 ? `${scan.weight} lbs` : '--'}</span></div>
                                  <div><span className="text-[10px] text-slate-500 uppercase font-bold mr-1">Muscle</span><span className="font-black text-blue-400">{scan.smm > 0 ? `${scan.smm} lbs` : '--'}</span></div>
                                  <div><span className="text-[10px] text-slate-500 uppercase font-bold mr-1">Body Fat</span><span className="font-black text-purple-400">{scan.pbf > 0 ? `${scan.pbf}%` : '--'}</span></div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button onClick={() => setSelectedScan(scan)} className="px-3 py-1.5 text-xs font-bold rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">View Sheet</button>
                                <button onClick={() => handleDeleteScan(scan.id)} className="p-1.5 text-slate-400 hover:text-red-400">🗑️</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* HABITS TAB */}
                {activeTab === 'habits' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-300">Assigned Habits ({clientHabits.length})</h3>
                      <div className="flex gap-2">
                        <button onClick={openAddHabit} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">Manage Library</button>
                        <button onClick={openAssignHabit} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-500">+ Assign Habit</button>
                      </div>
                    </div>
                    {clientHabits.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
                        <p className="text-sm text-slate-400">No habits assigned yet.</p>
                        <p className="text-xs text-slate-500 mt-1">Click “+ Assign Habit” to get started.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {clientHabits.map((ch) => (
                          <div key={ch.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
                            <div>
                              <div className="font-bold text-sm text-white">{ch.habitName}</div>
                              <div className="text-xs text-slate-400 mt-1 flex gap-3 flex-wrap">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">{ch.category}</span>
                                <span>Started {ch.startDate}</span>
                                <span>{ch.weeksAssigned} weeks</span>
                                <span className="capitalize text-emerald-400">{ch.status}</span>
                              </div>
                            </div>
                            <button onClick={() => handleRemoveClientHabit(ch)} className="p-1.5 text-slate-400 hover:text-red-400" title="Remove">🗑️</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                                {/* APPOINTMENTS TAB */}
                {activeTab === 'appointments' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Upcoming</h3>
                      <div className="space-y-2">
                        {clientBookings.filter((b) => new Date(b.date + 'T' + (b.time || '00:00')) >= new Date()).map((b) => (
                          <div key={b.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex justify-between items-center">
                            <div>
                              <div className="font-bold text-sm text-white">{b.appointmentTypeName || 'Appointment'}</div>
                              <div className="text-xs text-slate-400 mt-1">{b.date} at {b.time} · {b.roomName || 'No room'} · {b.durationMinutes || 15} min</div>
                            </div>
                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Upcoming</span>
                          </div>
                        ))}
                        {clientBookings.filter((b) => new Date(b.date + 'T' + (b.time || '00:00')) >= new Date()).length === 0 && <div className="text-xs text-slate-500">No upcoming appointments</div>}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Past</h3>
                      <div className="space-y-2">
                        {clientBookings.filter((b) => new Date(b.date + 'T' + (b.time || '00:00')) < new Date()).map((b) => (
                          <div key={b.id} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4 flex justify-between items-center opacity-75">
                            <div>
                              <div className="font-bold text-sm text-slate-300">{b.appointmentTypeName || 'Appointment'}</div>
                              <div className="text-xs text-slate-500 mt-1">{b.date} at {b.time} · {b.roomName || 'No room'}</div>
                            </div>
                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-slate-800 text-slate-400">Past</span>
                          </div>
                        ))}
                        {clientBookings.filter((b) => new Date(b.date + 'T' + (b.time || '00:00')) < new Date()).length === 0 && <div className="text-xs text-slate-500">No past appointments</div>}
                      </div>
                    </div>
                  </div>
                )}

                {/* MESSAGES TAB */}
                {activeTab === 'messages' && (
                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                  {loadingGhl ? (
                    <div className="text-xs text-slate-400 text-center py-8">Loading...</div>
                  ) : ghlData.messages.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-8">No messages found</div>
                  ) : (
                    <>
                      {[...ghlData.messages].reverse().map((m, idx) => {
                        const isClient = m.direction === 'inbound' || m.type === 1 || m.direction === 'in';
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
                              <span className="text-[10px] opacity-70">
                                {formatDate(m.dateAdded || m.createdAt || m.date)}
                              </span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap">
                              {m.body || m.message || m.text || '[Attachment]'}
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
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
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl"
                    >
                      {isSendingSms ? 'Sending...' : 'Send SMS'}
                    </button>
                  </div>
                </div>
                
                )}

                {/* NOTES TAB */}
                {activeTab === 'notes' && (
                  <div className="space-y-3">
                    {loadingGhl ? <div className="text-xs text-slate-400">Loading notes...</div> :
                      ghlData.notes.length === 0 ? <div className="text-xs text-slate-400">No notes found</div> :
                      ghlData.notes.map((n, idx) => (
                        <div key={idx} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-slate-300">
                          <div className="text-slate-200 text-sm whitespace-pre-wrap">{n.body || n.note}</div>
                          <div className="text-[10px] text-slate-500 mt-2">{formatDate(n.dateAdded || n.createdAt)}</div>
                        </div>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-24 text-slate-500">Select a client from the left roster.</div>
            )}
          </main>
        </div>
      )}

      {currentNavView === 'calendar' && <Calendar clients={clients} ghlAppointments={ghlData.appointments} selectedClient={selectedClient} />}
      {currentNavView === 'staff' && <main className="flex-1 overflow-y-auto bg-slate-950"><UserManagement /></main>}

      {/* CLIENT MODAL */}
      {isClientModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">{editingClient ? 'Edit Client' : 'Add New Client'}</h3>
              <button onClick={() => setIsClientModalOpen(false)} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs text-slate-400 font-medium">Full Name *</label><input type="text" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
              <div><label className="text-xs text-slate-400 font-medium">Email</label><input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
              <div><label className="text-xs text-slate-400 font-medium">Phone</label><input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Assigned Coach</label>
                <select value={clientForm.coach} onChange={(e) => setClientForm({ ...clientForm, coach: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                  <option value="">Unassigned</option>
                  {coaches.map((c) => <option key={c.id} value={c.name || c.email}>{c.name || c.email}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-slate-400 font-medium">GHL Contact ID</label><input type="text" value={clientForm.ghlContactId} onChange={(e) => setClientForm({ ...clientForm, ghlContactId: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setIsClientModalOpen(false)} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">Cancel</button>
              <button onClick={handleSaveClient} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white">{editingClient ? 'Save Changes' : 'Add Client'}</button>
            </div>
          </div>
        </div>
      )}

      {/* GHL LOOKUP */}
      {isGhlLookupOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center"><h3 className="text-lg font-bold text-white">GHL Contact Lookup</h3><button onClick={() => setIsGhlLookupOpen(false)} className="text-slate-400 hover:text-white text-xl">×</button></div>
            <div className="flex gap-2">
              <input type="text" value={ghlSearchQuery} onChange={(e) => setGhlSearchQuery(e.target.value)} placeholder="Search GHL..." className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
              <button
  onClick={async () => {
    if (!ghlSearchQuery.trim()) return alert('Enter a search term');
    setIsSearchingGhl(true);
    setGhlSearchResults([]);
    try {
      const res = await fetch(
        `https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(ghlSearchQuery.trim())}`
      );
      const data = await res.json();
      console.log('GHL Search response:', data);
      if (data.success && Array.isArray(data.contacts)) {
        setGhlSearchResults(data.contacts);
        if (data.contacts.length === 0) alert('No contacts found for that search.');
      } else {
        alert('Search failed: ' + (data.error || 'Unknown error'));
        setGhlSearchResults([]);
      }
    } catch (e) {
      console.error(e);
      alert('Network error: ' + e.message);
    } finally {
      setIsSearchingGhl(false);
    }
  }}
  disabled={isSearchingGhl}
  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl text-white disabled:opacity-50"
>
  {isSearchingGhl ? '...' : 'Search'}
</button>
            </div>
         <div className="max-h-60 overflow-y-auto space-y-2">
  {ghlSearchResults.map((contact) => (
    <div key={contact.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
      <div>
        <div className="font-bold text-white">{contact.name}</div>
        <div className="text-slate-400 text-[11px]">{contact.email || contact.phone}</div>
      </div>
      <button
        onClick={async () => {
          try {
            const cleanName = toTitleCase(contact.name);
            const docRef = await addDoc(collection(db, 'clients'), {
              name: cleanName,
              email: contact.email || '',
              phone: contact.phone || '',
              ghlContactId: contact.id,
              coach: '',
              createdAt: new Date(),
            });
            setSelectedClient({
              id: docRef.id,
              name: cleanName,
              email: contact.email,
              phone: contact.phone,
              ghlContactId: contact.id,
            });
            setIsGhlLookupOpen(false);
          } catch (e) {
            alert(e.message);
          }
        }}
        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-[11px] rounded-lg"
      >
        Import
      </button>
    </div>
  ))}
</div>
          </div>
        </div>
      )}

      {/* HABIT LIBRARY MODAL */}
      {isHabitLibraryOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">{editingHabit ? 'Edit Habit' : 'Habit Library'}</h3>
              <button onClick={() => { setIsHabitLibraryOpen(false); setEditingHabit(null); }} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
              <div className="text-xs font-bold text-slate-300">{editingHabit ? 'Edit Habit' : 'Add New Habit'}</div>
              <input type="text" placeholder="Habit name (e.g. Drink 1 gallon of water)" value={habitForm.name} onChange={(e) => setHabitForm({ ...habitForm, name: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <select value={habitForm.category} onChange={(e) => setHabitForm({ ...habitForm, category: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="Nutrition">Nutrition</option>
                <option value="Hydration">Hydration</option>
                <option value="Sleep">Sleep</option>
                <option value="Movement">Movement</option>
                <option value="Mindset">Mindset</option>
              </select>
              <input type="text" placeholder="Description (optional)" value={habitForm.description} onChange={(e) => setHabitForm({ ...habitForm, description: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <div className="flex gap-2">
                {editingHabit && <button onClick={() => { setEditingHabit(null); setHabitForm({ name: '', category: 'Nutrition', description: '' }); }} className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300">Cancel Edit</button>}
                <button onClick={handleSaveHabit} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-500">{editingHabit ? 'Save Changes' : 'Add to Library'}</button>
              </div>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {habits.length === 0 ? <div className="text-xs text-slate-500 text-center py-4">No habits in library yet.</div> : habits.map((h) => (
                <div key={h.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
                  <div><div className="font-bold text-white">{h.name}</div><div className="text-slate-400 mt-0.5">{h.category}{h.description ? ` · ${h.description}` : ''}</div></div>
                  <div className="flex gap-1">
                    <button onClick={() => openEditHabit(h)} className="px-2 py-1 bg-slate-800 rounded-lg text-slate-300 hover:bg-slate-700">Edit</button>
                    <button onClick={() => handleDeleteHabit(h)} className="p-1 text-slate-400 hover:text-red-400">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ASSIGN HABIT MODAL */}
      {isAssignHabitOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Assign Habit to {selectedClient?.name}</h3>
              <button onClick={() => setIsAssignHabitOpen(false)} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            {habits.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">No habits in library yet.<br /><button onClick={() => { setIsAssignHabitOpen(false); openAddHabit(); }} className="text-blue-400 underline mt-2">Create one first</button></div>
            ) : (
              <>
                <div>
                  <label className="text-xs text-slate-400 font-medium">Habit</label>
                  <select value={assignForm.habitId} onChange={(e) => setAssignForm({ ...assignForm, habitId: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                    {habits.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.category})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-slate-400 font-medium">Start Date</label><input type="date" value={assignForm.startDate} onChange={(e) => setAssignForm({ ...assignForm, startDate: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
                  <div><label className="text-xs text-slate-400 font-medium">Weeks</label><input type="number" min="1" max="52" value={assignForm.weeksAssigned} onChange={(e) => setAssignForm({ ...assignForm, weeksAssigned: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
                </div>
                <button onClick={handleAssignHabit} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl">Assign Habit</button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedScan && <InBodyResultSheetModal scan={selectedScan} onClose={() => setSelectedScan(null)} onDelete={handleDeleteScan} />}
      {compareScans.length === 2 && <InBodyCompareModal scanA={compareScans[0]} scanB={compareScans[1]} onClose={() => { setCompareScans([]); setIsCompareMode(false); }} />}
      <AdminInBodyUploadModal isOpen={isAdminUploadOpen} onClose={() => setIsAdminUploadOpen(false)} clients={clients} onComplete={() => {}} />
    </div>
  );
}