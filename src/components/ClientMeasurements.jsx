import React, { useState } from 'react';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

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




export default function ClientMeasurements({ selectedClient, clientMeasurements = [] }) {
  const [measurementForm, setMeasurementForm] = useState(emptyMeasurementForm());
  const [isMeasurementFormOpen, setIsMeasurementFormOpen] = useState(false);
  const [savingMeasurement, setSavingMeasurement] = useState(false);
  const [selectedMeasurement, setSelectedMeasurement] = useState(null);
  const [compareMeasurements, setCompareMeasurements] = useState([]);
  const [isMeasurementCompareOpen, setIsMeasurementCompareOpen] = useState(false);

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

  if (!selectedClient) return null;

  return (
    <>

      <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-300">
                      Body measurements ({clientMeasurements.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setMeasurementForm(emptyMeasurementForm());
                        setIsMeasurementFormOpen(true);
                      }}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      + Log measurements
                    </button>
                    <button
                      type="button"
                      disabled={compareMeasurements.length !== 2}
                      onClick={() => setIsMeasurementCompareOpen(true)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white disabled:opacity-40"
                    >
                      Compare ({compareMeasurements.length}/2)
                    </button>
                  </div>

                  {isMeasurementFormOpen && (
                    <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
                      <div>
                        <label className="text-xs text-slate-400 font-medium">Date</label>
                        <input
                          type="date"
                          value={measurementForm.date}
                          onChange={(e) =>
                            setMeasurementForm({ ...measurementForm, date: e.target.value })
                          }
                          className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                        />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {MEASUREMENT_FIELDS.map((f) => (
                          <div key={f.key}>
                            <label className="text-xs text-slate-400 font-medium">{f.label}</label>
                            <input
                              type="number"
                              step="0.25"
                              inputMode="decimal"
                              value={measurementForm[f.key]}
                              onChange={(e) =>
                                setMeasurementForm({ ...measurementForm, [f.key]: e.target.value })
                              }
                              placeholder="in"
                              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 font-medium">Notes</label>
                        <input
                          type="text"
                          value={measurementForm.notes}
                          onChange={(e) =>
                            setMeasurementForm({ ...measurementForm, notes: e.target.value })
                          }
                          className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setIsMeasurementFormOpen(false)}
                          className="flex-1 py-2 text-sm font-semibold rounded-xl bg-slate-800 text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveMeasurement}
                          disabled={savingMeasurement}
                          className="flex-1 py-2 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                        >
                          {savingMeasurement ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}

                  {clientMeasurements.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-sm text-slate-400">
                      No measurements logged yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {clientMeasurements.map((m) => (
                        <div
                          key={m.id}
                          className="bg-slate-900 border border-slate-800 p-4 rounded-2xl"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <button
                              type="button"
                              onClick={() => setSelectedMeasurement(m)}
                              className="text-left flex-1 min-w-0"
                            >
                              <div className="text-xs font-semibold text-blue-400 hover:text-blue-300">
                                {m.date} · View on body →
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCompareMeasurement(m);
                              }}
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${compareMeasurements.some((x) => x.id === m.id)
                                ? 'bg-blue-600 text-white border-blue-500'
                                : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                                }`}
                            >
                              {compareMeasurements.some((x) => x.id === m.id) ? '✓ Compare' : '+ Compare'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMeasurement(m.id)}
                              className="p-1 text-slate-400 hover:text-red-400 text-xs"
                            >
                              🗑️
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedMeasurement(m)}
                            className="w-full text-left"
                          >
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                              {MEASUREMENT_FIELDS.map((f) =>
                                m[f.key] != null && m[f.key] !== '' ? (
                                  <div key={f.key}>
                                    <span className="text-[10px] text-slate-500 uppercase font-bold mr-1">
                                      {f.label}
                                    </span>
                                    <span className="font-bold text-slate-100">{m[f.key]}</span>
                                  </div>
                                ) : null
                              )}
                            </div>
                            {m.notes ? (
                              <p className="text-xs text-slate-500 mt-2">{m.notes}</p>
                            ) : null}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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
    </>
  );
}