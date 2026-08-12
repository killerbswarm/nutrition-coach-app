import React, { useState, useEffect, useRef } from 'react';
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
import InBodyResultSheetModal from './InBodyResultSheetModal';
import AdminInBodyUploadModal from './AdminInBodyUploadModal';
import InBodyCompareModal from './InBodyCompareModal';
import { useAuth } from '../context/AuthContext';

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const handleSendSms = async () => {
  if (!selectedClient?.ghlContactId) {
    return alert('Client has no GHL Contact ID');
  }
  if (!smsText.trim() && !smsFile) return;

  setIsSendingSms(true);
  try {
    let attachmentUrl = null;
    if (smsFile) {
      const storage = getStorage();
      const path = `sms-attachments/${selectedClient.id}/${Date.now()}_${smsFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, smsFile);
      attachmentUrl = await getDownloadURL(storageRef);
    }

    const res = await fetch(
      'https://us-central1-swarm-nutrition-app.cloudfunctions.net/sendGhlSms',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: selectedClient.ghlContactId,
          message: smsText.trim() || (attachmentUrl ? ' ' : ''),
          attachments: attachmentUrl ? [attachmentUrl] : [],
        }),
      }
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      alert(data.error || 'Send failed');
      return;
    }
    setSmsText('');
    setSmsFile(null);
    // refresh messages if you have a loader
  } catch (e) {
    alert(e.message);
  } finally {
    setIsSendingSms(false);
  }
};

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

const normalizePhone = (p) => String(p || '').replace(/\D/g, '');

function InBodyProgressChart({ scans }) {
  const [metric, setMetric] = useState('weight');
  if (!scans || scans.length === 0) return null;
  const sortedScans = [...scans].sort((a, b) => (parseScanDate(a.scanDate)?.getTime() ?? 0) - (parseScanDate(b.scanDate)?.getTime() ?? 0));
  if (sortedScans.length < 2) return <div className="text-xs text-slate-400 text-center py-4">Log at least 2 scans to view progress trends.</div>;
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
  const width = 700, height = 160, padding = 30;
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
          <button key={key} onClick={() => setMetric(key)} className={`px-3 py-1.5 font-bold rounded-lg transition-all ${metric === key ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>{metricConfigs[key].label}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Weight Change</span>
          <span className={`text-base font-black ${Number(weightDiff) <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{Number(weightDiff) > 0 ? `+${weightDiff}` : weightDiff} lbs</span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Muscle Change</span>
          <span className={`text-base font-black ${Number(smmDiff) >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{Number(smmDiff) > 0 ? `+${smmDiff}` : smmDiff} lbs</span>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-center">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">Body Fat % Change</span>
          <span className={`text-base font-black ${Number(pbfDiff) <= 0 ? 'text-emerald-400' : 'text-purple-400'}`}>{Number(pbfDiff) > 0 ? `+${pbfDiff}` : pbfDiff}%</span>
        </div>
      </div>
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          <defs><linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={config.color} stopOpacity="0.3" /><stop offset="100%" stopColor={config.color} stopOpacity="0.0" /></linearGradient></defs>
          <path d={areaD} fill={`url(#grad-${metric})`} />
          <path d={pathD} fill="none" stroke={config.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, idx) => (
            <g key={idx}>
              <circle cx={p.x} cy={p.y} r={showLabels ? 4 : 2.5} fill="#0f172a" stroke={config.color} strokeWidth="2" />
              {showLabels && <text x={p.x} y={p.y - 9} fill="#e2e8f0" fontSize="9" fontWeight="bold" textAnchor="middle">{p.val}</text>}
            </g>
          ))}
        </svg>
      </div>
      {!showLabels && <p className="text-[10px] text-slate-500 text-center">Labels hidden (many scans).</p>}
    </div>
  );
}
export default function Clients({ focus, onFocusConsumed }) {
  const { currentUser, isOwner } = useAuth();
  const currentUserRole = isOwner ? 'Owner' : 'Coach';

  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [clientListFilter, setClientListFilter] = useState('active');
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
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [isFindingGhl, setIsFindingGhl] = useState(false);
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', coach: '', ghlContactId: '', status: 'active', });
  const [coaches, setCoaches] = useState([]);
  const [habits, setHabits] = useState([]);
  const [clientHabits, setClientHabits] = useState([]);
  const [isHabitLibraryOpen, setIsHabitLibraryOpen] = useState(false);
  const [isAssignHabitOpen, setIsAssignHabitOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);
  const [habitForm, setHabitForm] = useState({ name: '', category: 'Nutrition', description: '' });
  const [assignForm, setAssignForm] = useState({ habitId: '', weeksAssigned: 4, startDate: new Date().toISOString().split('T')[0] });
  const [showUnlinkedScans, setShowUnlinkedScans] = useState(false);
  const messagesEndRef = useRef(null);
  const [smsExpanded, setSmsExpanded] = useState(false);
  const [smsFile, setSmsFile] = useState(null);
  const [smsText, setSmsText] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClients(docs);
      if (docs.length > 0 && !selectedClient) setSelectedClient(docs[0]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'inbody_scans'), orderBy('scanDate', 'desc'));
    const unsub = onSnapshot(q, (snap) => setAllScans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCoaches(docs.filter((u) => u.role === 'coach' || u.role === 'owner' || u.role === 'admin'));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedClient) { setClientBookings([]); return; }
    const q = query(collection(db, 'bookings'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClientBookings(all.filter((b) => b.clientId === selectedClient.id || (selectedClient.ghlContactId && b.ghlContactId === selectedClient.ghlContactId)));
    });
    return () => unsub();
  }, [selectedClient]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'habits'), (snap) => setHabits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedClient) { setClientHabits([]); return; }
    const q = query(collection(db, 'client_habits'), where('clientId', '==', selectedClient.id));
    const unsub = onSnapshot(q, (snap) => setClientHabits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [selectedClient]);
  useEffect(() => {
    if (!focus?.clientId || clients.length === 0) return;
    const match = clients.find((c) => c.id === focus.clientId);
    if (match) {
      setSelectedClient(match);
      if (focus.tab) setActiveTab(focus.tab);
    }
    if (onFocusConsumed) onFocusConsumed();
  }, [focus, clients]);

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
        if (![...params.keys()].length) { setGhlData({ notes: [], appointments: [], messages: [] }); return; }
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

  useEffect(() => {
    if (activeTab === 'messages' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ghlData.messages, activeTab]);

  const roleFilteredClients = clients.filter((c) => {
    if (currentUserRole === 'Owner') return true;
    // Coach: only clients assigned to this login
    return c.coachId && currentUser?.uid && c.coachId === currentUser.uid;
  });

  const filteredClients = roleFilteredClients.filter((c) => {
    const status = c.status || 'active';
    if (clientListFilter === 'active' && status === 'inactive') return false;
    if (clientListFilter === 'inactive' && status !== 'inactive') return false;
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
    const cp = normalizePhone(selectedClient.phone);
    const sp = normalizePhone(s.phone);
    return cp && sp && (cp.endsWith(sp) || sp.endsWith(cp));
  });

  const unlinkedScanGroups = (() => {
    if (currentUserRole !== 'Owner') return [];
    const clientPhones = new Set(clients.map((c) => normalizePhone(c.phone)).filter((p) => p.length >= 7));
    const clientIds = new Set(clients.map((c) => c.id));
    const orphans = allScans.filter((s) => {
      if (s.clientId && clientIds.has(s.clientId)) return false;
      const sp = normalizePhone(s.phone);
      if (sp.length >= 7 && [...clientPhones].some((cp) => cp.endsWith(sp) || sp.endsWith(cp))) return false;
      return true;
    });
    const groups = {};
    orphans.forEach((s) => {
      const key = normalizePhone(s.phone) || 'unknown';
      if (!groups[key]) groups[key] = { phone: s.phone || '', name: 'Unknown', scans: [] };
      groups[key].scans.push(s);
      const candidates = [s.clientName, s.name, s.memberName, s.userName].filter(Boolean);
      for (const n of candidates) {
        const cleaned = String(n).trim();
        if (cleaned && cleaned.toLowerCase() !== 'unknown' && cleaned.toLowerCase() !== 'unknown client' && !cleaned.toLowerCase().startsWith('member ')) {
          groups[key].name = cleaned;
          break;
        }
      }
    });
    return Object.values(groups).sort((a, b) => b.scans.length - a.scans.length);
  })();
  const openAddClient = () => {
    setEditingClient(null);
    setClientForm({ name: '', email: '', phone: '', coach: '', coachId: '', ghlContactId: '', status: 'active' });
    setIsClientModalOpen(true);
  };
  const openEditClient = (c) => {
    setEditingClient(c);
    setClientForm({
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      coach: c.coach || '',
      coachId: c.coachId || '',
      ghlContactId: c.ghlContactId || c.ghlId || '',
      status: c.status || 'active',
    });
    setIsClientModalOpen(true);
  };
  const handleFindGhlInfo = async () => {
    const q = (clientForm.phone || clientForm.email || clientForm.name || '').trim();
    if (!q) return alert('Enter a phone, email, or name first');

    setIsFindingGhl(true);
    try {
      const res = await fetch(
        `https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (!data.success || !Array.isArray(data.contacts) || data.contacts.length === 0) {
        alert('No GHL contacts found.');
        return;
      }

      const phoneDigits = String(clientForm.phone || '').replace(/\D/g, '');
      let match = data.contacts[0];
      if (phoneDigits.length >= 10) {
        const exact = data.contacts.find((c) => {
          const p = String(c.phone || '').replace(/\D/g, '');
          return p.endsWith(phoneDigits.slice(-10)) || phoneDigits.endsWith(p.slice(-10));
        });
        if (exact) match = exact;
      }

      setClientForm((prev) => ({
        ...prev,
        name: match.name ? toTitleCase(match.name) : prev.name,
        email: match.email || prev.email || '',
        phone: match.phone || prev.phone || '',
        ghlContactId: match.id || prev.ghlContactId || '',
      }));
    } catch (e) {
      alert('GHL lookup failed: ' + e.message);
    } finally {
      setIsFindingGhl(false);
    }
  };

  const handleSaveClient = async () => {
    if (!clientForm.name.trim()) return alert('Name is required');
    try {
      const payload = {
        name: clientForm.name.trim(),
        email: clientForm.email.trim(),
        phone: clientForm.phone.trim(),
        coach: clientForm.coach.trim(),
        coachId: clientForm.coachId || '',
        ghlContactId: clientForm.ghlContactId.trim(),
        status: clientForm.status || 'active',
      };
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), {
          ...payload,
          updatedAt: new Date(),
        });
      } else {
        await addDoc(collection(db, 'clients'), {
          ...payload,
          status: 'active',
          createdAt: new Date(),
        });
      }
      setIsClientModalOpen(false);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  };

  const handleDeleteClient = async (c) => {
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'clients', c.id));
      if (selectedClient?.id === c.id) setSelectedClient(null);
    } catch (err) { alert(err.message); }
  };
  const toggleClientStatus = async (client) => {
    const current = client.status || 'active';
    const next = current === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`Mark "${client.name}" as ${next}?`)) return;
    try {
      await updateDoc(doc(db, 'clients', client.id), { status: next, updatedAt: new Date() });
      if (selectedClient?.id === client.id) setSelectedClient({ ...selectedClient, status: next });
    } catch (err) { alert(err.message); }
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

  const openAddHabit = () => { setEditingHabit(null); setHabitForm({ name: '', category: 'Nutrition', description: '' }); setIsHabitLibraryOpen(true); };
  const openEditHabit = (h) => { setEditingHabit(h); setHabitForm({ name: h.name || '', category: h.category || 'Nutrition', description: h.description || '' }); setIsHabitLibraryOpen(true); };
  const handleSaveHabit = async () => {
    if (!habitForm.name.trim()) return alert('Habit name is required');
    try {
      if (editingHabit) await updateDoc(doc(db, 'habits', editingHabit.id), { name: habitForm.name.trim(), category: habitForm.category, description: habitForm.description.trim(), updatedAt: new Date() });
      else await addDoc(collection(db, 'habits'), { name: habitForm.name.trim(), category: habitForm.category, description: habitForm.description.trim(), createdAt: new Date() });
      setIsHabitLibraryOpen(false); setEditingHabit(null);
    } catch (err) { alert(err.message); }
  };
  const handleDeleteHabit = async (h) => {
    if (!window.confirm(`Delete "${h.name}"?`)) return;
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
    } catch (err) { alert(err.message); }
  };
  const handleRemoveClientHabit = async (ch) => {
    if (!window.confirm(`Remove "${ch.habitName}"?`)) return;
    try { await deleteDoc(doc(db, 'client_habits', ch.id)); } catch (err) { alert(err.message); }
  };

  const currentGhlId = selectedClient?.ghlContactId || selectedClient?.ghlId || selectedClient?.ghl || selectedClient?.contactId || 'N/A';

  return (
    <div className="flex flex-1 overflow-hidden">
      <section className="w-72 border-r border-slate-800 bg-slate-900/50 flex flex-col">
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Clients ({filteredClients.length})</h2>
            <div className="flex gap-1.5">
              <button onClick={openAddClient} className="px-2.5 py-1 text-[10px] font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/30">+ Add</button>
              {currentUserRole === 'Owner' && (
                <button onClick={() => setShowUnlinkedScans(true)} className="px-2.5 py-1 text-[10px] font-bold bg-amber-600/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-600/30">Unlinked ({unlinkedScanGroups.length})</button>
              )}
            </div>
          </div>
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
            <button onClick={() => setClientListFilter('active')} className={`flex-1 py-1.5 font-bold rounded-md transition-all ${clientListFilter === 'active' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Active</button>
            <button onClick={() => setClientListFilter('inactive')} className={`flex-1 py-1.5 font-bold rounded-md transition-all ${clientListFilter === 'inactive' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Inactive</button>
          </div>
          <input type="text" value={clientSearchTerm} onChange={(e) => setClientSearchTerm(e.target.value)} placeholder="Search..." className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
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
                      <div
                        key={c.id}
                        onClick={() => setSelectedClient(c)}
                        className="p-3 rounded-xl cursor-pointer flex items-start justify-between gap-2 border border-slate-800 hover:border-slate-700 bg-slate-950"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm text-white truncate">{c.name}</div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {c.email || c.phone || ''}
                          </div>
                          {c.ghlContactId && (
                            <div className="text-[10px] text-blue-400/80 truncate">GHL: {c.ghlContactId}</div>
                          )}
                          <div className="mt-1.5">
                            <span
                              className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border ${(c.status || 'active') === 'active'
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : 'bg-slate-700/50 text-slate-400 border-slate-600'
                                }`}
                            >
                              {(c.status || 'active') === 'active' ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => openEditClient(c)}
                            className="p-1 text-slate-400 hover:text-blue-400"
                          >
                            ✏️
                          </button>
                          {/* your existing delete button here if you have one */}
                        </div>
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
                <button onClick={() => setIsAdminUploadOpen(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-lg">Owner Admin: Upload Master CSV</button>
              )}
            </div>

            <div className="flex border-b border-slate-800 mb-6 gap-6 flex-wrap">
              {[
                { id: 'inbody', label: `InBody Scans (${clientScans.length})` },
                { id: 'habits', label: `Habits (${clientHabits.length})` },
                { id: 'appointments', label: `Appointments (${clientBookings.length})` },
                { id: 'messages', label: `GHL Live SMS (${ghlData.messages.length})` },
                { id: 'notes', label: `GHL Notes (${ghlData.notes.length})` },
              ].map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`pb-3 text-sm font-bold transition-colors border-b-2 ${activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{tab.label}</button>
              ))}
            </div>
            {activeTab === 'inbody' && (
              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <button onClick={() => setIsChartOpen(!isChartOpen)} className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-800/50">
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
                  <button onClick={() => { setIsCompareMode(!isCompareMode); if (isCompareMode) setCompareScans([]); }} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${isCompareMode ? 'bg-slate-700 text-white' : 'bg-blue-600/20 text-blue-400'}`}>{isCompareMode ? 'Cancel Compare' : 'Compare'}</button>
                </div>
                {clientScans.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-sm text-slate-400">No InBody scans logged yet.</div>
                ) : (
                  <div className="space-y-3">
                    {clientScans.map((scan) => {
                      const isSelected = compareScans.some((s) => s.id === scan.id);
                      return (
                        <div key={scan.id} className={`bg-slate-900 border p-4 rounded-2xl flex items-center gap-4 ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-slate-800 hover:border-slate-700'}`}>
                          {isCompareMode && <input type="checkbox" checked={isSelected} onChange={() => toggleCompareScan(scan)} className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 cursor-pointer" />}
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
                  <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl"><p className="text-sm text-slate-400">No habits assigned yet.</p></div>
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
                        <button onClick={() => handleRemoveClientHabit(ch)} className="p-1.5 text-slate-400 hover:text-red-400">🗑️</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'appointments' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Upcoming</h3>
                  <div className="space-y-2">
                    {clientBookings.filter((b) => new Date(b.date + 'T' + (b.time || '00:00')) >= new Date()).map((b) => (
                      <div key={b.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex justify-between items-center">
                        <div>
                          <div className="font-bold text-sm text-white">{b.appointmentTypeName || 'Appointment'}</div>
                          <div className="text-xs text-slate-400 mt-1">{b.date} at {b.time} · {b.roomName || 'No room'}</div>
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
                      <div key={b.id} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4 opacity-75">
                        <div className="font-bold text-sm text-slate-300">{b.appointmentTypeName || 'Appointment'}</div>
                        <div className="text-xs text-slate-500 mt-1">{b.date} at {b.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="flex flex-col h-[550px] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                  {loadingGhl ? <div className="text-xs text-slate-400 text-center py-8">Loading...</div> :
                    ghlData.messages.length === 0 ? <div className="text-xs text-slate-400 text-center py-8">No messages found</div> : (
                      <>
                        {[...ghlData.messages].reverse().map((m, idx) => {
                          const isClient = m.direction === 'inbound' || m.type === 1 || m.direction === 'in';
                          return (
                            <div key={idx} className={`max-w-[80%] p-3.5 rounded-2xl text-xs ${isClient ? 'bg-slate-800 text-slate-200 border border-slate-700 mr-auto' : 'bg-blue-600 text-white ml-auto'}`}>
                              <div className="flex justify-between items-center mb-1 gap-4">
                                <span className="font-bold">{isClient ? 'Client' : 'Coach'}</span>
                                <span className="text-[10px] opacity-70">{formatDate(m.dateAdded || m.createdAt || m.date)}</span>
                              </div>
                              <div className="text-sm whitespace-pre-wrap">{m.body || m.message || m.text || '[Attachment]'}</div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </>
                    )}
                </div>
             <div className="border border-slate-800 rounded-xl bg-slate-950 p-3 space-y-2">
  <textarea
    value={smsText}
    onChange={(e) => setSmsText(e.target.value)}
    rows={smsExpanded ? 6 : 2}
    placeholder="Type a message..."
    className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none resize-y min-h-[48px]"
  />

  <div className="flex items-center justify-between gap-2 flex-wrap">
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setSmsExpanded((v) => !v)}
        className="text-[11px] font-bold text-slate-400 hover:text-white"
      >
        {smsExpanded ? 'Collapse' : 'Expand'}
      </button>

      <label className="cursor-pointer text-[11px] font-bold text-blue-400 hover:text-blue-300">
        {smsFile ? 'Change photo' : 'Attach photo'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setSmsFile(e.target.files?.[0] || null)}
        />
      </label>

      {smsFile && (
        <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
          {smsFile.name}
          <button
            type="button"
            className="ml-1 text-red-400"
            onClick={() => setSmsFile(null)}
          >
            ×
          </button>
        </span>
      )}
    </div>

    <button
      type="button"
      onClick={handleSendSms}
      disabled={isSendingSms || (!smsText.trim() && !smsFile)}
      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg"
    >
      {isSendingSms ? 'Sending...' : 'Send'}
    </button>
  </div>
</div>
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="space-y-3">
                {loadingGhl ? <div className="text-xs text-slate-400">Loading notes...</div> :
                  ghlData.notes.length === 0 ? <div className="text-xs text-slate-400">No notes found</div> :
                    ghlData.notes.map((n, idx) => (
                      <div key={idx} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
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
                <select
                  value={clientForm.coachId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const coachUser = coaches.find((c) => c.id === id);
                    setClientForm({
                      ...clientForm,
                      coachId: id,
                      coach: coachUser ? (coachUser.name || coachUser.email || '') : '',
                    });
                  }}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Unassigned</option>
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Status</label>
                <select
                  value={clientForm.status || 'active'}
                  onChange={(e) => setClientForm({ ...clientForm, status: e.target.value })}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div><label className="text-xs text-slate-400 font-medium">GHL Contact ID</label><input type="text" value={clientForm.ghlContactId} onChange={(e) => setClientForm({ ...clientForm, ghlContactId: e.target.value })} className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" /></div>
            </div>
            <button
              type="button"
              onClick={handleFindGhlInfo}
              disabled={isFindingGhl}
              className="w-full py-2 text-xs font-bold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50"
            >
              {isFindingGhl ? 'Searching GHL...' : 'Find info from GHL'}
            </button>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setIsClientModalOpen(false)} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">Cancel</button>
              <button onClick={handleSaveClient} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white">{editingClient ? 'Save Changes' : 'Add Client'}</button>
            </div>
          </div>
        </div>
      )}

      {isGhlLookupOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center"><h3 className="text-lg font-bold text-white">GHL Contact Lookup</h3><button onClick={() => setIsGhlLookupOpen(false)} className="text-slate-400 hover:text-white text-xl">×</button></div>
            <div className="flex gap-2">
              <input type="text" value={ghlSearchQuery} onChange={(e) => setGhlSearchQuery(e.target.value)} placeholder="Search GHL..." className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
              <button onClick={async () => {
                if (!ghlSearchQuery.trim()) return alert('Enter a search term');
                setIsSearchingGhl(true); setGhlSearchResults([]);
                try {
                  const res = await fetch(`https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(ghlSearchQuery.trim())}`);
                  const data = await res.json();
                  if (data.success && Array.isArray(data.contacts)) {
                    setGhlSearchResults(data.contacts);
                    if (data.contacts.length === 0) alert('No contacts found.');
                  } else { alert('Search failed'); setGhlSearchResults([]); }
                } catch (e) { alert('Network error: ' + e.message); }
                finally { setIsSearchingGhl(false); }
              }} disabled={isSearchingGhl} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl text-white disabled:opacity-50">{isSearchingGhl ? '...' : 'Search'}</button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-2">
              {ghlSearchResults.map((contact) => (
                <div key={contact.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
                  <div><div className="font-bold text-white">{contact.name}</div><div className="text-slate-400 text-[11px]">{contact.email || contact.phone}</div></div>
                  <button onClick={async () => {
                    try {
                      const cleanName = toTitleCase(contact.name);
                      const docRef = await addDoc(collection(db, 'clients'), { name: cleanName, email: contact.email || '', phone: contact.phone || '', ghlContactId: contact.id, coach: '', status: 'active', createdAt: new Date() });
                      setSelectedClient({ id: docRef.id, name: cleanName, email: contact.email, phone: contact.phone, ghlContactId: contact.id });
                      setIsGhlLookupOpen(false);
                    } catch (e) { alert(e.message); }
                  }} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-[11px] rounded-lg">Import</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showUnlinkedScans && currentUserRole === 'Owner' && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-white">Unlinked Scans</h3>
                <p className="text-xs text-slate-400 mt-0.5">Scans with no matching client — grouped by phone</p>
              </div>
              <button onClick={() => setShowUnlinkedScans(false)} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {unlinkedScanGroups.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">All scans are linked to a client.</div>
              ) : (
                unlinkedScanGroups.map((group) => (
                  <div key={group.phone || group.name} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-white">{toTitleCase(group.name)}</div>
                      <div className="text-slate-400 mt-0.5">{group.phone || 'No phone'} · {group.scans.length} scan{group.scans.length !== 1 ? 's' : ''}</div>
                    </div>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const phone = group.phone || '';
                          const phoneDigits = String(phone).replace(/\D/g, '');

                          let finalName = (group.name || '').trim();
                          if (
                            !finalName ||
                            finalName.toLowerCase() === 'unknown' ||
                            finalName.toLowerCase() === 'unknown client' ||
                            finalName.toLowerCase().startsWith('member')
                          ) {
                            finalName = phoneDigits ? `Member ${phoneDigits}` : 'Unknown Client';
                          } else {
                            finalName = toTitleCase(finalName);
                          }

                          let email = '';
                          let ghlContactId = '';

                          // Look up GHL by phone
                          if (phoneDigits.length >= 7) {
                            try {
                              const res = await fetch(
                                `https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(phoneDigits)}`
                              );
                              const data = await res.json();
                              if (data.success && Array.isArray(data.contacts) && data.contacts.length > 0) {
                                const match =
                                  data.contacts.find((c) => {
                                    const p = String(c.phone || '').replace(/\D/g, '');
                                    return (
                                      p.length >= 7 &&
                                      (p.endsWith(phoneDigits.slice(-10)) ||
                                        phoneDigits.endsWith(p.slice(-10)))
                                    );
                                  }) || data.contacts[0];

                                ghlContactId = match.id || '';
                                email = match.email || '';
                                if (match.name) finalName = toTitleCase(match.name);
                              }
                            } catch (err) {
                              console.error('GHL lookup on unlinked add failed', err);
                            }
                          }

                          await addDoc(collection(db, 'clients'), {
                            name: finalName,
                            email,
                            phone: phoneDigits || phone,
                            ghlContactId,
                            coach: '',
                            coachId: '',
                            status: 'inactive', // still inactive until you assign coach + set active in Edit
                            createdAt: new Date(),
                          });

                          alert(
                            ghlContactId
                              ? `Added: ${finalName} (linked to GHL)`
                              : `Added: ${finalName} (no GHL match — link later in Edit)`
                          );
                        } catch (err) {
                          alert('Add failed: ' + err.message);
                        }
                      }}
                      className="px-2.5 py-1 text-[10px] font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/30"
                    >
                      + Add
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isHabitLibraryOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">{editingHabit ? 'Edit Habit' : 'Habit Library'}</h3>
              <button onClick={() => { setIsHabitLibraryOpen(false); setEditingHabit(null); }} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
              <input type="text" placeholder="Habit name" value={habitForm.name} onChange={(e) => setHabitForm({ ...habitForm, name: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <select value={habitForm.category} onChange={(e) => setHabitForm({ ...habitForm, category: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white">
                <option value="Nutrition">Nutrition</option><option value="Hydration">Hydration</option><option value="Sleep">Sleep</option><option value="Movement">Movement</option><option value="Mindset">Mindset</option>
              </select>
              <button onClick={handleSaveHabit} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-500">{editingHabit ? 'Save Changes' : 'Add to Library'}</button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {habits.map((h) => (
                <div key={h.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
                  <div><div className="font-bold text-white">{h.name}</div><div className="text-slate-400">{h.category}</div></div>
                  <div className="flex gap-1">
                    <button onClick={() => openEditHabit(h)} className="px-2 py-1 bg-slate-800 rounded-lg text-slate-300">Edit</button>
                    <button onClick={() => handleDeleteHabit(h)} className="p-1 text-slate-400 hover:text-red-400">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isAssignHabitOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Assign Habit to {selectedClient?.name}</h3>
              <button onClick={() => setIsAssignHabitOpen(false)} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            {habits.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">No habits yet. <button onClick={() => { setIsAssignHabitOpen(false); openAddHabit(); }} className="text-blue-400 underline">Create one</button></div>
            ) : (
              <>
                <select value={assignForm.habitId} onChange={(e) => setAssignForm({ ...assignForm, habitId: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white">
                  {habits.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.category})</option>)}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" value={assignForm.startDate} onChange={(e) => setAssignForm({ ...assignForm, startDate: e.target.value })} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white" />
                  <input type="number" min="1" max="52" value={assignForm.weeksAssigned} onChange={(e) => setAssignForm({ ...assignForm, weeksAssigned: e.target.value })} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white" />
                </div>
                <button onClick={handleAssignHabit} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl">Assign Habit</button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedScan && <InBodyResultSheetModal scan={selectedScan} onClose={() => setSelectedScan(null)} onDelete={handleDeleteScan} />}
      {compareScans.length === 2 && <InBodyCompareModal scanA={compareScans[0]} scanB={compareScans[1]} onClose={() => { setCompareScans([]); setIsCompareMode(false); }} />}
      <AdminInBodyUploadModal isOpen={isAdminUploadOpen} onClose={() => setIsAdminUploadOpen(false)} clients={clients} onComplete={() => { }} />
    </div>
  );
}