import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';

const DEFAULTS = {
  payNumerator: 4,
  payDenominator: 9,
  lookbackMonths: 18,
};

export default function PayrollSettings({ onClose }) {
  const [form, setForm] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'payroll_settings', 'config'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setForm({
          payNumerator: Number(d.payNumerator) || 4,
          payDenominator: Number(d.payDenominator) || 9,
          lookbackMonths: Number(d.lookbackMonths) || 18,
        });
      }
    });
    return () => unsub();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    const num = Number(form.payNumerator);
    const den = Number(form.payDenominator);
    const look = Number(form.lookbackMonths);

    if (!num || num < 1 || !den || den < 1) {
      return alert('Numerator and denominator must be positive numbers');
    }
    if (!look || look < 1 || look > 60) {
      return alert('Lookback months should be between 1 and 60');
    }

    setSaving(true);
    setMsg('');
    try {
      await setDoc(
        doc(db, 'payroll_settings', 'config'),
        {
          payNumerator: num,
          payDenominator: den,
          lookbackMonths: look,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setMsg('Saved');
      if (onClose) setTimeout(onClose, 600);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-white">Payroll Settings</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Coach share = gross × (numerator ÷ denominator). Staff perk stays 100%. Owners stay $0
          contractor payout.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium">Pay numerator</label>
              <input
                type="number"
                min="1"
                value={form.payNumerator}
                onChange={(e) => setForm({ ...form, payNumerator: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium">Pay denominator</label>
              <input
                type="number"
                min="1"
                value={form.payDenominator}
                onChange={(e) => setForm({ ...form, payDenominator: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          <div className="text-sm text-slate-300">
            Current ratio:{' '}
            <span className="font-bold text-emerald-400">
              {form.payNumerator}/{form.payDenominator}
            </span>{' '}
            (
            {(
              (Number(form.payNumerator) / Number(form.payDenominator || 1)) *
              100
            ).toFixed(1)}
            % to coach)
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium">Month lookback</label>
            <input
              type="number"
              min="1"
              max="60"
              value={form.lookbackMonths}
              onChange={(e) => setForm({ ...form, lookbackMonths: e.target.value })}
              className={inputClass}
            />
            <p className="text-[10px] text-slate-500 mt-1">
              How many months appear in the Run Payroll period dropdown
            </p>
          </div>

          {msg && <div className="text-xs text-emerald-400 font-bold">{msg}</div>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}