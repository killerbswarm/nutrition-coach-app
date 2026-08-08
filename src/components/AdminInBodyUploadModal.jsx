import React, { useState } from 'react';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

// Helper: Parse robust CSV line handling quotes & commas
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
    reader.onload = (evt) => {
      setRawText(evt.target.result);
    };
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

      const totalRows = rows.length;
      setProgress({ current: 0, total: totalRows });

      const chunkSize = 400; // Firestore 500 max batch limit
      let processed = 0;

      for (let i = 0; i < totalRows; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((row) => {
          const rawName = cleanStr(row['1. Name']);
          const rawId = cleanStr(row['2. ID']);
          const rawPhone = cleanStr(row['7. Mobile Number'] || row['8. Phone Number']);
          const cleanPhone = rawPhone.replace(/\D/g, '');
          const rawEmail = cleanStr(row['11. E-mail']);

          // Attempt to match scan with an existing local client document
          let matchedClientId = null;
          let matchedClientName = rawName;

          const matched = clients.find((c) => {
            const cPhone = String(c.phone || '').replace(/\D/g, '');
            const cEmail = String(c.email || '').toLowerCase();
            const cGhl = String(c.ghlContactId || c.ghlId || '');

            if (cleanPhone && cPhone && (cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone))) return true;
            if (rawEmail && cEmail && cEmail === rawEmail.toLowerCase()) return true;
            if (rawId && cGhl && cGhl === rawId) return true;
            return false;
          });

          if (matched) {
            matchedClientId = matched.id;
            matchedClientName = matched.name || matchedClientName;
          }

          // Parse Scan Date
          const rawTestDate = row['14. Test Date / Time'] || row['12. Date of Registration'] || new Date().toISOString();
          let parsedScanDate = new Date().toISOString();
          try {
            const d = new Date(rawTestDate);
            if (!isNaN(d.getTime())) parsedScanDate = d.toISOString();
          } catch (e) {
            parsedScanDate = new Date().toISOString();
          }

          const scanRef = doc(collection(db, 'inbody_scans'));
          batch.set(scanRef, {
            clientId: matchedClientId,
            clientName: matchedClientName || `Member ${cleanPhone || rawId}`,
            phone: cleanPhone,
            memberId: rawId,
            email: rawEmail,
            gender: cleanStr(row['5. M/F']),
            age: parseNum(row['6. Age']),
            height: cleanStr(row['3. Height']),
            dateOfBirth: cleanStr(row['4. Date of Birth']),
            scanDate: parsedScanDate,
            weight: parseNum(row['15. Weight']),
            tbw: parseNum(row['16. TBW (Total Body Water)']),
            icw: parseNum(row['17. ICW (Intracellular Water)']),
            ecw: parseNum(row['18. ECW (Extracellular Water)']),
            dlm: parseNum(row['19. DLM (Dry Lean Mass)']),
            bfm: parseNum(row['20. BFM (Body Fat Mass)']),
            lbm: parseNum(row['21. LBM (Lean Body Mass)']),
            smm: parseNum(row['22. SMM (Skeletal Muscle Mass)']),
            bmi: parseNum(row['23. BMI (Body Mass Index)']),
            pbf: parseNum(row['24. PBF (Percent Body Fat)']),
            score: parseNum(row['47. InBody Score']),
            bfmControl: parseNum(row['48. BFM Control']),
            lbmControl: parseNum(row['49. LBM Control']),
            bmr: parseNum(row['50. BMR (Basal Metabolic Rate)']),
            visceralFat: cleanStr(row['51. VFL (Visceral Fat Level)']),
            smi: parseNum(row['75. SMI (Skeletal Muscle Index)']),
            segmentalLean: {
              rightArm: parseNum(row['25. LBM of Right Arm']),
              leftArm: parseNum(row['27. LBM of Left Arm']),
              trunk: parseNum(row['29. LBM of Trunk']),
              rightLeg: parseNum(row['31. LBM of Right Leg']),
              leftLeg: parseNum(row['33. LBM of Left Leg']),
            },
            segmentalFat: {
              rightArm: parseNum(row['37. BFM of Right Arm']),
              leftArm: parseNum(row['39. BFM of Left Arm']),
              trunk: parseNum(row['41. BFM of Trunk']),
              rightLeg: parseNum(row['43. BFM of Right Leg']),
              leftLeg: parseNum(row['45. BFM of Left Leg']),
            },
            deviceSerial: cleanStr(row['84. Serial']) || 'F92002283',
            createdAt: new Date(),
          });
        });

        await batch.commit();
        processed += chunk.length;
        setProgress({ current: processed, total: totalRows });
        setStatusMsg(`Saved ${processed} of ${totalRows} scan records...`);
      }

      setStatusMsg(`Success! Imported all ${totalRows} records into Firestore.`);
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
            <h2 className="text-lg font-bold text-white">Owner Admin: Upload Master LookinBody CSV</h2>
            <p className="text-xs text-slate-400">
              Bulk upload complete historical InBody scans into your Firestore database.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Option A: Select InBody CSV File (`InBodyExcelData_20260808.csv`)
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
              Option B: Paste Raw CSV Data
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
            {isUploading ? 'Importing Scans...' : 'Process & Upload All Scans'}
          </button>
        </div>
      </div>
    </div>
  );
}