import React, { useState } from 'react';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import InBodyResultSheetModal from './InBodyResultSheetModal';
import InBodyCompareModal from './InBodyCompareModal';


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
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};


function InBodyProgressChart({ scans }) {
  const [metric, setMetric] = useState('weight');
  const [labelMode, setLabelMode] = useState(null);
  if (!scans || scans.length === 0) return null;
  const sortedScans = [...scans].sort((a, b) => (parseScanDate(a.scanDate)?.getTime() ?? 0) - (parseScanDate(b.scanDate)?.getTime() ?? 0));
  if (sortedScans.length < 2) return <div className="text-xs text-slate-400 text-center py-4">Log at least 2 scans to view progress trends.</div>;
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const resolvedLabels = labelMode || (sortedScans.length <= 8 ? 'full' : 'limited');
  const firstScan = sortedScans[0];
  const latestScan = sortedScans[sortedScans.length - 1];
  const weightDiff = (num(latestScan.weight) - num(firstScan.weight)).toFixed(1);
  const smmDiff = (num(latestScan.smm) - num(firstScan.smm)).toFixed(1);
  const pbfDiff = (num(latestScan.pbf) - num(firstScan.pbf)).toFixed(1);
  const metricConfigs = {
    weight: { label: 'Weight', color: '#3b82f6', getValue: (s) => num(s.weight) },
    smm: { label: 'Muscle (SMM)', color: '#10b981', getValue: (s) => num(s.smm) },
    pbf: { label: 'Body Fat %', color: '#a855f7', getValue: (s) => num(s.pbf) },
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
  const labeled = new Set();
  if (resolvedLabels === 'full') {
    points.forEach((_, idx) => labeled.add(idx));
  } else if (resolvedLabels === 'limited') {
    labeled.add(0);
    labeled.add(points.length - 1);
    let hi = 0;
    let lo = 0;
    points.forEach((p, idx) => {
      if (p.val >= points[hi].val) hi = idx;
      if (p.val <= points[lo].val) lo = idx;
    });
    labeled.add(hi);
    labeled.add(lo);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs w-fit">
          {Object.keys(metricConfigs).map((key) => (
            <button key={key} onClick={() => setMetric(key)} className={`px-3 py-1.5 font-bold rounded-lg transition-all ${metric === key ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>{metricConfigs[key].label}</button>
          ))}
        </div>
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs w-fit">
          {[
            { id: 'full', label: 'Full labels' },
            { id: 'limited', label: 'Limited' },
            { id: 'none', label: 'None' },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setLabelMode(opt.id)}
              className={`px-2.5 py-1.5 font-bold rounded-lg transition-all ${resolvedLabels === opt.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
              <circle cx={p.x} cy={p.y} r={labeled.has(idx) ? 4 : 2.5} fill="#0f172a" stroke={config.color} strokeWidth="2" />
              {labeled.has(idx) && p.val > 0 && (
                <text x={p.x} y={p.y - 9} fill="#e2e8f0" fontSize="9" fontWeight="bold" textAnchor="middle">
                  {Number(p.val).toFixed(1)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      {resolvedLabels === 'limited' && (
        <p className="text-[10px] text-slate-500 text-center">Showing first, latest, high, and low.</p>
      )}
    </div>
  );
}

const handleDeleteScan = async (id) => {
  if (!canManage) return;
  if (!window.confirm('Delete this scan?')) return;
  try {
    await deleteDoc(doc(db, 'inbody_scans', id));
    if (selectedScan?.id === id) setSelectedScan(null);
    setCompareScans((p) => p.filter((s) => s.id !== id));
  } catch (err) {
    alert(err.message);
  }
};


export default function ClientInBody({ selectedClient, clientScans = [], canManage = false }) {
  const [selectedScan, setSelectedScan] = useState(null);
  const [compareScans, setCompareScans] = useState([]);
  const [isChartOpen, setIsChartOpen] = useState(true);
  const [isCompareMode, setIsCompareMode] = useState(false);

  const handleDeleteScan = async (id) => {
    if (!window.confirm('Delete this scan?')) return;
    try {
      await deleteDoc(doc(db, 'inbody_scans', id));
      if (selectedScan?.id === id) setSelectedScan(null);
      setCompareScans((p) => p.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleCompareScan = (scan) => {
    setCompareScans((prev) => {
      if (prev.find((s) => s.id === scan.id)) return prev.filter((s) => s.id !== scan.id);
      if (prev.length >= 2) return [prev[1], scan];
      return [...prev, scan];
    });
  };

  if (!selectedClient) return null;

  return (
    <>
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setIsChartOpen(!isChartOpen)}
            className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-800/50"
          >
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Progress Trends ({clientScans.length} Scans)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Click to {isChartOpen ? 'collapse' : 'expand'} chart
              </p>
            </div>
            <span className="text-slate-400 text-lg">{isChartOpen ? '−' : '+'}</span>
          </button>
          {isChartOpen && (
            <div className="px-5 pb-5">
              <InBodyProgressChart scans={clientScans} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-300">
            All Scans ({clientScans.length})
          </h3>
          <button
            type="button"
            onClick={() => {
              setIsCompareMode(!isCompareMode);
              if (isCompareMode) setCompareScans([]);
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg ${isCompareMode
                ? 'bg-slate-700 text-white'
                : 'bg-blue-600/20 text-blue-400'
              }`}
          >
            {isCompareMode ? 'Cancel Compare' : 'Compare'}
          </button>
        </div>

        {clientScans.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-sm text-slate-400">
            No InBody scans logged yet.
          </div>
        ) : (
          <div className="space-y-3">
            {clientScans.map((scan) => {
              const isSelected = compareScans.some((s) => s.id === scan.id);
              return (
                <div
                  key={scan.id}
                  className={`bg-slate-900 border p-4 rounded-2xl flex items-center gap-4 ${isSelected
                      ? 'border-blue-500 ring-1 ring-blue-500/40'
                      : 'border-slate-800 hover:border-slate-700'
                    }`}
                >
                  {isCompareMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCompareScan(scan)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 cursor-pointer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-400 mb-1">
                      {formatDate(scan.scanDate)}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold mr-1">
                          Weight
                        </span>
                        <span className="font-black text-slate-100">
                          {scan.weight > 0 ? `${scan.weight} lbs` : '--'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold mr-1">
                          Muscle
                        </span>
                        <span className="font-black text-blue-400">
                          {scan.smm > 0 ? `${scan.smm} lbs` : '--'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold mr-1">
                          Body Fat
                        </span>
                        <span className="font-black text-purple-400">
                          {scan.pbf > 0 ? `${scan.pbf}%` : '--'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedScan(scan)}
                        className="px-3 py-1.5 text-xs font-bold rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                      >
                        View Sheet
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleDeleteScan(scan.id)}
                          className="p-1.5 text-slate-400 hover:text-red-400"
                        >
                          🗑️
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedScan && (
        <InBodyResultSheetModal
          scan={selectedScan}
          onClose={() => setSelectedScan(null)}
          onDelete={canManage ? handleDeleteScan : undefined}
        />
      )}
      {compareScans.length === 2 && (
        <InBodyCompareModal
          scanA={compareScans[0]}
          scanB={compareScans[1]}
          onClose={() => {
            setCompareScans([]);
            setIsCompareMode(false);
          }}
        />
      )}
    </>
  );
}