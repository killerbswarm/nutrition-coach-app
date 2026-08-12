import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import PayrollDashboard from './PayrollDashboard';
import PayrollRun from './PayrollRun';
import PayrollSettings from './PayrollSettings';

const DEFAULT_CONFIG = {
  payNumerator: 4,
  payDenominator: 9,
  lookbackMonths: 18,
};

export default function PayrollShell() {
  const [tab, setTab] = useState('dashboard');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'payroll_settings', 'config'), (snap) => {
      if (!snap.exists()) {
        setConfig(DEFAULT_CONFIG);
        return;
      }
      const d = snap.data();
      setConfig({
        payNumerator: Number(d.payNumerator) || 4,
        payDenominator: Number(d.payDenominator) || 9,
        lookbackMonths: Number(d.lookbackMonths) || 18,
      });
    });
    return () => unsub();
  }, []);

  const tabBtn = (id, label) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
        tab === id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="flex-1 overflow-y-auto bg-slate-950 p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-white">Payroll</h2>
          <p className="text-xs text-slate-400 mt-1">
            Owner only · Share {config.payNumerator}/{config.payDenominator} · Staff 100%
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabBtn('dashboard', '📊 Dashboard')}
          {tabBtn('payroll', '📄 Run Payroll')}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {tab === 'dashboard' && <PayrollDashboard config={config} />}
      {tab === 'payroll' && <PayrollRun config={config} />}

      {showSettings && <PayrollSettings onClose={() => setShowSettings(false)} />}
    </main>
  );
}