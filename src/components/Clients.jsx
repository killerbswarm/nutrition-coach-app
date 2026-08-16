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
  deleteField,
} from 'firebase/firestore';
import { db, storage } from '../firebase';
import InBodyResultSheetModal from './InBodyResultSheetModal';
import InBodyCompareModal from './InBodyCompareModal';
import { useAuth } from '../context/AuthContext';
import ClientPayrollPanel from './ClientPayrollPanel';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
//import pages 
import ClientFoodLog from './ClientFoodLog';
import ClientInBody from './ClientInBody';
import ClientMeasurements from './ClientMeasurements';
import ClientPhotos from './ClientPhotos';
import ClientHabits from './ClientHabits';
import ClientAppointments from './ClientAppointments';
import ClientSms from './ClientSms';
import ClientNotes from './ClientNotes';
import ClientOverview from './ClientOverview';

const MEASUREMENT_FIELDS = [
  { key: 'neck', label: 'Neck' },
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'rBicep', label: 'R. Bicep' },
  { key: 'lBicep', label: 'L. Bicep' },
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'rThigh', label: 'R. Thigh' },
  { key: 'lThigh', label: 'L. Thigh' },
  { key: 'rCalf', label: 'R. Calf' },
  { key: 'lCalf', label: 'L. Calf' },
];

const emptyMeasurementForm = () => {
  const o = {
    date: new Date().toISOString().split('T')[0],
    notes: '',
  };
  MEASUREMENT_FIELDS.forEach((f) => {
    o[f.key] = '';
  });
  return o;
};

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

