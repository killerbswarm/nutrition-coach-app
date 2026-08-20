import React, { useState } from "react";

const formatDateFull = (dateVal) => {
  if (!dateVal) return "—";
  try {
    const d =
      typeof dateVal === "object" && dateVal.seconds
        ? new Date(dateVal.seconds * 1000)
        : new Date(dateVal);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

function n(v) {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtCtrl(v) {
  if (v === undefined || v === null || v === "") return "—";
  const x = parseFloat(v);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x} lbs`;
}


function Bar({ value, min, max, color = "#1e3a5f" }) {
  const pct = Math.max(0, Math.min(100, ((n(value) - min) / (max - min)) * 100));
  return (
    <div className="relative h-3 bg-[#e8e8e8] rounded-sm overflow-visible">
      <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${pct}%`, background: "#d4d4d4" }} />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-0 h-0"
        style={{
          left: `calc(${pct}% - 5px)`,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: `8px solid ${color}`,
        }}
      />
    </div>
  );
}

function Cell({ label, value, unit, wide }) {
  return (
    <div className={`border border-[#cfcfcf] px-2 py-1.5 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[9px] uppercase tracking-wide text-[#666]">{label}</div>
      <div className="text-sm font-bold text-[#111]">
        {value || value === 0 ? value : "—"}
        {unit ? <span className="text-[10px] font-normal text-[#666] ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}

function kgToLb(v) {
  return Math.round(n(v) * 2.20462 * 10) / 10;
}

function segLb(v, kind) {
  const x = n(v);
  if (x <= 0) return 0;
  if (kind === "arm" && x < 6) return kgToLb(x);
  if (kind === "leg" && x < 12) return kgToLb(x);
  if (kind === "trunk" && x < 40) return kgToLb(x);
  return Math.round(x * 10) / 10;
}

function SegRow({ label, lbs, pct, min = 70, max = 160 }) {
  const shown = n(lbs);
  return (
    <div className="grid grid-cols-[88px_1fr_64px] items-center gap-2 py-1">
      <div className="text-[11px] text-[#333]">{label}</div>
      <Bar value={n(pct) || 0} min={min} max={max} color="#b91c1c" />
      <div className="text-right text-[11px] font-semibold text-[#111] leading-tight">
        {shown ? `${shown.toFixed(2)} lb` : "—"}
        {n(pct) ? <div className="text-[9px] text-[#666] font-normal">{n(pct)}%</div> : null}
      </div>
    </div>
  );
}

export default function InBodyResultSheetModal({ scan, onClose, onDelete, canViewRaw }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!scan) return null;

  const w = n(scan.weight);
  const smm = n(scan.smm);
  const bfm = n(scan.bfm);
  const pbf = n(scan.pbf);
  const bmi = n(scan.bmi);
  const tbw = n(scan.tbw);
  const dlm = n(scan.dlm);
  const lbm = n(scan.lbm);
  const bmr = n(scan.bmr);
  const visceral = n(scan.visceralFat);
  const icw = n(scan.icw);
  const ecw = n(scan.ecw);
  const ecwTbw = n(scan.ecwTbw);
  const raw = scan.rawApi || {};
  const seg = scan.segmentalLean || {};
  const segPct = scan.segmentalLeanPct || {};
  const fat = scan.segmentalFat || {};
  const fatPct = scan.segmentalFatPct || {};

  const pctOrRaw = (stored, rawVal) => {
    const s = n(stored);
    const r = n(rawVal);
    if (s >= 50) return s;
    if (r >= 50) return r;
    return r || 0;
  };

  const massLb = (stored, rawKg, kind) => {
    const fromRaw = n(rawKg) ? kgToLb(rawKg) : 0;
    const s = n(stored);
    if (fromRaw && s && Math.abs(s - fromRaw * 2.20462) < 0.6) return fromRaw;
    if (fromRaw) return fromRaw;
    return s;
  };

  const lean = {
    rightArm: massLb(seg.rightArm, raw.LBMofRightArm, "arm"),
    leftArm: massLb(seg.leftArm, raw.LBMofLeftArm, "arm"),
    trunk: massLb(seg.trunk, raw.LBMofTrunk, "trunk"),
    rightLeg: massLb(seg.rightLeg, raw.LBMofRightLeg, "leg"),
    leftLeg: massLb(seg.leftLeg, raw.LBMofLeftLeg, "leg"),
  };
  const leanPct = {
    rightArm: pctOrRaw(segPct.rightArm, raw["LBM%ofRightArm"]),
    leftArm: pctOrRaw(segPct.leftArm, raw["LBM%ofLeftArm"]),
    trunk: pctOrRaw(segPct.trunk, raw["LBM%ofTrunk"]),
    rightLeg: pctOrRaw(segPct.rightLeg, raw["LBM%ofRightLeg"]),
    leftLeg: pctOrRaw(segPct.leftLeg, raw["LBM%ofLeftLeg"]),
  };
  const fatLb = {
    rightArm: massLb(fat.rightArm, raw.BFMofRightArm, "arm"),
    leftArm: massLb(fat.leftArm, raw.BFMofLeftArm, "arm"),
    trunk: massLb(fat.trunk, raw.BFMofTrunk, "trunk"),
    rightLeg: massLb(fat.rightLeg, raw.BFMofRightLeg, "leg"),
    leftLeg: massLb(fat.leftLeg, raw.BFMofLeftLeg, "leg"),
  };
  const fatP = {
    rightArm: pctOrRaw(fatPct.rightArm, raw["BFM%ofRightArm"]),
    leftArm: pctOrRaw(fatPct.leftArm, raw["BFM%ofLeftArm"]),
    trunk: pctOrRaw(fatPct.trunk, raw["BFM%ofTrunk"]),
    rightLeg: pctOrRaw(fatPct.rightLeg, raw["BFM%ofRightLeg"]),
    leftLeg: pctOrRaw(fatPct.leftLeg, raw["BFM%ofLeftLeg"]),
  };
  const type = scan.inBodyType || scan.deviceSerial || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 overflow-y-auto">
      <div className="relative w-full max-w-5xl my-4">
        <div className="sticky top-0 z-20 flex items-center justify-end gap-2 mb-2 py-2 bg-black/80 backdrop-blur">
          {canViewRaw && (
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-slate-200"
            >
              {showRaw ? "View sheet" : "View raw JSON"}
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(scan.id)}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-red-700 text-white"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-lg bg-white text-black">
            Close
          </button>
        </div>

        {showRaw && canViewRaw ? (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto max-h-[80vh]">
            <pre>{JSON.stringify(scan, null, 2)}</pre>
          </div>
        ) : (
          <div className="bg-white text-[#111] rounded-sm shadow-2xl overflow-hidden">
            <div className="flex items-end justify-between px-5 pt-4 pb-2 border-b-2 border-[#c8102e]">
              <div>
                <div className="text-3xl font-black tracking-tight" style={{ color: "#c8102e" }}>
                  InBody
                </div>
                <div className="text-[11px] text-[#666]">{scan.clientName || "Member"}</div>
              </div>
              <div className="text-xs font-semibold text-[#444]">[{type ? `InBody ${type}` : "InBody"}]</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-b border-[#ddd] text-[11px]">
              <div className="px-3 py-2 border-r border-[#eee]">
                <div className="text-[#888] uppercase text-[9px]">ID</div>
                <div className="font-bold">{scan.phone || scan.memberId || "—"}</div>
              </div>
              <div className="px-3 py-2 border-r border-[#eee]">
                <div className="text-[#888] uppercase text-[9px]">Height</div>
                <div className="font-bold">{scan.height || "—"}</div>
              </div>
              <div className="px-3 py-2 border-r border-[#eee]">
                <div className="text-[#888] uppercase text-[9px]">Age / Sex</div>
                <div className="font-bold">
                  {scan.age || "—"} {scan.gender ? `/ ${scan.gender}` : ""}
                </div>
              </div>
              <div className="px-3 py-2 md:col-span-2">
                <div className="text-[#888] uppercase text-[9px]">Test Date / Time</div>
                <div className="font-bold">{formatDateFull(scan.scanDate)}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-[1.15fr_0.85fr] gap-0">
              <div className="p-4 space-y-4 border-r border-[#eee]">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    Body Composition Analysis
                  </h3>
                  <div className="grid grid-cols-4 text-center">
                    <Cell label="ICW" value={icw || "—"} unit="lbs" />
                    <Cell label="ECW" value={ecw || "—"} unit="lbs" />
                    <Cell label="TBW" value={tbw || "—"} unit="lbs" wide />
                    <Cell label="Dry Lean" value={dlm || "—"} unit="lbs" />
                    <Cell label="Body Fat" value={bfm || "—"} unit="lbs" />
                    <Cell label="Lean Mass" value={lbm || "—"} unit="lbs" />
                    <Cell label="Weight" value={w || "—"} unit="lbs" />
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    Muscle-Fat Analysis
                  </h3>
                  <div className="space-y-2.5">
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span>Weight</span>
                        <span className="font-bold">{w || "—"} lbs</span>
                      </div>
                      <Bar value={w} min={80} max={280} />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span>SMM</span>
                        <span className="font-bold">{smm || "—"} lbs</span>
                      </div>
                      <Bar value={smm} min={30} max={130} color="#1d4ed8" />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span>Body Fat Mass</span>
                        <span className="font-bold">{bfm || "—"} lbs</span>
                      </div>
                      <Bar value={bfm} min={5} max={120} color="#7c3aed" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    Obesity Analysis
                  </h3>
                  <div className="space-y-2.5">
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span>BMI</span>
                        <span className="font-bold">{bmi || "—"}</span>
                      </div>
                      <Bar value={bmi} min={10} max={50} />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span>PBF</span>
                        <span className="font-bold">{pbf ? `${pbf}%` : "—"}</span>
                      </div>
                      <Bar value={pbf} min={5} max={55} color="#7c3aed" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    Segmental Lean Analysis
                  </h3>
                  <SegRow label="Right Arm" lbs={lean.rightArm} pct={leanPct.rightArm} min={55} max={205} />
                  <SegRow label="Left Arm" lbs={lean.leftArm} pct={leanPct.leftArm} min={55} max={205} />
                  <SegRow label="Trunk" lbs={lean.trunk} pct={leanPct.trunk} min={70} max={170} />
                  <SegRow label="Right Leg" lbs={lean.rightLeg} pct={leanPct.rightLeg} min={70} max={170} />
                  <SegRow label="Left Leg" lbs={lean.leftLeg} pct={leanPct.leftLeg} min={70} max={170} />
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    ECW/TBW Analysis
                  </h3>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span>ECW/TBW</span>
                    <span className="font-bold">{ecwTbw || "—"}</span>
                  </div>
                  <Bar value={ecwTbw} min={0.33} max={0.43} color="#0f766e" />
                </div>
              </div>

              <div className="p-4 space-y-4 bg-[#fafafa]">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    Body Fat - Lean Body Mass Control
                  </h3>
                  <div className="text-[12px] space-y-1">
                    <div className="flex justify-between">
                      <span>Body Fat Mass</span>
                      <span className="font-bold">{fmtCtrl(scan.bfmControl)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Lean Body Mass</span>
                      <span className="font-bold">{fmtCtrl(scan.lbmControl ?? scan.rawApi?.LBMControl ?? scan.rawApi?.["LBM Control"])}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#c8102e] mb-2">
                    Segmental Fat Analysis
                  </h3>
                  <SegRow label="Right Arm" lbs={fatLb.rightArm} pct={fatP.rightArm} min={50} max={200} />
                  <SegRow label="Left Arm" lbs={fatLb.leftArm} pct={fatP.leftArm} min={50} max={200} />
                  <SegRow label="Trunk" lbs={fatLb.trunk} pct={fatP.trunk} min={50} max={220} />
                  <SegRow label="Right Leg" lbs={fatLb.rightLeg} pct={fatP.rightLeg} min={50} max={200} />
                  <SegRow label="Left Leg" lbs={fatLb.leftLeg} pct={fatP.leftLeg} min={50} max={200} />
                </div>

                <div className="border border-[#ddd] p-3">
                  <div className="text-[9px] uppercase text-[#888]">Basal Metabolic Rate</div>
                  <div className="text-2xl font-black">{bmr || "—"} <span className="text-sm font-semibold">kcal</span></div>
                </div>

                <div className="border border-[#ddd] p-3">
                  <div className="text-[9px] uppercase text-[#888]">Visceral Fat Level</div>
                  <div className="text-2xl font-black">{visceral || "—"}</div>
                  <Bar value={visceral} min={1} max={20} color="#c8102e" />
                  <div className="flex justify-between text-[9px] text-[#888] mt-1">
                    <span>Low</span>
                    <span>10</span>
                    <span>High</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}