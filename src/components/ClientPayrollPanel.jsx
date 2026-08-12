import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { displayClientName, resolveClient, normName } from '../utils/resolveClient';

const DEFAULT_CONFIG = { payNumerator: 4, payDenominator: 9 };

export default function ClientPayrollPanel({ client, coaches = [], config = DEFAULT_CONFIG }) {
  const [transactions, setTransactions] = useState([]);
  const [roster, setRoster] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubT = onSnapshot(collection(db, 'transactions'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      setTransactions(list);
    });
    const unsubR = onSnapshot(collection(db, 'roster'), (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        map[d.id] = d.data();
      });
      setRoster(map);
    });
    return () => {
      unsubT();
      unsubR();
    };
  }, []);

  if (!client) return null;

  const canonical = client.name || '';
  const aliases = client.nameAliases || [];
  const nameKeys = [canonical, ...aliases].map(normName).filter(Boolean);

  // Payments that belong to this client (name or alias)
  const clientTxs = transactions.filter((tx) => {
    const n = normName(tx.client);
    return nameKeys.includes(n);
  });

  const calculateCoachPay = (amt = 0, coachName = '', isStaff = false) => {
    amt = Number(amt) || 0;
    const coach = coaches.find(
      (c) => (c.name || '').trim().toLowerCase() === (coachName || '').trim().toLowerCase()
    );
    if (coach && (coach.isOwner || coach.role === 'owner')) return 0;
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

  // Roster row: try canonical then aliases
  const rosterEntry =
    roster[canonical] ||
    aliases.map((a) => roster[a]).find(Boolean) ||
    {};

  const isStaff = !!rosterEntry.isStaff;
  const assignedCoach =
    rosterEntry.coach || client.coach || '';

  let count149 = 0;
  let lifetime = 0;
  clientTxs.forEach((tx) => {
    const amt = Number(tx.amount) || 0;
    lifetime += amt;
    if (amt >= 140) count149 += 1;
  });
  const hasOngoing = clientTxs.some((tx) => {
    const amt = Number(tx.amount) || 0;
    return amt > 0 && amt < 140;
  });
  const commitmentDone = hasOngoing || count149 >= 3;
  const commitmentPct = Math.min(100, hasOngoing ? 100 : (count149 / 3) * 100);

  const upsertRoster = async (patch) => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'roster', canonical),
        {
          coach: assignedCoach,
          isStaff,
          ...patch,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      // Keep clients.coach in sync when reassigning
      if (patch.coach !== undefined && client.id) {
        await updateDoc(doc(db, 'clients', client.id), {
          coach: patch.coach,
          updatedAt: new Date(),
        });
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const editTxAmount = async (id, currentAmt) => {
    const next = window.prompt('New gross amount ($):', currentAmt);
    if (next === null || next.trim() === '') return;
    const n = parseFloat(next);
    if (isNaN(n) || n < 0) return;
    await updateDoc(doc(db, 'transactions', id), { amount: n });
  };

  const deleteTx = async (id) => {
    if (!window.confirm('Delete this payment?')) return;
    await deleteDoc(doc(db, 'transactions', id));
  };

  return (
    <div className="mt-6 space-y-4 border-t border-slate-800 pt-6">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
        Payment history (Owner)
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Selected */}
        <div className="bg-slate-900 border border-slate-800 border-l-4 border-l-purple-500 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Selected Client</span>
          <div className="text-lg font-bold text-white mt-1">{canonical}</div>
          <div className="text-xs text-slate-400 mt-0.5">Coach: {assignedCoach || '—'}</div>
          <label className="flex items-center gap-2 mt-3 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isStaff}
              disabled={saving}
              onChange={(e) => upsertRoster({ isStaff: e.target.checked })}
              className="rounded border-slate-600"
            />
            Staff Perk (100%)
          </label>
        </div>

        {/* Commitment */}
        <div className="bg-slate-900 border border-slate-800 border-l-4 border-l-amber-500 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-400 uppercase">
            Initial Commitment Progress
          </span>
          <div className="text-sm font-bold text-white mt-2">
            {commitmentDone
              ? '✓ Transitioned to $99/mo'
              : `Cycle ${count149} of 3 ($149)`}
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${commitmentDone ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${commitmentPct}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {commitmentDone
              ? 'Active on $99 ongoing plan'
              : `${count149} × $149 payments recorded`}
          </p>
        </div>

        {/* Lifetime */}
        <div className="bg-slate-900 border border-slate-800 border-l-4 border-l-emerald-500 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Total Lifetime Paid</span>
          <div className="text-xl font-bold text-emerald-400 mt-1">${lifetime.toFixed(2)}</div>
          <p className="text-[11px] text-slate-500 mt-1">{clientTxs.length} Total Payments</p>
        </div>

        {/* Reassign coach */}
        <div className="bg-slate-900 border border-slate-800 border-l-4 border-l-blue-500 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-400 uppercase">
            Assigned Nutrition Coach
          </span>
          <div className="text-lg font-bold text-blue-400 mt-1">{assignedCoach || '—'}</div>
          <label className="block text-[10px] text-slate-500 mt-2 mb-1">Reassign coach</label>
          <select
            value={assignedCoach}
            disabled={saving}
            onChange={(e) => upsertRoster({ coach: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
          >
            <option value="">Unassigned</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Itemized */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h4 className="text-sm font-bold text-white mb-3">Itemized Client Payments</h4>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800/60 text-xs uppercase text-slate-400 sticky top-0">
              <tr>
                <th className="p-2.5">Date</th>
                <th className="p-2.5">Coach</th>
                <th className="p-2.5">Package</th>
                <th className="p-2.5 text-right">Gross</th>
                <th className="p-2.5 text-right">Coach Pay</th>
                <th className="p-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {clientTxs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-xs text-slate-500">
                    No payments for this client
                  </td>
                </tr>
              ) : (
                [...clientTxs].reverse().map((tx) => {
                  const amt = Number(tx.amount) || 0;
                  const staff = tx.isStaff || isStaff;
                  const pay = calculateCoachPay(amt, tx.coach, staff);
                  return (
                    <tr key={tx.id} className="text-xs hover:bg-slate-800/40">
                      <td className="p-2.5 text-slate-400">{tx.date}</td>
                      <td className="p-2.5 text-slate-300">{tx.coach || '—'}</td>
                      <td className="p-2.5 text-slate-400">{tx.package || 'Standard'}</td>
                      <td className="p-2.5 text-right text-white font-medium">
                        ${amt.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right font-bold text-emerald-400">
                        ${pay.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => editTxAmount(tx.id, amt)}
                          className="text-amber-400 hover:text-amber-300 mr-2"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTx(tx.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
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
  );
}