function MeasurementBodyMap({ measurement, onClose }) {
  if (!measurement) return null;

  const v = (key) => {
    const n = measurement[key];
    return n != null && n !== '' ? String(n) : '—';
  };

  // value shown on body; full labels in the side list
  const pins = [
    { key: 'neck', label: 'Neck', x: 50, y: 11 },
    { key: 'shoulder', label: 'Shoulder', x: 78, y: 18 },
    { key: 'chest', label: 'Chest', x: 50, y: 26 },
    { key: 'lBicep', label: 'L. Bicep', x: 18, y: 32 },
    { key: 'rBicep', label: 'R. Bicep', x: 82, y: 32 },
    { key: 'waist', label: 'Waist', x: 50, y: 40 },
    { key: 'hips', label: 'Hips', x: 50, y: 50 },
    { key: 'lThigh', label: 'L. Thigh', x: 34, y: 64 },
    { key: 'rThigh', label: 'R. Thigh', x: 66, y: 64 },
    { key: 'lCalf', label: 'L. Calf', x: 34, y: 82 },
    { key: 'rCalf', label: 'R. Calf', x: 66, y: 82 },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">Measurements</h3>
            <p className="text-sm text-slate-300">{measurement.date}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Body */}
          <div className="relative mx-auto w-full max-w-[260px] aspect-[1/2.1] bg-slate-950 rounded-2xl border border-slate-800">
            <svg
              viewBox="0 0 100 210"
              className="absolute inset-0 w-full h-full"
              aria-hidden
            >
              <ellipse cx="50" cy="18" rx="11" ry="13" fill="#334155" />
              <rect x="45" y="28" width="10" height="8" rx="2" fill="#334155" />
              <path d="M32 36 L68 36 L72 95 L28 95 Z" fill="#334155" />
              <path d="M32 38 L18 42 L14 78 L24 78 L30 55 Z" fill="#334155" />
              <path d="M68 38 L82 42 L86 78 L76 78 L70 55 Z" fill="#334155" />
              <path d="M28 95 L72 95 L68 120 L55 120 L50 100 L45 120 L32 120 Z" fill="#334155" />
              <path d="M32 120 L44 120 L42 195 L30 195 Z" fill="#334155" />
              <path d="M56 120 L68 120 L70 195 L58 195 Z" fill="#334155" />
            </svg>

            {pins.map((p) => (
              <div
                key={p.key}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div className="min-w-[2.25rem] px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-black text-center shadow-lg border border-blue-400/50">
                  {v(p.key)}
                </div>
              </div>
            ))}
          </div>

          {/* Readable list */}
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              All sites (inches)
            </div>
            {pins.map((p) => (
              <div
                key={p.key}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800"
              >
                <span className="text-sm font-semibold text-slate-200">{p.label}</span>
                <span className="text-sm font-black text-blue-400 tabular-nums">
                  {v(p.key)}
                </span>
              </div>
            ))}
            {measurement.notes ? (
              <p className="text-sm text-slate-300 mt-3 pt-3 border-t border-slate-800">
                {measurement.notes}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full py-2.5 text-sm font-bold rounded-xl bg-slate-800 hover:bg-slate-700 text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function MeasurementCompareModal({ a, b, onClose }) {
  if (!a || !b) return null;

  // older left, newer right by date
  const [left, right] = a.date <= b.date ? [a, b] : [b, a];

  const val = (m, key) => {
    const n = m[key];
    return n != null && n !== '' ? Number(n) : null;
  };

  const delta = (key) => {
    const x = val(left, key);
    const y = val(right, key);
    if (x == null || y == null) return null;
    return Math.round((y - x) * 100) / 100;
  };

  const fields = [
    { key: 'neck', label: 'Neck' },
    { key: 'shoulder', label: 'Shoulder' },
    { key: 'rBicep', label: 'R. Bicep' },
    { key: 'lBicep', label: 'L. Bicep' },
    { key: 'chest', label: 'Chest' },
    { key: 'waist', label: 'Waist' },
    { key: 'hips', label: 'Hips' },
    { key: 'rThigh', label: 'R. Thigh' },
    { key: 'lThigh', label: 'L. Thigh' },
    { key: 'rCalf', label: 'R. Calf' },
    { key: 'lCalf', label: 'L. Calf' },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">Compare measurements</h3>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white text-2xl">
            ×
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold text-slate-400 mb-2 px-1">
          <div>{left.date}</div>
          <div>Change</div>
          <div>{right.date}</div>
        </div>

        <div className="space-y-1.5">
          {fields.map((f) => {
            const d = delta(f.key);
            const x = val(left, f.key);
            const y = val(right, f.key);
            const dColor =
              d == null ? 'text-slate-500' : d < 0 ? 'text-emerald-400' : d > 0 ? 'text-amber-400' : 'text-slate-300';
            return (
              <div
                key={f.key}
                className="grid grid-cols-3 gap-2 items-center px-3 py-2 rounded-xl bg-slate-950 border border-slate-800"
              >
                <div className="text-sm font-black text-white tabular-nums text-center">
                  {x != null ? x : '—'}
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">{f.label}</div>
                  <div className={`text-sm font-black tabular-nums ${dColor}`}>
                    {d == null ? '—' : d > 0 ? `+${d}` : `${d}`}
                  </div>
                </div>
                <div className="text-sm font-black text-white tabular-nums text-center">
                  {y != null ? y : '—'}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-500 mt-3">
          Negative change (green) = smaller measurement vs older date.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-2.5 text-sm font-bold rounded-xl bg-slate-800 text-white"
        >
          Close
        </button>
      </div>
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
  const [activeTab, setActiveTab] = useState('overview');
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
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', coach: '', ghlContactId: '', status: 'active', nameAliases: '', mfpUsername: '', });
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
  const [payrollCoaches, setPayrollCoaches] = useState([]);
  const [clientMeasurements, setClientMeasurements] = useState([]);
  const [measurementForm, setMeasurementForm] = useState(emptyMeasurementForm());
  const [isMeasurementFormOpen, setIsMeasurementFormOpen] = useState(false);
  const [savingMeasurement, setSavingMeasurement] = useState(false);
  const [clientPhotos, setClientPhotos] = useState([]);
  const [photoLabel, setPhotoLabel] = useState('front');
  const [photoDate, setPhotoDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [comparePhotos, setComparePhotos] = useState([]); // max 2
  const [isPhotoCompareOpen, setIsPhotoCompareOpen] = useState(false);
  const [photoFilter, setPhotoFilter] = useState('all'); // all | front | side | back | other
  const [zoomedPhoto, setZoomedPhoto] = useState(null); // single photo lightbox
  const [selectedMeasurement, setSelectedMeasurement] = useState(null);
  const [compareMeasurements, setCompareMeasurements] = useState([]); // max 2
  const [isMeasurementCompareOpen, setIsMeasurementCompareOpen] = useState(false);
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [bookingForm, setBookingForm] = useState({
    appointmentTypeId: '',
    roomId: '',
    date: new Date().toISOString().split('T')[0],
    time: '10:00',
    durationMinutes: 15,
    notes: '',
  });
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState([]);
  const [isClientSearching, setIsClientSearching] = useState(false);


  useEffect(() => {
    const isOwnerUser =
      isOwner || currentUserRole === 'Owner' || currentUserRole === 'owner';
    if (!isOwnerUser && clientListFilter !== 'active') {
      setClientListFilter('active');
    }
  }, [isOwner, currentUserRole, clientListFilter]);

  useEffect(() => {
    if (editingClient) return;
    if (!isClientModalOpen) return;

    if (clientForm.ghlContactId) {
      setClientSearchResults([]);
      return;
    }

    const q = (clientSearchQuery || '').trim();
    if (q.length < 2) {
      setClientSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setIsClientSearching(true);
      try {
        const res = await fetch(
          `https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        if (data.success && Array.isArray(data.contacts)) {
          setClientSearchResults(data.contacts);
        } else {
          setClientSearchResults([]);
        }
      } catch (e) {
        console.error(e);
        setClientSearchResults([]);
      } finally {
        setIsClientSearching(false);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [clientSearchQuery, isClientModalOpen, editingClient, clientForm.ghlContactId]);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'rooms'), (snap) => {
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const u2 = onSnapshot(collection(db, 'appointment_types'), (snap) => {
      setAppointmentTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setPayrollCoaches(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || data.email,
            isOwner: data.role === 'owner',
            role: data.role,
            ...data,
          };
        })
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClients(docs);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedClient?.id) {
      setClientMeasurements([]);
      return;
    }
    const q = query(
      collection(db, 'clients', selectedClient.id, 'measurements'),
      orderBy('date', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClientMeasurements(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error('measurements listen', err);
        setClientMeasurements([]);
      }
    );
    return () => unsub();
  }, [selectedClient?.id]);

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
    if (!match) {
      if (onFocusConsumed) onFocusConsumed();
      return;
    }

    const allowed =
      currentUserRole === 'Owner' ||
      (match.coachId && currentUser?.uid && match.coachId === currentUser.uid);

    if (allowed) {
      setSelectedClient(match);
      setActiveTab(focus.tab || 'overview');
    }

    if (onFocusConsumed) onFocusConsumed();
  }, [focus, clients, currentUserRole, currentUser?.uid]);

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
    if (!selectedClient) return;
    if (currentUserRole === 'Owner') return;

    const allowed =
      selectedClient.coachId &&
      currentUser?.uid &&
      selectedClient.coachId === currentUser.uid;

    if (!allowed) {
      setSelectedClient(null);
    }
  }, [selectedClient, currentUserRole, currentUser?.uid]);

  useEffect(() => {
    if (activeTab === 'messages' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ghlData.messages, activeTab]);

  useEffect(() => {
    if (!selectedClient?.id) {
      setClientPhotos([]);
      setComparePhotos([]);
      return;
    }
    const q = query(
      collection(db, 'clients', selectedClient.id, 'photos'),
      orderBy('takenAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClientPhotos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error('photos listen', err);
        setClientPhotos([]);
      }
    );
    return () => unsub();
  }, [selectedClient?.id]);



  const roleFilteredClients = (clients || []).filter((c) => {
    const isOwnerUser =
      isOwner || currentUserRole === 'Owner' || currentUserRole === 'owner';

    if (isOwnerUser) return true;

    // Coach
    const uid = currentUser?.uid;
    if (!uid) return false;

    // Must be assigned to this coach
    if (!(c.coachId && String(c.coachId) === String(uid))) return false;

    // Coaches never see inactive
    if ((c.status || 'active') !== 'active') return false;

    return true;
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

  const getMyCoachLabel = () => {
    const uid = currentUser?.uid;
    const email = (currentUser?.email || '').toLowerCase();
    const me =
      (coaches || []).find((u) => u.id === uid) ||
      (coaches || []).find((u) => (u.email || '').toLowerCase() === email);
    return (
      me?.name ||
      currentUser?.displayName ||
      currentUser?.email ||
      ''
    );
  };

  const openAddClient = () => {
    try {
      const isCoachOnly = !(
        isOwner ||
        currentUserRole === 'Owner' ||
        currentUserRole === 'owner'
      );
      const uid = currentUser?.uid || '';
      const email = (currentUser?.email || '').toLowerCase();
      const me =
        (coaches || []).find((u) => u.id === uid) ||
        (coaches || []).find((u) => (u.email || '').toLowerCase() === email);

      const coachName =
        me?.name || currentUser?.displayName || currentUser?.email || '';

      setEditingClient(null);
      setClientForm({
        name: '',
        email: '',
        phone: '',
        coach: isCoachOnly ? coachName : '',
        coachId: isCoachOnly ? uid : '',
        ghlContactId: '',
        status: 'active',
        nameAliases: '',
        mfpUsername: '',
        fatsecretUsername: '',
      });
      setClientSearchQuery('');
      setClientSearchResults([]);
      setIsClientModalOpen(true);
    } catch (e) {
      console.error(openAddClient, e);
      alert('Add client error: ' + e.message);
    }
  };
  const openEditClient = (c) => {
    try {
      if (!c?.id) return;
      setEditingClient(c);
      setClientForm({
        name: c.name || '',
        email: c.email || '',
        phone: c.phone || '',
        coach: c.coach || '',
        coachId: c.coachId || '',
        ghlContactId: c.ghlContactId || c.ghlId || '',
        status: c.status || 'active',
        nameAliases: Array.isArray(c.nameAliases)
          ? c.nameAliases.join(', ')
          : c.nameAliases || '',
        mfpUsername: c.mfpUsername || '',
        fatsecretUsername: c.fatsecretUsername || '',
      });
      setClientSearchQuery('');
      setClientSearchResults([]);
      setIsClientModalOpen(true);
    } catch (err) {
      console.error('openEditClient', err);
      alert('Edit failed: ' + err.message);
    }
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
      setClientSearchQuery('');      // important: empty query
      setClientSearchResults([]);  // hide list
    } catch (e) {
      alert('GHL lookup failed: ' + e.message);
    } finally {
      setIsFindingGhl(false);
    }
  };

  const handleSaveMfpUsername = async () => {
    if (!selectedClient?.id) return;
    const username = (mfpConnectUsername || '').trim().replace(/^@/, '');
    if (!username) {
      alert('Enter a MyFitnessPal username');
      return;
    }
    setMfpSaving(true);
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        mfpUsername: username,
        updatedAt: new Date(),
      });
      setSelectedClient({ ...selectedClient, mfpUsername: username });
      setMfpConnectOpen(false);
      setMfpConnectUsername('');
    } catch (e) {
      alert(e.message);
    } finally {
      setMfpSaving(false);
    }
  };

  const handleSaveClient = async () => {
    if (!clientForm.name.trim()) return alert('Name is required');

    const isCoachOnly = !(isOwner || currentUserRole === 'Owner' || currentUserRole === 'owner');

    const payload = {
      name: clientForm.name.trim(),
      email: (clientForm.email || '').trim(),
      phone: (clientForm.phone || '').trim(),
      coach: isCoachOnly ? getMyCoachLabel() : (clientForm.coach || '').trim(),
      coachId: isCoachOnly ? currentUser?.uid || '' : clientForm.coachId || '',
      ghlContactId: (clientForm.ghlContactId || '').trim(),
      status: clientForm.status || 'active',
      mfpUsername: (clientForm.mfpUsername || '').trim().replace(/^@/, ''),
      fatsecretUsername: (clientForm.fatsecretUsername || '').trim().replace(/^@/, ''),
      nameAliases: String(clientForm.nameAliases || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      updatedAt: new Date(),
    };

    try {
      // ---- Edit existing (opened from pencil) ----
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), payload);
        setIsClientModalOpen(false);
        return;
      }

      // ---- Add: find existing by GHL id or phone (avoid duplicate) ----
      const ghlId = payload.ghlContactId;
      const phoneDigits = String(payload.phone || '').replace(/\D/g, '');

      const existing =
        (ghlId &&
          clients.find(
            (c) => c.ghlContactId && String(c.ghlContactId) === String(ghlId)
          )) ||
        (phoneDigits.length >= 7 &&
          clients.find((c) => {
            const p = String(c.phone || '').replace(/\D/g, '');
            return (
              p.length >= 7 &&
              (p.endsWith(phoneDigits.slice(-10)) ||
                phoneDigits.endsWith(p.slice(-10)))
            );
          })) ||
        null;

      if (existing) {
        await updateDoc(doc(db, 'clients', existing.id), {
          ...payload,
          status: 'active', // reactivate
          // keep nameAliases merge if you want:
          nameAliases: [
            ...new Set([
              ...(Array.isArray(existing.nameAliases) ? existing.nameAliases : []),
              ...(payload.nameAliases || []),
            ]),
          ],
        });
        setSelectedClient({ ...existing, ...payload, status: 'active' });
        setActiveTab('overview');
        setIsClientModalOpen(false);
        return;
      }

      // ---- Truly new ----
      const docRef = await addDoc(collection(db, 'clients'), {
        ...payload,
        status: 'active',
        createdAt: new Date(),
      });
      setSelectedClient({ id: docRef.id, ...payload, status: 'active' });
      setActiveTab('overview');
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

  const handleFatSecretSearch = async () => {
    const q = fsQuery.trim();
    if (!q) return;
    setFsLoading(true);
    setFsError('');
    setFsResults([]);
    try {
      const res = await fetch(
        `https://us-central1-swarm-nutrition-app.cloudfunctions.net/fatsecretSearchFoods?q=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      if (!json.success) {
        setFsError(json.error || json.data?.error?.message || 'Search failed');
        return;
      }
      const raw = json.data?.foods?.food;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      setFsResults(list);
      if (list.length === 0) setFsError('No foods found');
    } catch (e) {
      setFsError(e.message || 'Network error');
    } finally {
      setFsLoading(false);
    }
  };

  const handleRemoveClientHabit = async (ch) => {
    if (!window.confirm(`Remove "${ch.habitName}"?`)) return;
    try { await deleteDoc(doc(db, 'client_habits', ch.id)); } catch (err) { alert(err.message); }
  };

  const handleSaveMeasurement = async () => {
    if (!selectedClient?.id) return;
    if (!measurementForm.date) {
      alert('Please set a date');
      return;
    }
    setSavingMeasurement(true);
    try {
      const data = {
        date: measurementForm.date,
        notes: measurementForm.notes || '',
        createdAt: new Date(),
      };
      MEASUREMENT_FIELDS.forEach((f) => {
        const n = parseFloat(measurementForm[f.key]);
        data[f.key] = Number.isFinite(n) ? n : null;
      });
      await addDoc(collection(db, 'clients', selectedClient.id, 'measurements'), data);
      setMeasurementForm(emptyMeasurementForm());
      setIsMeasurementFormOpen(false);
    } catch (err) {
      alert('Failed to save measurements: ' + err.message);
    } finally {
      setSavingMeasurement(false);
    }
  };

  const handleDeleteMeasurement = async (id) => {
    if (!selectedClient?.id || !id) return;
    if (!window.confirm('Delete this measurement entry?')) return;
    try {
      await deleteDoc(doc(db, 'clients', selectedClient.id, 'measurements', id));
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const toggleCompareMeasurement = (m) => {
    setCompareMeasurements((prev) => {
      if (prev.find((x) => x.id === m.id)) return prev.filter((x) => x.id !== m.id);
      if (prev.length >= 2) return [prev[1], m];
      return [...prev, m];
    });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedClient?.id) return;
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file');
      return;
    }
    setUploadingPhoto(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `client-photos/${selectedClient.id}/${Date.now()}_${photoLabel}_${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, 'clients', selectedClient.id, 'photos'), {
        url,
        storagePath: path,
        label: photoLabel,
        takenAt: photoDate || new Date().toISOString().split('T')[0],
        createdAt: new Date(),
      });
    } catch (err) {
      console.error(err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async (photo) => {
    if (!selectedClient?.id || !photo?.id) return;
    if (!window.confirm('Delete this photo?')) return;
    try {
      if (photo.storagePath) {
        try {
          await deleteObject(ref(storage, photo.storagePath));
        } catch (e) {
          console.warn('Storage delete', e);
        }
      }
      await deleteDoc(doc(db, 'clients', selectedClient.id, 'photos', photo.id));
      setComparePhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const toggleComparePhoto = (photo) => {
    setComparePhotos((prev) => {
      if (prev.find((p) => p.id === photo.id)) {
        return prev.filter((p) => p.id !== photo.id);
      }
      if (prev.length >= 2) {
        return [prev[1], photo];
      }
      return [...prev, photo];
    });
  };

  const handleSaveClientBooking = async () => {
    if (!selectedClient) return;
    const typeObj = appointmentTypes.find((t) => t.id === bookingForm.appointmentTypeId);
    const roomObj = rooms.find((r) => r.id === bookingForm.roomId);

    await addDoc(collection(db, 'bookings'), {
      clientId: selectedClient.id,
      clientName: selectedClient.name || '',
      ghlContactId: selectedClient.ghlContactId || '',
      appointmentTypeId: bookingForm.appointmentTypeId,
      appointmentTypeName: typeObj?.name || '',
      roomId: bookingForm.roomId,
      roomName: roomObj?.name || '',
      date: bookingForm.date,
      time: bookingForm.time,
      durationMinutes: Number(bookingForm.durationMinutes) || 15,
      notes: bookingForm.notes || '',
      coach: selectedClient.coach || '',
      bookedByUid: currentUser?.uid || '',
      bookedByName: currentUser?.displayName || currentUser?.email || '',
      bookedByEmail: currentUser?.email || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    setIsBookingOpen(false);
  };

  const currentGhlId = selectedClient?.ghlContactId || selectedClient?.ghlId || selectedClient?.ghl || selectedClient?.contactId || 'N/A';

  const filteredPhotos =
    photoFilter === 'all'
      ? clientPhotos
      : clientPhotos.filter((p) => (p.label || 'other') === photoFilter);

  const photosByDate = filteredPhotos.reduce((acc, photo) => {
    const d = photo.takenAt || 'Unknown';
    if (!acc[d]) acc[d] = [];
    acc[d].push(photo);
    return acc;
  }, {});

  const photoDateKeys = Object.keys(photosByDate).sort((a, b) => (a < b ? 1 : -1));

  const latestScan = clientScans[0] || null;
  const prevScan = clientScans[1] || null;
  const nextAppt = [...clientBookings]
    .filter((b) => {
      const t = new Date(`${b.date}T${b.time || '00:00'}`);
      return t >= new Date();
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const latestMeasurement = clientMeasurements[0] || null;
  const latestPhoto = clientPhotos[0] || null;
  const lastMessage = (() => {
    const msgs = Array.isArray(ghlData.messages) ? ghlData.messages : [];
    if (!msgs.length) return null;
    // Prefer newest by date if present
    const sorted = [...msgs].sort((a, b) => {
      const ta = new Date(a.dateAdded || a.createdAt || a.timestamp || a.date || 0).getTime();
      const tb = new Date(b.dateAdded || b.createdAt || b.timestamp || b.date || 0).getTime();
      return tb - ta; // newest first
    });
    return sorted[0];
  })();

  const activeHabitsList = clientHabits.filter(
    (h) => (h.status || 'active') === 'active'
  );

  const activeHabitsCount = (clientHabits || []).filter(
    (h) => (h.status || 'active') === 'active'
  ).length;

  return (
    <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
      <section
        className={`
          w-full md:w-72 border-r border-slate-800 bg-slate-900/50 flex-col
          ${selectedClient ? 'hidden md:flex' : 'flex'}
        `}
      >
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
          {(isOwner || currentUserRole === 'Owner') && (
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
              <button onClick={() => setClientListFilter('active')} className={`flex-1 py-1.5 font-bold rounded-md transition-all ${clientListFilter === 'active' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Active</button>
              <button onClick={() => setClientListFilter('inactive')} className={`flex-1 py-1.5 font-bold rounded-md transition-all ${clientListFilter === 'inactive' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Inactive</button>
            </div>
          )}
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
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedClient(c);
                          setActiveTab('overview');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedClient(c);
                            setActiveTab('overview');
                          }
                        }}
                        className={`w-full text-left p-3 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ${selectedClient?.id === c.id
                          ? 'bg-blue-600/20 border-blue-500/40'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-bold text-sm text-white truncate">{c.name}</span>
                          <span
                            className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full border ${(c.status || 'active') === 'active'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-slate-700/50 text-slate-400 border-slate-600'
                              }`}
                          >
                            {(c.status || 'active') === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openEditClient(c);
                          }}
                          className="p-1 text-slate-400 hover:text-blue-400"
                        >
                          ✏️
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <main
        className={`
    flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-slate-950 p-4 md:p-6
    ${selectedClient ? 'flex' : 'hidden md:flex'}
  `}
      >
        {selectedClient ? (
          <>
            <button
              type="button"
              onClick={() => setSelectedClient(null)}
              className="md:hidden mb-3 text-sm font-bold text-blue-400 text-left"
            >
              ← Back to list
            </button>
            <div className="flex justify-between items-start pb-6 border-b border-slate-800 mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black text-white">{selectedClient.name}</h2>
                  <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Coach: {selectedClient.coach || 'Unassigned'}</span>
                </div>
              </div>
            </div>

            <div className="flex border-b border-slate-800 mb-6 gap-6 flex-wrap">
              {[
                { id: 'overview', label: 'Overview' },
                { id: 'inbody', label: `InBody Scans` },
                { id: 'habits', label: `Habits` },
                { id: 'appointments', label: `Appointments` },
                { id: 'messages', label: `SMS` },
                { id: 'notes', label: `Notes` },
                { id: 'foodlog', label: 'Food log' },
                { id: 'measurements', label: 'Measurements' },
                { id: 'photos', label: 'Photos' },
                ...((isOwner || currentUserRole === 'Owner')
                  ? [{ id: 'payments', label: 'Payments' }]
                  : []),
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-3 text-sm font-bold transition-colors border-b-2 ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">


              {activeTab === 'inbody' && selectedClient && (
                <ClientInBody
                  selectedClient={selectedClient}
                  clientScans={clientScans}
                />
              )}

              {activeTab === 'foodlog' && selectedClient && (
                <ClientFoodLog
                  selectedClient={selectedClient}
                  setSelectedClient={setSelectedClient}
                />
              )}

              {activeTab === 'measurements' && selectedClient && (
                <ClientMeasurements
                  selectedClient={selectedClient}
                  clientMeasurements={clientMeasurements}
                />
              )}

              {activeTab === 'photos' && selectedClient && (
                <ClientPhotos
                  selectedClient={selectedClient}
                  clientPhotos={clientPhotos}
                />
              )}

              {activeTab === 'overview' && selectedClient && (
                <ClientOverview
                  selectedClient={selectedClient}
                  clientScans={clientScans}
                  clientBookings={clientBookings}
                  clientMeasurements={clientMeasurements}
                  clientPhotos={clientPhotos}
                  clientHabits={clientHabits}
                  messages={ghlData.messages || []}
                  onNavigateTab={setActiveTab}
                />
              )}
              {activeTab === 'habits' && selectedClient && (
                <ClientHabits
                  selectedClient={selectedClient}
                  clientHabits={clientHabits}
                  habits={habits}
                  onOpenLibrary={openAddHabit}
                />
              )}

              {activeTab === 'appointments' && selectedClient && (
                <ClientAppointments
                  selectedClient={selectedClient}
                  clientBookings={clientBookings}
                  rooms={rooms}
                  appointmentTypes={appointmentTypes}
                />
              )}

              {activeTab === 'messages' && selectedClient && (
                <ClientSms
                  selectedClient={selectedClient}
                  messages={ghlData.messages || []}
                  loadingGhl={loadingGhl}
                  onMessagesChange={(next) =>
                    setGhlData((p) => ({ ...p, messages: next }))
                  }
                />
              )}

              {activeTab === 'notes' && selectedClient && (
                <ClientNotes
                  notes={ghlData.notes || []}
                  loadingGhl={loadingGhl}
                />
              )}


              {activeTab === 'payments' && (isOwner || currentUserRole === 'Owner') && selectedClient && (
                <ClientPayrollPanel
                  client={selectedClient}
                  coaches={payrollCoaches}
                />
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-24 text-slate-500">Select a client from the left roster.</div>
        )}

      </main>

      {isBookingOpen && selectedClient && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Add booking</h3>
              <button
                type="button"
                onClick={() => setIsBookingOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>

            <div className="text-sm text-slate-300">
              Member:{' '}
              <span className="font-bold text-white">{selectedClient.name}</span>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Appointment type</label>
              <select
                value={bookingForm.appointmentTypeId}
                onChange={(e) => {
                  const id = e.target.value;
                  const t = appointmentTypes.find((x) => x.id === id);
                  setBookingForm((prev) => ({
                    ...prev,
                    appointmentTypeId: id,
                    durationMinutes: t?.durationMinutes || prev.durationMinutes,
                  }));
                }}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="">Select type</option>
                {appointmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.durationMinutes} min)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Room</label>
              <select
                value={bookingForm.roomId}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, roomId: e.target.value }))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="">Select room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-medium">Date</label>
                <input
                  type="date"
                  value={bookingForm.date}
                  onChange={(e) => setBookingForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Time</label>
                <input
                  type="time"
                  value={bookingForm.time}
                  onChange={(e) => setBookingForm((prev) => ({ ...prev, time: e.target.value }))}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Notes</label>
              <textarea
                value={bookingForm.notes}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                rows={2}
              />
            </div>

            <button
              type="button"
              onClick={handleSaveClientBooking}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl"
            >
              Create booking
            </button>
          </div>
        </div>
      )}

      {isClientModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                {editingClient ? 'Edit Client' : 'Add New Client'}
              </h3>
              <button
                type="button"
                onClick={() => setIsClientModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>

            {/* NAME + live search (add only) */}
            <div>
              <label className="text-xs text-slate-400 font-medium">Full name *</label>

              {!editingClient && clientForm.ghlContactId && clientForm.name ? (
                <div className="mt-1 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-blue-600/15 border border-blue-500/30">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{clientForm.name}</div>
                    <div className="text-[10px] text-slate-400">Selected</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setClientForm((prev) => ({
                        ...prev,
                        name: '',
                        email: '',
                        phone: '',
                        ghlContactId: '',
                      }));
                      setClientSearchQuery('');
                      setClientSearchResults([]);
                    }}
                    className="text-xs font-bold text-slate-300 hover:text-white shrink-0"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={editingClient ? clientForm.name : clientSearchQuery}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (editingClient) {
                        setClientForm({ ...clientForm, name: v });
                      } else {
                        setClientSearchQuery(v);
                        setClientForm({
                          ...clientForm,
                          name: v,
                          ghlContactId: '', // typing again = not selected
                        });
                      }
                    }}
                    placeholder="Start typing a name..."
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                  {!editingClient && isClientSearching && (
                    <div className="text-[11px] text-slate-500 mt-1">Searching…</div>
                  )}
                  {!editingClient && !clientForm.ghlContactId && clientSearchResults.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800">
                      {clientSearchResults.map((contact) => {
                        const displayName = toTitleCase(contact.name || '');
                        return (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => {
                              setClientForm((prev) => ({
                                ...prev,
                                name: displayName,
                                email: contact.email || '',
                                phone: contact.phone || '',
                                ghlContactId: contact.id || '',
                              }));
                              setClientSearchQuery('');
                              setClientSearchResults([]);
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-slate-800"
                          >
                            <div className="text-sm font-semibold text-white">{displayName}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Optional aliases — keep if you use payroll */}
            <div>
              <label className="text-xs text-slate-400 font-medium">Name aliases (optional)</label>
              <input
                type="text"
                value={clientForm.nameAliases || ''}
                onChange={(e) => setClientForm({ ...clientForm, nameAliases: e.target.value })}
                placeholder="Nicknames, payroll names…"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Email</label>
              <input
                type="email"
                value={clientForm.email || ''}
                onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Phone</label>
              <input
                type="tel"
                value={clientForm.phone || ''}
                onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">MyFitnessPal username</label>
              <input
                type="text"
                value={clientForm.mfpUsername || ''}
                onChange={(e) => setClientForm({ ...clientForm, mfpUsername: e.target.value })}
                placeholder="username (no @)"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium">FatSecret username</label>
              <input
                type="text"
                value={clientForm.fatsecretUsername || ''}
                onChange={(e) =>
                  setClientForm({ ...clientForm, fatsecretUsername: e.target.value })
                }
                placeholder="bornkillerbee"
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Display only (e.g. bornkillerbee). Connect is separate on Food log.
              </p>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Assigned coach</label>
              {isOwner || currentUserRole === 'Owner' || currentUserRole === 'owner' ? (
                <select
                  value={clientForm.coachId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const coachUser = (coaches || []).find((c) => c.id === id);
                    setClientForm({
                      ...clientForm,
                      coachId: id,
                      coach: coachUser ? coachUser.name || coachUser.email || '' : '',
                    });
                  }}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                >
                  <option value="">Unassigned</option>
                  {(coaches || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.email}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={clientForm.coach || getMyCoachLabel()}
                  disabled
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                />
              )}
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Status</label>
              <select
                value={clientForm.status || 'active'}
                onChange={(e) => setClientForm({ ...clientForm, status: e.target.value })}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {/* NO "GHL Contact ID" field, NO "Find info from GHL" button — id is set when they pick a result */}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsClientModalOpen(false)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveClient}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white"
              >
                {editingClient ? 'Save Changes' : 'Add Client'}
              </button>
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
            <div className="p-4 border-b border-slate-800 space-y-3">
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
      {selectedMeasurement && (
        <MeasurementBodyMap
          measurement={selectedMeasurement}
          onClose={() => setSelectedMeasurement(null)}
        />
      )}


      {isMeasurementCompareOpen && compareMeasurements.length === 2 && (
        <MeasurementCompareModal
          a={compareMeasurements[0]}
          b={compareMeasurements[1]}
          onClose={() => setIsMeasurementCompareOpen(false)}
        />
      )}
      {selectedScan && <InBodyResultSheetModal scan={selectedScan} onClose={() => setSelectedScan(null)} onDelete={handleDeleteScan} />}
      {compareScans.length === 2 && <InBodyCompareModal scanA={compareScans[0]} scanB={compareScans[1]} onClose={() => { setCompareScans([]); setIsCompareMode(false); }} />}
    </div>

  );

}