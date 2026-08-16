import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, onSnapshot as onDocSnapshot } from 'firebase/firestore';
import { doc as fsDoc } from 'firebase/firestore';
import { resolveClient, displayClientName, normName } from '../utils/resolveClient';
import { getPayrollAmount, isMixedRetailPackage } from '../utils/payrollAmounts';

const DEFAULT_CONFIG = { payNumerator: 4, payDenominator: 9 };

export default function StaffPayouts({ selectedCoachName, onClose }) {
  const [coaches, setCoaches] = useState([]);
  const [roster, setRoster] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [clients, setClients] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const selectedCoach = (selectedCoachName || '').trim();


  useEffect(() => {
    const unsubU = onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || data.email || 'Unnamed',
          isOwner: data.role === 'owner' || data.isOwner === true,
          ...data,
        };
      });
      setCoaches(list);
    });

    const unsubR = onSnapshot(collection(db, 'roster'), (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        map[d.id] = d.data();
      });
      setRoster(map);
    });

    const unsubT = onSnapshot(collection(db, 'transactions'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      setTransactions(list);
    });

    const unsubC = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubCfg = onSnapshot(fsDoc(db, 'payroll_settings', 'config'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setConfig({
          payNumerator: Number(d.payNumerator) || 4,
          payDenominator: Number(d.payDenominator) || 9,
        });
      }
    });

    return () => {
      unsubU();
      unsubR();
      unsubT();
      unsubC();
      unsubCfg();
    };
  }, []);

  const calculateCoachPay = (amt = 0, coachName = '', isStaff = false) => {
    amt = Number(amt) || 0;
    const coach = coaches.find(
      (c) => (c.name || '').trim().toLowerCase() === (coachName || '').trim().toLowerCase()
    );
    if (coach && coach.isOwner) return 0;
    if (isStaff) return amt;
    if (amt === 49.5) return 21.98;
    if (
      amt === 99 &&
      (config.payNumerator || 4) === 4 &&
      (config.payDenominator || 9) === 9
    ) {
      return 43.96;
    }
    const ratio = (config.payNumerator || 4) / (config.payDenominator || 9);
    return Math.round(amt * ratio * 100) / 100;
  };

  
  const coachObj =
    coaches.find((c) => c.name === selectedCoach) || {
      name: selectedCoach,
      isOwner: false,
    };

  const assignedFromRoster = Object.entries(roster).filter(
    ([, info]) =>
      (info.coach || '').trim().toLowerCase() ===
      (selectedCoach || '').trim().toLowerCase()
  );

  const assignedFromClients = clients.filter((c) => {
    const byName =
      (c.coach || '').trim().toLowerCase() ===
      (selectedCoach || '').trim().toLowerCase();
    const byId = coachObj.id && c.coachId === coachObj.id;
    return byName || byId;
  });

  const coachTxs = transactions.filter(
    (t) =>
      (t.coach || '').trim().toLowerCase() ===
      (selectedCoach || '').trim().toLowerCase()
  );

  // Build assigned client names (dedupe short vs full names)
  const rawNames = [];

  assignedFromClients.forEach((c) => {
    if (c.name?.trim()) rawNames.push(c.name.trim());
  });

  coachTxs.forEach((tx) => {
    if (tx.client?.trim()) rawNames.push(tx.client.trim());
  });

  assignedFromRoster.forEach(([name]) => {
    if (name?.trim()) rawNames.push(name.trim());
  });

  const byCanonical = new Map();
  rawNames.forEach((raw) => {
    const canonical = displayClientName(raw, clients);
    const key = normName(canonical);
    if (!key) return;
    if (!byCanonical.has(key)) byCanonical.set(key, canonical);
  });

  const assignedNames = [...byCanonical.values()].sort((a, b) =>
    a.localeCompare(b)
  );

  // Dynamic last 2 calendar months + lifetime
  const now = new Date();
  const m0 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const m1 = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };

  let month0Total = 0;
  let month1Total = 0;
  let lifetimeTotal = 0;

  coachTxs.forEach((tx) => {
    const amt = getPayrollAmount(tx);
    const isStaff = tx.isStaff || (roster[tx.client] && roster[tx.client].isStaff);
    const pay = calculateCoachPay(amt, tx.coach || selectedCoach, isStaff);
    lifetimeTotal += pay;
    if (tx.date?.startsWith(m0)) month0Total += pay;
    if (tx.date?.startsWith(m1)) month1Total += pay;
  });

  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Staff Payout & Client History</h2>
          <p className="text-xs text-slate-400">
            Select a coach to view roster clients and itemized payouts
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase">Selected Coach</span>
          <div className="text-xl font-bold text-white mt-1">{selectedCoach || '—'}</div>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-slate-400 border border-slate-800 p-4 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase">{monthLabel(m1)} Payout</span>
          <div className="text-xl font-bold text-white mt-1">${month1Total.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-amber-500 border border-slate-800 p-4 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase">{monthLabel(m0)} Payout</span>
          <div className="text-xl font-bold text-amber-500 mt-1">${month0Total.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-emerald-500 border border-slate-800 p-4 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase">Lifetime Earned</span>
          <div className="text-xl font-bold text-emerald-400 mt-1">${lifetimeTotal.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-0.5">{coachTxs.length} transactions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Roster */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-white">Assigned Clients</h3>
            <span className="text-xs font-semibold text-blue-400 bg-blue-500/10 px-2.5 py-0.5 rounded-full">
              {assignedNames.size} Clients
            </span>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {assignedNames.size === 0 ? (
              <p className="text-xs text-slate-500 p-2">No clients linked to {selectedCoach}</p>
            ) : (
              [...assignedNames].sort().map((name) => (
                <div
                  key={name}
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200"
                >
                  {name}
                  {roster[name]?.isStaff && (
                    <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full">
                      Staff Perk
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* History */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl lg:col-span-2 space-y-3">
          <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
            Itemized Payout History
          </h3>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/60 text-xs uppercase text-slate-400 sticky top-0">
                <tr>
                  <th className="p-2.5">Date</th>
                  <th className="p-2.5">Client</th>
                  <th className="p-2.5">Package</th>
                  <th className="p-2.5 text-right">Gross</th>
                  <th className="p-2.5 text-right">Coach Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {coachTxs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-xs text-slate-500">
                      No payout history for {selectedCoach}
                    </td>
                  </tr>
                ) : (
                  [...coachTxs].reverse().map((tx) => {
                    const amt = getPayrollAmount(tx);
                    const isStaff =
                      tx.isStaff || (roster[tx.client] && roster[tx.client].isStaff);
                    const pay = calculateCoachPay(amt, tx.coach || selectedCoach, isStaff);
                    return (
                      <tr key={tx.id} className="hover:bg-slate-800/40 text-xs">
                        <td className="p-2.5 text-slate-400">{tx.date}</td>
                        <td className="p-2.5 font-medium text-white">
                          {displayClientName(tx.client, clients)}
                        </td>
                        <td className="p-2.5 text-slate-400">
                          <span>{tx.package || 'Standard'}</span>
{isMixedRetailPackage(tx) && (
  <span className="text-[10px] text-amber-400">Mixed cart — check payroll $</span>
)}
                          {isStaff && (
                            <span className="ml-1 bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">
                              Staff
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-right text-white">${amt.toFixed(2)}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-400">
                          ${pay.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}