import React, { useState, useEffect, useCallback } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';

const FS_BASE =
  'https://us-central1-swarm-nutrition-app.cloudfunctions.net';

function isFatSecretConnected(c) {
  return !!(
    c?.fatsecretAuthToken &&
    (c?.fatsecretConnectedAt || c?.fatsecretAuthSecret)
  );
}

function last7Dates(endYmd) {
  const end = new Date(endYmd + 'T12:00:00');
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default function ClientFoodLog({ selectedClient, setSelectedClient }) {
  const [fsDiaryDate, setFsDiaryDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [fsWeek, setFsWeek] = useState([]);
  const [fsDiaryLoading, setFsDiaryLoading] = useState(false);
  const [fsLinking, setFsLinking] = useState(false);
  const [fsVerifier, setFsVerifier] = useState('');
  const [fsFinishing, setFsFinishing] = useState(false);
  const [fsAuthorizeUrl, setFsAuthorizeUrl] = useState('');
  const [fsError, setFsError] = useState('');
  const [mfpConnectOpen, setMfpConnectOpen] = useState(false);
  const [mfpConnectUsername, setMfpConnectUsername] = useState('');
  const [mfpSaving, setMfpSaving] = useState(false);

  const handleFatSecretLoadWeek = useCallback(
    async (endDate) => {
      if (!selectedClient?.id || !isFatSecretConnected(selectedClient)) return;
      const end = endDate || fsDiaryDate;
      setFsDiaryLoading(true);
      setFsError('');
      setFsWeek([]);
      try {
        const dates = last7Dates(end);
        const results = await Promise.all(
          dates.map(async (date) => {
            try {
              const res = await fetch(
                `${FS_BASE}/fatsecretGetDiary?clientId=${encodeURIComponent(
                  selectedClient.id
                )}&date=${encodeURIComponent(date)}`
              );
              const json = await res.json();
              if (!json.success) {
                return {
                  date,
                  totals: null,
                  entries: [],
                  error: json.error || 'fail',
                };
              }
              return {
                date,
                totals: json.totals,
                entries: json.entries || [],
              };
            } catch (e) {
              return { date, totals: null, entries: [], error: e.message };
            }
          })
        );
        setFsWeek(results);
      } finally {
        setFsDiaryLoading(false);
      }
    },
    [selectedClient, fsDiaryDate]
  );

  useEffect(() => {
    if (!selectedClient?.id) return;
    if (!isFatSecretConnected(selectedClient)) {
      setFsWeek([]);
      return;
    }
    handleFatSecretLoadWeek(fsDiaryDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id, selectedClient?.fatsecretAuthToken]);

  const handleFatSecretStartConnect = async () => {
    if (!selectedClient?.id) return;
    setFsLinking(true);
    setFsError('');
    setFsAuthorizeUrl('');
    try {
      const res = await fetch(
        `${FS_BASE}/fatsecretStartConnect?clientId=${encodeURIComponent(
          selectedClient.id
        )}`
      );
      const json = await res.json();
      if (!json.success || !json.authorizeUrl) {
        setFsError(json.error || 'Could not start connect');
        return;
      }
      setFsAuthorizeUrl(json.authorizeUrl);
      window.open(json.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setFsError(e.message);
    } finally {
      setFsLinking(false);
    }
  };

  const handleFatSecretFinishConnect = async () => {
    if (!selectedClient?.id || !fsVerifier.trim()) {
      alert('Enter the PIN/code from FatSecret');
      return;
    }
    setFsFinishing(true);
    setFsError('');
    try {
      const res = await fetch(
        `${FS_BASE}/fatsecretFinishConnect?clientId=${encodeURIComponent(
          selectedClient.id
        )}&verifier=${encodeURIComponent(fsVerifier.trim())}`
      );
      const json = await res.json();
      if (!json.success) {
        setFsError(json.error || json.message || 'Finish connect failed');
        return;
      }
      const next = {
        ...selectedClient,
        fatsecretAuthToken: 'connected',
        fatsecretAuthSecret: 'connected',
        fatsecretConnectedAt: new Date(),
      };
      setSelectedClient(next);
      setFsVerifier('');
      setFsAuthorizeUrl('');
      // load week with updated connection flags
      setTimeout(() => handleFatSecretLoadWeek(fsDiaryDate), 100);
    } catch (e) {
      setFsError(e.message);
    } finally {
      setFsFinishing(false);
    }
  };

  const handleFatSecretDisconnect = async () => {
    if (!selectedClient?.id) return;
    if (!window.confirm('Disconnect FatSecret for this client?')) return;
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        fatsecretAuthToken: deleteField(),
        fatsecretAuthSecret: deleteField(),
        fatsecretConnectedAt: deleteField(),
        fatsecretOauthPending: deleteField(),
      });
      setSelectedClient({
        ...selectedClient,
        fatsecretAuthToken: null,
        fatsecretAuthSecret: null,
        fatsecretConnectedAt: null,
      });
      setFsWeek([]);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleCopyFatSecretLink = async () => {
    if (!fsAuthorizeUrl) {
      alert('Click Connect FatSecret first to generate a link');
      return;
    }
    try {
      await navigator.clipboard.writeText(fsAuthorizeUrl);
      alert('Link copied — paste it into a text to your client');
    } catch {
      window.prompt('Copy this link:', fsAuthorizeUrl);
    }
  };

  const handleDisconnectMfp = async () => {
    if (!selectedClient?.id) return;
    if (!window.confirm('Remove MyFitnessPal username for this client?')) return;
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        mfpUsername: deleteField(),
        updatedAt: new Date(),
      });
      setSelectedClient({ ...selectedClient, mfpUsername: '' });
    } catch (e) {
      alert(e.message);
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

  if (!selectedClient) return null;

  return (
    <>
      <div className="space-y-4">
        {/* MyFitnessPal */}
        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white mb-1">MyFitnessPal</h3>
              <p className="text-xs text-slate-400">
                Save their MFP username to open their diary. MFP does not allow
                automatic sync.
              </p>
            </div>
            {!!selectedClient.mfpUsername && (
              <button
                type="button"
                onClick={handleDisconnectMfp}
                className="text-[11px] font-bold text-slate-400 hover:text-red-400 shrink-0"
              >
                Disconnect
              </button>
            )}
          </div>

          {selectedClient.mfpUsername ? (
            <>
              <div className="text-[11px] font-bold text-emerald-400">
                Connected · {selectedClient.mfpUsername}
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://www.myfitnesspal.com/food/diary/${encodeURIComponent(
                    selectedClient.mfpUsername
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
                >
                  Open MFP diary ↗
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setMfpConnectUsername(selectedClient.mfpUsername || '');
                    setMfpConnectOpen(true);
                  }}
                  className="px-3 py-2 text-xs font-bold rounded-xl bg-slate-800 text-slate-300"
                >
                  Change username
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMfpConnectUsername('');
                setMfpConnectOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
            >
              Connect MyFitnessPal
            </button>
          )}
        </div>

        {/* FatSecret */}
        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white mb-1">FatSecret</h3>
              <p className="text-xs text-slate-400">
                Food logged in the client&apos;s FatSecret app (last 7 days).
              </p>
            </div>
            {isFatSecretConnected(selectedClient) && (
              <button
                type="button"
                onClick={handleFatSecretDisconnect}
                className="text-[11px] font-bold text-slate-400 hover:text-red-400"
              >
                Disconnect
              </button>
            )}
          </div>

          {!isFatSecretConnected(selectedClient) ? (
            <div className="space-y-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={handleFatSecretStartConnect}
                disabled={fsLinking}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50"
              >
                {fsLinking ? 'Starting…' : '1. Connect FatSecret'}
              </button>
              {fsAuthorizeUrl && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400">
                    Send this link to the client. They log into FatSecret, tap
                    Allow, then text you the PIN.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleCopyFatSecretLink}
                      className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
                    >
                      Copy link to text client
                    </button>
                    <a
                      href={fsAuthorizeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 text-blue-400 underline"
                    >
                      Open link here
                    </a>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={fsVerifier}
                  onChange={(e) => setFsVerifier(e.target.value)}
                  placeholder="2. PIN from FatSecret"
                  className="flex-1 min-w-[120px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={handleFatSecretFinishConnect}
                  disabled={fsFinishing || !fsVerifier.trim()}
                  className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  {fsFinishing ? '…' : '3. Submit PIN'}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-[11px] font-bold text-emerald-400">
              Connected
              {selectedClient.fatsecretUsername
                ? ` · ${selectedClient.fatsecretUsername}`
                : ''}
            </div>
          )}

          {isFatSecretConnected(selectedClient) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-slate-500">Week ending</span>
              <input
                type="date"
                value={fsDiaryDate}
                onChange={(e) => {
                  setFsDiaryDate(e.target.value);
                  handleFatSecretLoadWeek(e.target.value);
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => handleFatSecretLoadWeek(fsDiaryDate)}
                disabled={fsDiaryLoading}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {fsDiaryLoading ? 'Loading…' : 'Refresh week'}
              </button>
            </div>
          )}

          {fsError && <div className="text-xs text-amber-400">{fsError}</div>}

          {fsDiaryLoading && (
            <div className="text-xs text-slate-500">Loading 7 days…</div>
          )}

          {fsWeek.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(() => {
                  const sum = fsWeek.reduce(
                    (a, d) => ({
                      calories: a.calories + (d.totals?.calories || 0),
                      protein: a.protein + (d.totals?.protein || 0),
                      carbs: a.carbs + (d.totals?.carbs || 0),
                      fat: a.fat + (d.totals?.fat || 0),
                    }),
                    { calories: 0, protein: 0, carbs: 0, fat: 0 }
                  );
                  return [
                    ['Week kcal', Math.round(sum.calories)],
                    ['Protein', `${Math.round(sum.protein)} g`],
                    ['Carbs', `${Math.round(sum.carbs)} g`],
                    ['Fat', `${Math.round(sum.fat)} g`],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="p-2 rounded-xl bg-slate-950 border border-slate-800"
                    >
                      <div className="text-[10px] text-slate-500 uppercase">
                        {label}
                      </div>
                      <div className="text-sm font-black text-white">{val}</div>
                    </div>
                  ));
                })()}
              </div>

              <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                {fsWeek.map((day) => (
                  <div
                    key={day.date}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800"
                  >
                    <div className="flex justify-between items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-white">
                        {new Date(day.date + 'T12:00:00').toLocaleDateString(
                          'en-US',
                          {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          }
                        )}
                      </span>
                      <span className="text-xs text-slate-400">
                        {day.totals
                          ? `${day.totals.calories} kcal · P ${day.totals.protein}g`
                          : day.error || '—'}
                      </span>
                    </div>
                    {(day.entries || []).length === 0 ? (
                      <div className="text-[11px] text-slate-500">No entries</div>
                    ) : (
                      <ul className="space-y-0.5">
                        {day.entries.map((e) => (
                          <li
                            key={e.food_entry_id}
                            className="text-[11px] text-slate-300 flex justify-between gap-2"
                          >
                            <span className="truncate">
                              {e.meal ? `${e.meal}: ` : ''}
                              {e.food_entry_name || e.food_entry_description}
                            </span>
                            <span className="shrink-0 text-slate-500">
                              {e.calories} kcal
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {mfpConnectOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                MyFitnessPal username
              </h3>
              <button
                type="button"
                onClick={() => setMfpConnectOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Enter the username they use in MyFitnessPal (no @).
            </p>
            <input
              type="text"
              value={mfpConnectUsername}
              onChange={(e) => setMfpConnectUsername(e.target.value)}
              placeholder="logansmommy79"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMfpConnectOpen(false)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMfpUsername}
                disabled={mfpSaving}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white disabled:opacity-50"
              >
                {mfpSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}