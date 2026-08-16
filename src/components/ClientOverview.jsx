import React, { useMemo } from 'react';

function formatDate(dateVal) {
  if (!dateVal) return '';
  try {
    let d;
    if (typeof dateVal === 'object' && dateVal.seconds) {
      d = new Date(dateVal.seconds * 1000);
    } else if (dateVal instanceof Date) {
      d = dateVal;
    } else {
      d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function ClientOverview({
  selectedClient,
  clientScans = [],
  clientBookings = [],
  clientMeasurements = [],
  clientPhotos = [],
  clientHabits = [],
  messages = [],
  onNavigateTab,
}) {
  const setActiveTab = (id) => {
    if (typeof onNavigateTab === 'function') onNavigateTab(id);
  };

  const latestScan = clientScans[0] || null;
  const prevScan = clientScans[1] || null;

  const nextAppt = useMemo(() => {
    const now = new Date();
    return [...clientBookings]
      .filter((b) => {
        const t = new Date(`${b.date}T${b.time || '00:00'}`);
        return t >= now;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  }, [clientBookings]);

  const latestMeasurement = clientMeasurements[0] || null;
  const latestPhoto = clientPhotos[0] || null;

  const lastMessage = useMemo(() => {
    const msgs = Array.isArray(messages) ? messages : [];
    if (!msgs.length) return null;
    const sorted = [...msgs].sort((a, b) => {
      const ta = new Date(
        a.dateAdded || a.createdAt || a.timestamp || a.date || 0
      ).getTime();
      const tb = new Date(
        b.dateAdded || b.createdAt || b.timestamp || b.date || 0
      ).getTime();
      return tb - ta;
    });
    return sorted[0];
  }, [messages]);

  const activeHabitsList = useMemo(
    () => clientHabits.filter((h) => (h.status || 'active') === 'active'),
    [clientHabits]
  );

  if (!selectedClient) return null;

  return (
<div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Status</div>
                      <div className="text-lg font-black text-white mt-1 capitalize">
                        {selectedClient.status || 'active'}
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Coach</div>
                      <div className="text-lg font-black text-white mt-1 truncate">
                        {selectedClient.coach || 'Unassigned'}
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Scans</div>
                      <div className="text-lg font-black text-blue-400 mt-1">{clientScans.length}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Active habits */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('habits')}
                      className="w-full text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-bold text-slate-500 uppercase">
                          Active habits ({activeHabitsList.length})
                        </div>
                        <span className="text-[10px] font-bold text-blue-400">View all →</span>
                      </div>

                      {activeHabitsList.length === 0 ? (
                        <div className="text-sm text-slate-500">No active habits assigned</div>
                      ) : (
                        <ul className="space-y-1.5">
                          {activeHabitsList.slice(0, 6).map((h) => (
                            <li
                              key={h.id}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span className="font-semibold text-white truncate">
                                {h.name || h.habitName || h.title || 'Habit'}
                              </span>
                              <span className="text-[10px] text-slate-500 shrink-0">
                                {h.weeksAssigned ? `${h.weeksAssigned}w` : ''}
                              </span>
                            </li>
                          ))}
                          {activeHabitsList.length > 6 && (
                            <li className="text-xs text-slate-500">
                              +{activeHabitsList.length - 6} more
                            </li>
                          )}
                        </ul>
                      )}
                    </button>
                    {/* Latest InBody */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('inbody')}
                      className="text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600"
                    >
                      <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Latest InBody</div>
                      {latestScan ? (
                        <div className="space-y-1">
                          <div className="text-xs text-slate-400">{formatDate(latestScan.scanDate)}</div>
                          <div className="flex flex-wrap gap-3 text-sm">
                            <span className="font-black text-white">{latestScan.weight > 0 ? `${latestScan.weight} lbs` : '—'}</span>
                            <span className="font-black text-blue-400">{latestScan.smm > 0 ? `${latestScan.smm} SMM` : '—'}</span>
                            <span className="font-black text-purple-400">{latestScan.pbf > 0 ? `${latestScan.pbf}% BF` : '—'}</span>
                          </div>
                          {prevScan && latestScan.weight > 0 && prevScan.weight > 0 && (
                            <div className="text-xs text-slate-400 mt-1">
                              vs prior:{' '}
                              <span className={latestScan.weight - prevScan.weight <= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                                {`${latestScan.weight - prevScan.weight > 0 ? '+' : ''}${(latestScan.weight - prevScan.weight).toFixed(1)} lbs`}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500">No scans yet</div>
                      )}
                    </button>

                    {/* Next appointment */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('appointments')}
                      className="text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600"
                    >
                      <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Next appointment</div>
                      {nextAppt ? (
                        <div>
                          <div className="text-sm font-black text-white">{nextAppt.date} · {nextAppt.time}</div>
                          <div className="text-xs text-slate-400 mt-1">
                            {nextAppt.appointmentTypeName || 'Appointment'}
                            {nextAppt.roomName ? ` · ${nextAppt.roomName}` : ''}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500">None upcoming</div>
                      )}
                    </button>

                    {/* Latest measurement */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('measurements')}
                      className="text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600"
                    >
                      <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Latest measurements</div>
                      {latestMeasurement ? (
                        <div>
                          <div className="text-xs text-slate-400">{latestMeasurement.date}</div>
                          <div className="flex flex-wrap gap-3 text-sm mt-1">
                            {latestMeasurement.waist != null && (
                              <span className="font-bold text-white">Waist {latestMeasurement.waist}</span>
                            )}
                            {latestMeasurement.hips != null && (
                              <span className="font-bold text-white">Hips {latestMeasurement.hips}</span>
                            )}
                            {latestMeasurement.chest != null && (
                              <span className="font-bold text-white">Chest {latestMeasurement.chest}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500">No measurements yet</div>
                      )}
                    </button>

                    {/* SMS / MFP / Photo */}
                    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                      <button
                        type="button"
                        onClick={() => setActiveTab('messages')}
                        className="w-full text-left"
                      >
                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Last SMS</div>
                        {lastMessage ? (
                          <div>
                            <div className="text-xs text-slate-300 line-clamp-3">
                              {String(
                                lastMessage.body ||
                                lastMessage.message ||
                                lastMessage.text ||
                                lastMessage.msg ||
                                'Message'
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {lastMessage.dateAdded || lastMessage.createdAt || lastMessage.date || ''}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-slate-500">No messages loaded</div>
                        )}
                      </button>

                      {selectedClient.mfpUsername ? (
                        <a
                          href={`https://www.myfitnesspal.com/food/diary/${encodeURIComponent(selectedClient.mfpUsername)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex text-xs font-bold text-blue-400 hover:text-blue-300"
                        >
                          Open MFP diary ↗
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveTab('foodlog')}
                          className="text-xs font-bold text-slate-500"
                        >
                          Add MFP username →
                        </button>
                      )}

                      {latestPhoto && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('photos')}
                          className="flex items-center gap-2 w-full text-left"
                        >
                          <img
                            src={latestPhoto.url}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover border border-slate-700"
                          />
                          <div className="text-xs text-slate-400">
                            Latest photo · {latestPhoto.takenAt}
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
  );
}