import React, { useState } from 'react';

const formatDateFull = (dateVal) => {
  if (!dateVal) return 'Unknown Date';
  try {
    if (typeof dateVal === 'object' && dateVal.seconds) {
      return new Date(dateVal.seconds * 1000).toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
      });
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Unknown Date';
    return d.toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    });
  } catch (err) {
    return 'Unknown Date';
  }
};

export default function InBodyResultSheetModal({ scan, onClose, onDelete }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!scan) return null;

  const formattedDate = formatDateFull(scan.scanDate);
  const w = parseFloat(scan.weight) || 0;
  const smm = parseFloat(scan.smm) || 0;
  const bfm = parseFloat(scan.bfm) || 0;
  const pbf = parseFloat(scan.pbf) || 0;
  const bmi = parseFloat(scan.bmi) || 0;
  const score = parseFloat(scan.score) || 0;
  const tbw = parseFloat(scan.tbw) || 0;
  const bmr = parseFloat(scan.bmr) || 0;
  const visceral = parseFloat(scan.visceralFat) || 0;
  const seg = scan.segmentalLean || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl text-slate-100 overflow-hidden my-8">
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white">{scan.clientName || 'InBody Member Scan'}</h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {scan.deviceSerial || 'InBody 270/570'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Phone / ID: <span className="text-slate-200 font-mono">{scan.phone || 'N/A'}</span> | Tested: {formattedDate}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              {showRaw ? 'View Report Sheet' : 'View Raw JSON'}
            </button>
            {onDelete && (
              <button
                onClick={() => onDelete(scan.id)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-colors"
              >
                Delete Scan
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              ✕
            </button>
          </div>
        </div>

        {/* BODY CONTENT */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {showRaw ? (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto">
              <pre>{JSON.stringify(scan, null, 2)}</pre>
            </div>
          ) : (
            <>
              {/* TOP CARDS */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">InBody Score</span>
                  <div className="text-3xl font-extrabold text-amber-400 mt-1">
                    {score > 0 ? score : '--'} <span className="text-sm font-normal text-slate-400">/ 100</span>
                  </div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Weight</span>
                  <div className="text-3xl font-extrabold text-slate-100 mt-1">{w > 0 ? `${w} lbs` : '--'}</div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Muscle (SMM)</span>
                  <div className="text-3xl font-extrabold text-blue-400 mt-1">{smm > 0 ? `${smm} lbs` : '--'}</div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-center">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Body Fat %</span>
                  <div className="text-3xl font-extrabold text-purple-400 mt-1">{pbf > 0 ? `${pbf}%` : '--'}</div>
                </div>
              </div>

              {/* MUSCLE-FAT ANALYSIS */}
              <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
                  Muscle-Fat Analysis
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Weight</span>
                    <span className="font-semibold text-slate-200">{w} lbs</span>
                  </div>
                  <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
                    <div className="bg-slate-400 h-full rounded-full" style={{ width: `${Math.min((w / 300) * 100, 100)}%` }}></div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Skeletal Muscle Mass (SMM)</span>
                    <span className="font-semibold text-blue-400">{smm} lbs</span>
                  </div>
                  <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.min((smm / 150) * 100, 100)}%` }}></div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Body Fat Mass (BFM)</span>
                    <span className="font-semibold text-purple-400">{bfm} lbs</span>
                  </div>
                  <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
                    <div className="bg-purple-500 h-full rounded-full" style={{ width: `${Math.min((bfm / 120) * 100, 100)}%` }}></div>
                  </div>
                </div>
              </div>

              {/* METRICS GRID */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
                    Obesity Analysis
                  </h3>
                  <div className="flex justify-between items-center text-sm py-1 border-b border-slate-900">
                    <span className="text-slate-400">BMI</span>
                    <span className="font-bold text-slate-200">{bmi > 0 ? bmi : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm py-1 border-b border-slate-900">
                    <span className="text-slate-400">Percent Body Fat</span>
                    <span className="font-bold text-purple-400">{pbf > 0 ? `${pbf}%` : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm py-1">
                    <span className="text-slate-400">Visceral Fat Level</span>
                    <span className="font-bold text-amber-400">{visceral > 0 ? `Level ${visceral}` : 'Normal'}</span>
                  </div>
                </div>

                <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
                    Metabolic & Hydration
                  </h3>
                  <div className="flex justify-between items-center text-sm py-1 border-b border-slate-900">
                    <span className="text-slate-400">BMR</span>
                    <span className="font-bold text-emerald-400">{bmr > 0 ? `${bmr} kcal` : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm py-1 border-b border-slate-900">
                    <span className="text-slate-400">Total Body Water</span>
                    <span className="font-bold text-sky-400">{tbw > 0 ? `${tbw} lbs` : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm py-1">
                    <span className="text-slate-400">Fat Free Mass</span>
                    <span className="font-bold text-slate-200">{w > 0 && bfm > 0 ? `${(w - bfm).toFixed(1)} lbs` : '--'}</span>
                  </div>
                </div>
              </div>

              {/* SEGMENTAL LEAN */}
              <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
                  Segmental Lean Analysis
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                    <span className="text-[11px] font-medium text-slate-400 uppercase">Right Arm</span>
                    <div className="text-base font-bold text-blue-400 mt-1">{seg.rightArm > 0 ? `${seg.rightArm} lbs` : '--'}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                    <span className="text-[11px] font-medium text-slate-400 uppercase">Left Arm</span>
                    <div className="text-base font-bold text-blue-400 mt-1">{seg.leftArm > 0 ? `${seg.leftArm} lbs` : '--'}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                    <span className="text-[11px] font-medium text-slate-400 uppercase">Trunk</span>
                    <div className="text-base font-bold text-blue-400 mt-1">{seg.trunk > 0 ? `${seg.trunk} lbs` : '--'}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                    <span className="text-[11px] font-medium text-slate-400 uppercase">Right Leg</span>
                    <div className="text-base font-bold text-blue-400 mt-1">{seg.rightLeg > 0 ? `${seg.rightLeg} lbs` : '--'}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                    <span className="text-[11px] font-medium text-slate-400 uppercase">Left Leg</span>
                    <div className="text-base font-bold text-blue-400 mt-1">{seg.leftLeg > 0 ? `${seg.leftLeg} lbs` : '--'}</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-800 bg-slate-950 px-6 py-3">
          <button onClick={onClose} className="px-5 py-2 text-sm font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors">
            Close Sheet
          </button>
        </div>
      </div>
    </div>
  );
}