import React, { useState } from 'react';
import {
  writeBatch,
  doc,
} from 'firebase/firestore';
import { masterDb } from '../masterFirebase';

const parseCsvLine = (text) => {
  const result = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ''));
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ''));
  return result;
};

const parseNum = (val) => {
  if (!val || val === '-') return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const cleanStr = (val) => {
  if (!val || val === '-') return '';
  return String(val).trim();
};

const normalizeHeader = (h) =>
  String(h || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/%/g, ' pct ').replace(/[()/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function pick(row, ...needles) {
  const entries = Object.entries(row || {}).map(([k, v]) => [normalizeHeader(k), v, k]);
  for (const needle of needles) {
    const n = normalizeHeader(needle);
    const exact = entries.find(([k]) => k === n);
    if (exact) return exact[1];
  }
  for (const needle of needles) {
    const n = normalizeHeader(needle);
    const hit = entries.find(([k]) => k.includes(n) || n.includes(k));
    if (hit) return hit[1];
  }
  return '';
}

function parseInBodyDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4] || '00'}:${compact[5] || '00'}:${compact[6] || '00'}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const dotted = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dotted) {
    const iso = `${dotted[1]}-${dotted[2].padStart(2, '0')}-${dotted[3].padStart(2, '0')}T${(dotted[4] || '00').padStart(2, '0')}:${dotted[5] || '00'}:${dotted[6] || '00'}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function datetimeKey(raw, iso) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.length >= 12) return s.slice(0, 14).padEnd(14, '0');
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }
  }
  return '';
}

export default function AdminInBodyUploadModal({ isOpen, onClose, clients = [], onComplete }) {
  const [rawText, setRawText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [statusMsg, setStatusMsg] = useState('');

  if (!isOpen) return null;

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setRawText(evt.target.result);
    reader.readAsText(file);
  };

  const handleProcessImport = async () => {
    if (!rawText.trim()) return;

    setIsUploading(true);
    setStatusMsg('Parsing LookinBody CSV records...');

    try {
      const lines = rawText.trim().split('\n').filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setStatusMsg('Error: Invalid CSV format or empty file.');
        setIsUploading(false);
        return;
      }

      const headers = parseCsvLine(lines[0]);
      const rows = lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const rowObj = {};
        headers.forEach((h, i) => {
          rowObj[h] = values[i] || '';
        });
        return rowObj;
      });

      // Upsert only: same phone/id + test time overwrites that doc. Never deletes the collection.

      const totalRows = rows.length;
      setProgress({ current: 0, total: totalRows });

      const chunkSize = 400;
      let processed = 0;
      let skipped = 0;

      for (let i = 0; i < totalRows; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const batch = writeBatch(masterDb);

        chunk.forEach((row) => {
          const rawName = cleanStr(pick(row, 'name'));
          const rawId = cleanStr(pick(row, 'id', 'user id', 'userid'));
          const rawPhone = cleanStr(pick(row, 'mobile number', 'phone number', 'telhp', 'phone'));
          const cleanPhone = rawPhone.replace(/\D/g, '');
          const rawEmail = cleanStr(pick(row, 'e-mail', 'email'));
          const rawDate = pick(row, 'test date / time', 'testdatetimes', 'test date', 'date of registration');
          const scanDate = parseInBodyDate(rawDate);
          const key = datetimeKey(rawDate, scanDate);
          const docKey = `${cleanPhone || rawId || 'na'}_${key || 'nodate'}`;

          if (!cleanPhone && !rawId) {
            skipped += 1;
            return;
          }

          let matchedClientId = null;
          let matchedClientName = rawName;

          const matched = clients.find((c) => {
            const cPhone = String(c.phone || '').replace(/\D/g, '');
            const cEmail = String(c.email || '').toLowerCase();
            if (cleanPhone && cPhone && (cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone))) return true;
            if (rawEmail && cEmail && cEmail === rawEmail.toLowerCase()) return true;
            return false;
          });

          if (matched) {
            matchedClientId = matched.id;
            matchedClientName = matched.name || matchedClientName;
          }

          const scoreVal = parseNum(pick(row, 'inbody score', 'score'));
          const record = {
            clientId: matchedClientId,
            clientName: matchedClientName || `Member ${cleanPhone || rawId}`,
            phone: cleanPhone,
            memberId: rawId,
            email: rawEmail,
            gender: cleanStr(pick(row, 'm/f', 'gender')),
            age: parseNum(pick(row, 'age')),
            height: cleanStr(pick(row, 'height')),
            dateOfBirth: cleanStr(pick(row, 'date of birth')),
            scanDate: scanDate || new Date().toISOString(),
            weight: parseNum(pick(row, 'weight')),
            tbw: parseNum(pick(row, 'tbw total body water', 'total body water', 'tbw')),
            icw: parseNum(pick(row, 'icw intracellular water', 'intracellular water', 'icw')),
            ecw: parseNum(pick(row, 'ecw extracellular water', 'extracellular water', 'ecw')),
            ecwTbw: parseNum(pick(row, 'ecw tbw', 'ecw/tbw')),
            dlm: parseNum(pick(row, 'dlm dry lean mass', 'dry lean mass', 'dlm')),
            bfm: parseNum(pick(row, 'bfm body fat mass', 'body fat mass')),
            lbm: parseNum(pick(row, 'lbm lean body mass', 'lean body mass')),
            smm: parseNum(pick(row, 'smm skeletal muscle mass', 'skeletal muscle mass', 'smm')),
            bmi: parseNum(pick(row, 'bmi body mass index', 'body mass index', 'bmi')),
            pbf: parseNum(pick(row, 'pbf percent body fat', 'percent body fat', 'pbf')),
            bfmControl: parseNum(pick(row, 'bfm control')),
            lbmControl: parseNum(pick(row, 'lbm control')),
            bmr: parseNum(pick(row, 'bmr basal metabolic rate', 'basal metabolic rate', 'bmr')),
            visceralFat: parseNum(pick(row, 'vfl visceral fat level', 'visceral fat level', 'vfl')),
            smi: parseNum(pick(row, 'smi skeletal muscle index', 'skeletal muscle index', 'smi')),
            armCircumference: parseNum(pick(row, 'ac arm circumference', 'arm circumference')),
            inBodyType: cleanStr(pick(row, 'inbody type', 'equip')),
            segmentalLean: {
              rightArm: parseNum(pick(row, 'lbm of right arm')),
              leftArm: parseNum(pick(row, 'lbm of left arm')),
              trunk: parseNum(pick(row, 'lbm of trunk')),
              rightLeg: parseNum(pick(row, 'lbm of right leg')),
              leftLeg: parseNum(pick(row, 'lbm of left leg')),
            },
            segmentalLeanPct: {
              rightArm: parseNum(pick(row, 'lbm % of right arm', 'lbm% of right arm')),
              leftArm: parseNum(pick(row, 'lbm % of left arm', 'lbm% of left arm')),
              trunk: parseNum(pick(row, 'lbm % of trunk', 'lbm% of trunk')),
              rightLeg: parseNum(pick(row, 'lbm % of right leg', 'lbm% of right leg')),
              leftLeg: parseNum(pick(row, 'lbm % of left leg', 'lbm% of left leg')),
            },
            segmentalFat: {
              rightArm: parseNum(pick(row, 'bfm of right arm')),
              leftArm: parseNum(pick(row, 'bfm of left arm')),
              trunk: parseNum(pick(row, 'bfm of trunk')),
              rightLeg: parseNum(pick(row, 'bfm of right leg')),
              leftLeg: parseNum(pick(row, 'bfm of left leg')),
            },
            segmentalFatPct: {
              rightArm: parseNum(pick(row, 'bfm % of right arm', 'bfm% of right arm')),
              leftArm: parseNum(pick(row, 'bfm % of left arm', 'bfm% of left arm')),
              trunk: parseNum(pick(row, 'bfm % of trunk', 'bfm% of trunk')),
              rightLeg: parseNum(pick(row, 'bfm % of right leg', 'bfm% of right leg')),
              leftLeg: parseNum(pick(row, 'bfm % of left leg', 'bfm% of left leg')),
            },
            deviceSerial: cleanStr(pick(row, 'serial')),
            source: 'csv-upload',
            createdAt: new Date(),
          };
          if (scoreVal > 0) record.score = scoreVal;

          batch.set(doc(masterDb, 'inbody_scans', docKey), record, { merge: true });
        });

        await batch.commit();
        processed += chunk.length;
        setProgress({ current: processed, total: totalRows });
        setStatusMsg(`Saved ${processed} of ${totalRows} scan records...`);
      }

      setStatusMsg(`Success! Upserted ${totalRows - skipped} records${skipped ? ` (${skipped} skipped)` : ''} (existing same person+time updated, new ones added).`);
      setTimeout(() => {
        setIsUploading(false);
        if (onComplete) onComplete();
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Import Error:', err);
      setStatusMsg(`Upload Error: ${err.message}`);
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Upload Master LookinBody CSV</h2>
            <p className="text-xs text-slate-400">
              Safe upsert. Same person + test time updates that scan; new rows are added. Never wipes the database.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl p-3 leading-relaxed">
            Safe import: each row is keyed by <span className="text-slate-200 font-semibold">phone/ID + test date/time</span>.
            If that scan already exists it is <span className="text-slate-200 font-semibold">updated</span>; otherwise it is <span className="text-slate-200 font-semibold">added</span>.
            Nothing is bulk-deleted.
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Select InBody CSV (`InBodyExcelData_....csv`)
            </label>
            <input
              type="file"
              accept=".csv, .txt"
              onChange={handleFileUpload}
              className="w-full text-xs text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Or paste CSV
            </label>
            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste raw LookinBody CSV contents here..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          {statusMsg && (
            <div className={`p-3 rounded-xl text-xs font-medium ${statusMsg.startsWith('Error') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
              {statusMsg}
            </div>
          )}

          {isUploading && (
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6 border-t border-slate-800 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
            Cancel
          </button>
          <button
            onClick={handleProcessImport}
            disabled={isUploading || !rawText.trim()}
            className="px-5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold"
          >
            {isUploading ? 'Importing...' : 'Upload / Update Scans'}
          </button>
        </div>
      </div>
    </div>
  );
}