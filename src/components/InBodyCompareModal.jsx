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

const get = (scan, key) => {
  if (!key.includes('.')) return num(scan?.[key]);
  return key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), scan);
};

const fmt = (v, unit, digits) => {
  const n = num(v);
  if (!n) return '—';
  return `${n.toFixed(digits)}${unit}`;
};

const DiffBadge = ({ a, b, higherIsBetter = false, unit = '', digits = 1 }) => {
  const diff = num(b) - num(a);
  if (!num(a) && !num(b)) return <span className="text-slate-500 text-xs">—</span>;
  if (Math.abs(diff) < 0.0005) return <span className="text-slate-500 text-xs">—</span>;
  const isGood = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span className={`text-xs font-bold ${isGood ? 'text-emerald-400' : 'text-amber-400'}`}>
      {diff > 0 ? '+' : ''}{diff.toFixed(digits)}{unit}
    </span>
  );
};

function MetricRow({ label, a, b, unit, higherIsBetter, digits = 1 }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-center bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3">
      <div className="text-right text-lg font-black text-slate-100">{fmt(a, unit, digits)}</div>
      <div className="text-center">
        <div className="text-xs text-slate-400 mb-0.5">{label}</div>
        <DiffBadge a={a} b={b} higherIsBetter={higherIsBetter} unit={unit.trim()} digits={digits} />
      </div>
      <div className="text-left text-lg font-black text-slate-100">{fmt(b, unit, digits)}</div>
    </div>
  );
}

export default function InBodyCompareModal({ scanA, scanB, onClose }) {
  if (!scanA || !scanB) return null;

  const dateA = new Date(scanA.scanDate || 0).getTime();
  const dateB = new Date(scanB.scanDate || 0).getTime();
  const older = dateA <= dateB ? scanA : scanB;
  const newer = dateA <= dateB ? scanB : scanA;

  const metrics = [
    { key: 'weight', label: 'Weight', unit: ' lbs', higherIsBetter: false },
    { key: 'smm', label: 'Muscle (SMM)', unit: ' lbs', higherIsBetter: true },
    { key: 'pbf', label: 'Body Fat %', unit: '%', higherIsBetter: false },
    { key: 'bfm', label: 'Body Fat Mass', unit: ' lbs', higherIsBetter: false },
    { key: 'bmi', label: 'BMI', unit: '', higherIsBetter: false },
    { key: 'tbw', label: 'Total Body Water', unit: ' lbs', higherIsBetter: true },
    { key: 'icw', label: 'Intracellular Water', unit: ' lbs', higherIsBetter: true },
    { key: 'ecw', label: 'Extracellular Water', unit: ' lbs', higherIsBetter: false },
    { key: 'ecwTbw', label: 'ECW / TBW', unit: '', higherIsBetter: false, digits: 3 },
    { key: 'bmr', label: 'BMR', unit: ' kcal', higherIsBetter: true, digits: 0 },
  ];

  const leanParts = [
    { key: 'segmentalLean.rightArm', label: 'Right Arm Lean' },
    { key: 'segmentalLean.leftArm', label: 'Left Arm Lean' },
    { key: 'segmentalLean.trunk', label: 'Trunk Lean' },
    { key: 'segmentalLean.rightLeg', label: 'Right Leg Lean' },
    { key: 'segmentalLean.leftLeg', label: 'Left Leg Lean' },
  ];
  const fatParts = [
    { key: 'segmentalFat.rightArm', label: 'Right Arm Fat' },
    { key: 'segmentalFat.leftArm', label: 'Left Arm Fat' },
    { key: 'segmentalFat.trunk', label: 'Trunk Fat' },
    { key: 'segmentalFat.rightLeg', label: 'Right Leg Fat' },
    { key: 'segmentalFat.leftLeg', label: 'Left Leg Fat' },
  ];

  const wDiff = num(newer.weight) - num(older.weight);
  const mDiff = num(newer.smm) - num(older.smm);
  const fatMassDiff = num(newer.bfm) - num(older.bfm);
  const fatPctDiff = num(newer.pbf) - num(older.pbf);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl text-slate-100 overflow-hidden my-6">
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

        <div className="p-6 max-h-[80vh] overflow-y-auto">
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

          <div className="space-y-2">
            {metrics.map((m) => (
              <MetricRow
                key={m.key}
                label={m.label}
                a={get(older, m.key)}
                b={get(newer, m.key)}
                unit={m.unit}
                higherIsBetter={m.higherIsBetter}
                digits={m.digits ?? 1}
              />
            ))}
          </div>

          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-8 mb-3">
            Segmental Lean Analysis
          </h3>
          <div className="space-y-2">
            {leanParts.map((m) => (
              <MetricRow
                key={m.key}
                label={m.label}
                a={get(older, m.key)}
                b={get(newer, m.key)}
                unit=" lbs"
                higherIsBetter
                digits={2}
              />
            ))}
          </div>

          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-8 mb-3">
            Segmental Fat Analysis
          </h3>
          <div className="space-y-2">
            {fatParts.map((m) => (
              <MetricRow
                key={m.key}
                label={m.label}
                a={get(older, m.key)}
                b={get(newer, m.key)}
                unit=" lbs"
                higherIsBetter={false}
                digits={2}
              />
            ))}
          </div>

          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Weight Change</div>
              <div className={`text-base font-black mt-1 ${wDiff <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {wDiff > 0 ? '+' : ''}{wDiff.toFixed(1)} lbs
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Muscle Change</div>
              <div className={`text-base font-black mt-1 ${mDiff >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {mDiff > 0 ? '+' : ''}{mDiff.toFixed(1)} lbs
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Body Fat Change</div>
              <div className={`text-base font-black mt-1 ${fatMassDiff <= 0 ? 'text-emerald-400' : 'text-purple-400'}`}>
                {fatMassDiff > 0 ? '+' : ''}{fatMassDiff.toFixed(1)} lbs
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-500 uppercase font-bold text-[10px]">Body Fat % Change</div>
              <div className={`text-base font-black mt-1 ${fatPctDiff <= 0 ? 'text-emerald-400' : 'text-purple-400'}`}>
                {fatPctDiff > 0 ? '+' : ''}{fatPctDiff.toFixed(1)}%
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