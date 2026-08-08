import React from 'react';

const formatDateFull = (dateVal) => {
  if (!dateVal) return 'Unknown Date';
  try {
    if (typeof dateVal === 'object' && dateVal.seconds) {
      return new Date(dateVal.seconds * 1000).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Unknown Date';
    return d.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return 'Unknown Date';
  }
};

const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const DiffBadge = ({ a, b, higherIsBetter = false, unit = '' }) => {
  const diff = num(b) - num(a);
  if (diff === 0) return <span className="text-slate-500 text-xs">—</span>;

  const isGood = higherIsBetter ? diff > 0 : diff < 0;
  const color = isGood ? 'text-emerald-400' : 'text-amber-400';

  return (
    <span className={`text-xs font-bold ${color}`}>
      {diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}
    </span>
  );
};

export default function InBodyCompareModal({ scanA, scanB, onClose }) {
  if (!scanA || !scanB) return null;

  // Ensure older is on the left
  const dateA = new Date(scanA.scanDate || 0).getTime();
  const dateB = new Date(scanB.scanDate || 0).getTime();
  const older = dateA <= dateB ? scanA : scanB;
  const newer = dateA <= dateB ? scanB : scanA;

  const metrics = [
    { key: 'weight', label: 'Weight', unit: ' lbs', higherIsBetter: false },
    { key: 'smm', label: 'Muscle (SMM)', unit: ' lbs', higherIsBetter: true },
    { key: 'pbf', label: 'Body Fat %', unit: '%', higherIsBetter: false },
    { key: 'bfm', label: 'Body Fat Mass', unit: ' lbs', higherIsBetter: false },
    { key: 'score', label: 'InBody Score', unit: '', higherIsBetter: true },
    { key: 'bmi', label: 'BMI', unit: '', higherIsBetter: false },
    { key: 'tbw', label: 'Total Body Water', unit: ' lbs', higherIsBetter: true },
    { key: 'bmr', label: 'BMR', unit: ' kcal', higherIsBetter: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl text-slate-100 overflow-hidden my-6">
        
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-white">Compare InBody Scans</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {older.clientName || 'Client'} — Side-by-side comparison
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          
          {/* DATE HEADERS */}
          <div className="grid grid-cols-3 gap-4 mb-6 text-center">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] uppercase text-slate-500 font-bold">Older Scan</div>
              <div className="text-sm font-bold text-slate-200 mt-1">{formatDateFull(older.scanDate)}</div>
            </div>
            <div className="flex items-center justify-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Change</span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] uppercase text-slate-500 font-bold">Newer Scan</div>
              <div className="text-sm font-bold text-slate-200 mt-1">{formatDateFull(newer.scanDate)}</div>
            </div>
          </div>

          {/* METRICS TABLE */}
          <div className="space-y-2">
            {metrics.map((m) => {
              const aVal = num(older[m.key]);
              const bVal = num(newer[m.key]);
              return (
                <div
                  key={m.key}
                  className="grid grid-cols-3 gap-4 items-center bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3"
                >
                  <div className="text-right">
                    <span className="text-lg font-black text-slate-100">
                      {aVal > 0 ? `${aVal}${m.unit}` : '—'}
                    </span>
                  </div>

                  <div className="text-center">
                    <div className="text-xs text-slate-400 mb-0.5">{m.label}</div>
                    <DiffBadge a={aVal} b={bVal} higherIsBetter={m.higherIsBetter} unit={m.unit.trim()} />
                  </div>

                  <div className="text-left">
                    <span className="text-lg font-black text-slate-100">
                      {bVal > 0 ? `${bVal}${m.unit}` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* QUICK SUMMARY */}
          <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Weight Change</div>
              <div className={`text-base font-black mt-1 ${num(newer.weight) - num(older.weight) <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {(num(newer.weight) - num(older.weight)).toFixed(1)} lbs
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Muscle Change</div>
              <div className={`text-base font-black mt-1 ${num(newer.smm) - num(older.smm) >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {(num(newer.smm) - num(older.smm)).toFixed(1)} lbs
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Body Fat % Change</div>
              <div className={`text-base font-black mt-1 ${num(newer.pbf) - num(older.pbf) <= 0 ? 'text-emerald-400' : 'text-purple-400'}`}>
                {(num(newer.pbf) - num(older.pbf)).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-800 bg-slate-950 px-6 py-3">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
}