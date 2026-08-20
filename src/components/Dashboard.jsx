import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import Clients from './Clients';
import Calendar from './Calendar';
import UserManagement from './UserManagement';
import Scans from './Scans';
import PayrollShell from './PayrollShell';
import { useTheme } from '../context/ThemeContext';
import AppVersion from './AppVersion';


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

export default function Dashboard() {
  const { currentUser, userRole, isOwner, logout, changePassword } = useAuth();
  const currentUserRole = isOwner ? 'Owner' : (userRole === 'coach' ? 'Coach' : 'User');

  const [currentNavView, setCurrentNavView] = useState('dashboard');
  const [clients, setClients] = useState([]);
  const [allScans, setAllScans] = useState([]);
  const [allBookings, setAllBookings] = useState([]);
  const [allClientHabits, setAllClientHabits] = useState([]);
  const [dashboardMessages, setDashboardMessages] = useState([]);
  const [loadingDashMessages, setLoadingDashMessages] = useState(false);
  const [clientsFocus, setClientsFocus] = useState(null);
  const [scansFocusId, setScansFocusId] = useState(null);
  const [profileName, setProfileName] = useState('');
  const { theme, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  

  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) {
      setProfileName('');
      return;
    }
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setProfileName(d.name || d.displayName || '');
      }
    });
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'inbody_scans'), orderBy('scanDate', 'desc'));
    const unsub = onSnapshot(q, (snap) => setAllScans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('date', 'asc'));
    const unsub = onSnapshot(q, (snap) => setAllBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'client_habits'), (snap) => {
      setAllClientHabits(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

    const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pwNew.length < 6) {
      setPwError('New password must be at least 6 characters.');
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(pwCurrent, pwNew);
      setPwOpen(false);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      alert('Password updated. Use it next time you sign in.');
    } catch (err) {
      const msg =
        err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential'
          ? 'Current password is incorrect.'
          : err.message || 'Could not update password';
      setPwError(msg);
    } finally {
      setPwSaving(false);
    }
  };

  const myClients = clients.filter((c) => {
    if ((c.status || 'active') !== 'active') return false;
    const coachName = String(c.coach || '').trim().toLowerCase();
    if (!coachName || coachName === 'unassigned' || coachName === 'none') return false;
    if (currentUserRole === 'Owner') return true;
    return c.coachId && currentUser?.uid && c.coachId === currentUser.uid;
  });

  const myRoster = clients.filter((c) => {
    if (currentUserRole === 'Owner') return true;
    return c.coachId && currentUser?.uid && c.coachId === currentUser.uid;
  });
  const myClientIds = new Set(myRoster.map((c) => c.id));
  const myClientPhones = new Set(
    myRoster.map((c) => String(c.phone || '').replace(/\D/g, '')).filter((p) => p.length >= 7)
  );

  const isMyScan = (s) => {
    if (currentUserRole === 'Owner') return true;
    if (s.clientId && myClientIds.has(s.clientId)) return true;
    const sp = String(s.phone || '').replace(/\D/g, '');
    return sp && [...myClientPhones].some((cp) => cp.endsWith(sp) || sp.endsWith(cp));
  };

  const activeClientCount = myClients.length;

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const scansThisWeek = allScans.filter((s) => {
    const d = parseScanDate(s.scanDate);
    return d && d.getTime() >= oneWeekAgo && isMyScan(s);
  }).length;

  const recentScans = [...allScans]
    .filter(isMyScan)
    .sort((a, b) => (parseScanDate(b.scanDate)?.getTime() || 0) - (parseScanDate(a.scanDate)?.getTime() || 0))
    .slice(0, 8);

  const myUpcoming = allBookings
    .filter((b) => {
      const when = new Date(b.date + 'T' + (b.time || '00:00'));
      if (when < new Date()) return false;
      if (currentUserRole === 'Owner') return true;
      return myClientIds.has(b.clientId);
    })
    .slice(0, 5);

  const myHabits = allClientHabits.filter(
    (h) => h.status === 'active' && myClientIds.has(h.clientId)
  );

  const coachSummary = {};
  myClients.forEach((c) => {
    const name = String(c.coach || '').trim();
    if (!name || name.toLowerCase() === 'unassigned') return;
    coachSummary[name] = (coachSummary[name] || 0) + 1;
  });

  useEffect(() => {
    if (currentNavView !== 'dashboard') return;

    const loadRecentMessages = async () => {
      setLoadingDashMessages(true);
      try {
        const coachName =
          currentUserRole === 'Owner'
            ? null
            : (currentUser?.displayName || currentUser?.email || '');
            

        const withGhl = clients
          .filter((c) => {
            const id = c.ghlContactId || c.ghlId || c.ghl || c.contactId;
            const isActive = (c.status || 'active') === 'active';
            const hasGhl = id && id !== 'N/A' && !String(id).startsWith('dummy');
            if (!isActive || !hasGhl) return false;
            if (currentUserRole === 'Owner' || !currentUser?.uid) return true;
            return c.coachId === currentUser.uid;
            const assigned = (c.coach || '').toLowerCase();
            return assigned === coachName.toLowerCase() || assigned.includes(coachName.toLowerCase().split('@')[0]);
          })
          .slice(0, 5);

        const allMsgs = [];
        for (const c of withGhl) {
          const ghlId = c.ghlContactId || c.ghlId || c.ghl || c.contactId;
          const params = new URLSearchParams();
          params.append('contactId', ghlId);
          if (c.email) params.append('email', c.email);
          if (c.phone) params.append('phone', c.phone);
          try {
            const res = await fetch(
              `https://us-central1-swarm-nutrition-app.cloudfunctions.net/getGhlContactDetails?${params.toString()}`
            );
            if (!res.ok) continue;
            const data = await res.json();
            const msgs = Array.isArray(data?.messages) ? data.messages : [];
            msgs.slice(0, 3).forEach((m) => {
              allMsgs.push({ ...m, clientName: c.name, clientId: c.id });
            });
          } catch (e) {
            console.error('Dash msg fetch error', c.name, e);
          }
        }

        allMsgs.sort((a, b) => {
          const da = new Date(a.dateAdded || a.createdAt || a.date || 0).getTime();
          const db = new Date(b.dateAdded || b.createdAt || b.date || 0).getTime();
          return db - da;
        });
        setDashboardMessages(allMsgs.slice(0, 10));
      } finally {
        setLoadingDashMessages(false);
      }
    };



    loadRecentMessages();
  }, [currentNavView, clients, currentUser, currentUserRole]);

  const openClient = (clientId, tab) => {
    if (!clientId) {
      setCurrentNavView('clients');
      return;
    }
    setClientsFocus({ clientId, tab });
    setCurrentNavView('clients');
  };
   return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

         <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-12 flex items-center gap-3 px-3 bg-slate-900 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="p-2 rounded-lg bg-slate-800 text-white text-lg leading-none shrink-0"
          aria-label="Open menu"
        >
          ☰
        </button>
        <img
          src="/Bee_BlackYellowWhite.png"
          alt=""
          className="w-7 h-7 object-contain shrink-0"
        />
        <span className="font-bold text-white text-sm truncate">Swarm Nutrition</span>
      </div>

      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-50
          w-64 max-w-[85vw] shrink-0
          bg-slate-900 border-r border-slate-800
          flex flex-col justify-between p-4
          transition-transform duration-200 ease-out
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        <div>
          <div className="flex items-center gap-3 px-2 py-3 mb-6">
            <img
              src="/Bee_BlackYellowWhite.png"
              alt="Swarm"
              className="w-8 h-8 rounded-lg object-contain"
            />
            <h1 className="text-lg font-extrabold tracking-wide text-white">Swarm Nutrition</h1>
          </div>
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setCurrentNavView('dashboard');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                currentNavView === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📊</span> Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentNavView('clients');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                currentNavView === 'clients'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>👥</span> Clients
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentNavView('calendar');
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                currentNavView === 'calendar'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📅</span> Calendar
            </button>
          <button
  onClick={() => {
    setCurrentNavView('scans');
    setMobileNavOpen(false);
  }}
  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
    currentNavView === 'scans'
      ? 'bg-blue-600 text-white shadow-md'
      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
  }`}
>
  <span>📋</span> Scans
</button>
            {currentUserRole === 'Owner' && (
              <button
                type="button"
                onClick={() => {
                  setCurrentNavView('staff');
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  currentNavView === 'staff'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <span>👤</span> Staff
              </button>
            )}
            {currentUserRole === 'Owner' && (
              <button
                type="button"
                onClick={() => {
                  setCurrentNavView('payroll');
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentNavView === 'payroll'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>💰</span>
                <span>Payroll</span>
              </button>
            )}
          </nav>
        </div>

                <div className="mt-auto pt-3 border-t border-slate-800 space-y-2">
          <div className="min-w-0 px-1">
            <div className="text-sm font-bold text-white truncate">
              {profileName || currentUser?.displayName || 'User'}
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-semibold">
                {currentUserRole}
              </span>
            </div>
          <div className="text-[11px] text-slate-500 truncate mt-0.5">
  {currentUser?.email}
</div>
<AppVersion />
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              className="flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-[10px] font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80"
            >
              <span className="text-sm leading-none">{theme === 'dark' ? '☀️' : '🌙'}</span>
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPwError('');
                setPwOpen(true);
              }}
              title="Change password"
              className="flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-[10px] font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80"
            >
              <span className="text-sm leading-none">🔑</span>
              <span>Password</span>
            </button>
            <button
              type="button"
              onClick={() => logout()}
              title="Log out"
              className="flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-[10px] font-semibold bg-slate-800/80 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-700/80"
            >
              <span className="text-sm leading-none">↩</span>
              <span>Log out</span>
            </button>
          </div>
        </div>
      </aside>

            <div className="flex-1 min-w-0 min-h-0 overflow-hidden pt-12 md:pt-0 flex flex-col">
        {currentNavView === 'dashboard' && (
          <main className="p-6 space-y-6 flex-1 min-h-0 overflow-y-auto">
            <div>
              <h2 className="text-2xl font-black text-white">Dashboard</h2>
              <p className="text-xs text-slate-400 mt-1">
                {currentUserRole === 'Owner' ? 'Swarm Nutrition overview' : 'Your clients overview'}
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Active Clients</div>
                <div className="text-3xl font-black text-white mt-1">{activeClientCount}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Scans This Week</div>
                <div className="text-3xl font-black text-blue-400 mt-1">{scansThisWeek}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Upcoming Appts</div>
                <div className="text-3xl font-black text-emerald-400 mt-1">{myUpcoming.length}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Active Habits</div>
                <div className="text-3xl font-black text-purple-400 mt-1">{myHabits.length}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                  Upcoming Appointments
                </h3>
                {myUpcoming.length === 0 ? (
                  <div className="text-xs text-slate-500 py-6 text-center">No upcoming appointments</div>
                ) : (
                  <div className="space-y-2">
                    {myUpcoming.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => openClient(b.clientId, 'appointments')}
                        className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs cursor-pointer hover:border-blue-500/50 transition-colors"
                      >
                        <div className="font-bold text-white">{b.clientName}</div>
                        <div className="text-slate-400 mt-0.5">
                          {b.date} at {b.time} · {b.appointmentTypeName || 'Appointment'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Recent Messages</h3>
                  <button
                    type="button"
                    onClick={() => setCurrentNavView('clients')}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    Open Clients →
                  </button>
                </div>
                {loadingDashMessages ? (
                  <div className="text-xs text-slate-500 py-6 text-center">Loading messages...</div>
                ) : dashboardMessages.length === 0 ? (
                  <div className="text-xs text-slate-500 py-6 text-center">
                    No recent messages. Clients need a valid GHL ID.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dashboardMessages.map((m, idx) => {
                      const isClientMsg =
                        m.direction === 'inbound' || m.type === 1 || m.direction === 'in';
                      return (
                        <div
                          key={idx}
                          onClick={() => openClient(m.clientId, 'messages')}
                          className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs cursor-pointer hover:border-blue-500/50 transition-colors"
                        >
                          <div className="flex justify-between items-center gap-2 mb-1">
                            <span className="font-bold text-white">{m.clientName}</span>
                            <span className="text-[10px] text-slate-500">
                              {formatDate(m.dateAdded || m.createdAt || m.date)}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] shrink-0">{isClientMsg ? '📱' : '💬'}</span>
                            <p className="text-slate-300 line-clamp-2">
                              {m.body || m.message || m.text || '[Attachment]'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Recent Scans</h3>
                <button
                  type="button"
                  onClick={() => setCurrentNavView('clients')}
                  className="text-xs text-blue-400 hover:underline"
                >
                  View clients →
                </button>
              </div>
              {recentScans.length === 0 ? (
                <div className="text-xs text-slate-500 py-6 text-center">No recent scans</div>
              ) : (
                <div className="space-y-2">
                  {recentScans.map((scan) => (
                    <div
                      key={scan.id}
                      onClick={() => {
                        if (scan.clientId) openClient(scan.clientId, 'inbody');
                        else if (currentUserRole === 'Owner') {
                          setScansFocusId(scan.id);
                          setCurrentNavView('scans');
                        }
                      }}
                      className="flex justify-between items-center p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs cursor-pointer hover:border-blue-500/50 transition-colors"
                    >
                      <div>
                        <div className="font-bold text-white">
                          {toTitleCase(scan.clientName || scan.name || 'Unknown')}
                        </div>
                        <div className="text-slate-500 mt-0.5">{formatDate(scan.scanDate)}</div>
                      </div>
                      <div className="flex gap-4 text-right">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase">Weight</div>
                          <div className="font-bold text-slate-200">
                            {scan.weight > 0 ? scan.weight : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase">SMM</div>
                          <div className="font-bold text-blue-400">
                            {scan.smm > 0 ? scan.smm : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase">BF%</div>
                          <div className="font-bold text-purple-400">
                            {scan.pbf > 0 ? `${scan.pbf}%` : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {currentUserRole === 'Owner' && Object.keys(coachSummary).length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                  Active Clients by Coach
                </h3>
                <div className="space-y-3">
                  {Object.entries(coachSummary)
                    .sort((a, b) => b[1] - a[1])
                    .map(([coach, count]) => (
                      <div key={coach} className="flex justify-between items-center">
                        <span className="text-sm text-slate-300">{coach}</span>
                        <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-600/20 text-blue-400">
                          {count}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </main>
        )}
        {pwOpen && (
  <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
    <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-white">Change password</h3>
        <button type="button" onClick={() => setPwOpen(false)} className="text-slate-400 hover:text-white text-xl">
          ×
        </button>
      </div>
      {pwError && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
          {pwError}
        </div>
      )}
      <form onSubmit={handleChangePassword} className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 font-medium">Current password</label>
          <input
            type="password"
            required
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 font-medium">New password</label>
          <input
            type="password"
            required
            minLength={6}
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 font-medium">Confirm new password</label>
          <input
            type="password"
            required
            minLength={6}
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setPwOpen(false)}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pwSaving}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white disabled:opacity-50"
          >
            {pwSaving ? 'Saving…' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}

        {currentNavView === 'clients' && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <Clients focus={clientsFocus} onFocusConsumed={() => setClientsFocus(null)} />
          </div>
        )}
        {currentNavView === 'calendar' && (
          <Calendar clients={clients} ghlAppointments={[]} selectedClient={null} />
        )}
       {currentNavView === 'scans' && (
  <Scans focusScanId={scansFocusId} onFocusConsumed={() => setScansFocusId(null)} />
)}
        {currentNavView === 'staff' && currentUserRole === 'Owner' && (
          <main className="flex-1 min-h-0 overflow-y-auto bg-slate-950">
            <UserManagement />
          </main>
        )}
        {currentNavView === 'payroll' && currentUserRole === 'Owner' && <PayrollShell />}
      </div>
    </div>
  );
}