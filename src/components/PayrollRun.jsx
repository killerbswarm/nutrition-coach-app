import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { PlusCircle, Clock, CheckCircle2, Trash2, Edit } from 'lucide-react';
import { getPayrollAmount, isMixedRetailPackage } from '../utils/payrollAmounts';

const DEFAULT_CONFIG = { payNumerator: 4, payDenominator: 9, lookbackMonths: 18 };

export default function PayrollRun({ config = DEFAULT_CONFIG }) {
  const [coaches, setCoaches] = useState([]);
  const [clientList, setClientList] = useState([]);
  const [roster, setRoster] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [monthlyStatus, setMonthlyStatus] = useState({});

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );

  const [clientName, setClientName] = useState('');
  const [coachSelect, setCoachSelect] = useState('');
  const [packageType, setPackageType] = useState('Phase 1: Initial 3-Cycle ($149)');
  const [amount, setAmount] = useState('149.00');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isStaffCheck, setIsStaffCheck] = useState(false);

  useEffect(() => {
    const unsubC = onSnapshot(collection(db, 'users'), (snap) => {
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
      if (list.length > 0) {
        setCoachSelect((prev) => prev || list[0].name);
      }
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClientList(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((c) => c.name)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      );
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

    const unsubM = onSnapshot(collection(db, 'monthly_status'), (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        map[d.id] = d.data();
      });
      setMonthlyStatus(map);
    });

    return () => {
      unsubC();
      unsubClients();
      unsubR();
      unsubT();
      unsubM();
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
      amt === 99.0 &&
      (config.payNumerator || 4) === 4 &&
      (config.payDenominator || 9) === 9
    ) {
      return 43.96;
    }
    const ratio = (config.payNumerator || 4) / (config.payDenominator || 9);
    return Math.round(amt * ratio * 100) / 100;
  };

  const toggleMonthProcessed = async () => {
    if (selectedMonth === 'ALL') return;
    const current = monthlyStatus[selectedMonth]?.processed || false;
    await setDoc(
      doc(db, 'monthly_status', selectedMonth),
      { processed: !current, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const handleClientNameChange = (val) => {
    setClientName(val);
    const key = val.trim();
    if (roster[key]) {
      setCoachSelect(roster[key].coach || coaches[0]?.name || '');
      setIsStaffCheck(!!roster[key].isStaff);
      return;
    }
    const match = clientList.find(
      (c) => (c.name || '').trim().toLowerCase() === key.toLowerCase()
    );
    if (match?.coach) {
      setCoachSelect(match.coach);
    }
  };

  const handleManualAdd = async (e) => {
    e.preventDefault();
    if (!clientName.trim() || !coachSelect) return alert('Client and coach required');

    const name = clientName.trim();
    await setDoc(
      doc(db, 'roster', name),
      { coach: coachSelect, isStaff: isStaffCheck },
      { merge: true }
    );
    await addDoc(collection(db, 'transactions'), {
      client: name,
      coach: coachSelect,
      package: packageType,
      amount: Number(amount) || 0,
      date,
      isStaff: isStaffCheck,
      createdAt: serverTimestamp(),
    });

    setClientName('');
    setAmount('149.00');
    setPackageType('Phase 1: Initial 3-Cycle ($149)');
    setIsStaffCheck(false);
  };

  const editTransaction = async (id, currentAmt) => {
    const newAmtStr = window.prompt('Enter new gross payment amount ($):', currentAmt);
    if (newAmtStr !== null && newAmtStr.trim() !== '') {
      const newAmt = parseFloat(newAmtStr);
      if (!isNaN(newAmt) && newAmt >= 0) {
        await updateDoc(doc(db, 'transactions', id), {
  amount: newAmt,        // keeps UI simple
  payrollAmount: newAmt, // preferred by getPayrollAmount()
});
      }
    }
  };

  const deleteTransaction = async (id) => {
    if (window.confirm('Delete this payment record?')) {
      await deleteDoc(doc(db, 'transactions', id));
    }
  };

  const monthOptions = [];
  const count = config.lookbackMonths || 18;
  const d = new Date();
  d.setDate(1);
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const val = `${y}-${m}`;
    const isProc = monthlyStatus[val]?.processed || false;
    monthOptions.push({
      val,
      label: `${monthNames[d.getMonth()]} '${String(y).slice(2)} ${isProc ? '✓ Processed' : 'Pending'}`,
    });
    d.setMonth(d.getMonth() - 1);
  }

  const isAllTime = selectedMonth === 'ALL';
  const isCurrentProcessed = monthlyStatus[selectedMonth]?.processed || false;

  const displayTxs = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const filteredTxs = isAllTime
    ? displayTxs
    : displayTxs.filter((t) => t.date && t.date.startsWith(selectedMonth));

  let monthGross = 0;
  let monthCoachPay = 0;
  let monthOwnerPay = 0;
  const coachStats = {};
  coaches.forEach((c) => {
    coachStats[c.name] = { gross: 0, payout: 0, clientSet: new Set() };
  });

  filteredTxs.forEach((tx) => {
    const amt = getPayrollAmount(tx);
    const cPay = calculateCoachPay(amt, tx.coach, tx.isStaff);
    const coachObj = coaches.find(
      (c) => (c.name || '').trim().toLowerCase() === (tx.coach || '').trim().toLowerCase()
    );

    monthGross += amt;
    if (coachObj && coachObj.isOwner) {
      monthOwnerPay += tx.isStaff
        ? amt
        : Math.round(amt * ((config.payNumerator || 4) / (config.payDenominator || 9)) * 100) / 100;
    } else {
      monthCoachPay += cPay;
    }

    if (tx.coach && coachStats[tx.coach]) {
      coachStats[tx.coach].gross += amt;
      coachStats[tx.coach].payout += cPay;
      if (tx.client) coachStats[tx.coach].clientSet.add(tx.client);
    }
  });

  // Cycle badges: chronological per client
  const chronological = [...filteredTxs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const clientSeqTracker = {};
  chronological.forEach((tx) => {
    const name = tx.client || 'Unknown';
    const amt = getPayrollAmount(tx);
    if (!clientSeqTracker[name]) clientSeqTracker[name] = { count149: 0 };
    if (amt >= 140) clientSeqTracker[name].count149 += 1;
    tx._seq149 = clientSeqTracker[name].count149;
  });

  const inputClass =
    'w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm text-white outline-none focus:border-emerald-500';

  return (
    <div className="space-y-6">
      {/* Period + process */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Payroll Period
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-slate-950 border border-slate-700 px-3 py-1.5 rounded-lg font-bold text-emerald-400 text-sm outline-none"
          >
            <option value="ALL">All Time / Overall</option>
            {monthOptions.map((m) => (
              <option key={m.val} value={m.val}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {!isAllTime && (
          <button
            type="button"
            onClick={toggleMonthProcessed}
            className={`px-5 py-2.5 rounded-xl text-sm font-extrabold transition flex items-center gap-2 ${
              isCurrentProcessed
                ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 animate-pulse'
            }`}
          >
            {isCurrentProcessed ? (
              <>
                <CheckCircle2 size={18} /> Payroll Processed
                <span className="text-[10px] bg-slate-950/20 px-2 py-0.5 rounded ml-1">Undo</span>
              </>
            ) : (
              <>
                <Clock size={18} /> PENDING
                <span className="bg-slate-950/20 px-2 py-0.5 rounded text-xs ml-1">Mark Processed</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Month Gross</span>
          <div className="text-2xl font-bold mt-1 text-white">${monthGross.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-1">{filteredTxs.length} Payments</p>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-amber-500 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Coach Payout</span>
          <div className="text-2xl font-bold mt-1 text-amber-500">${monthCoachPay.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-1">
            {config.payNumerator || 4}/{config.payDenominator || 9}ths
          </p>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-emerald-500 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gym Net</span>
          <div className="text-2xl font-bold mt-1 text-emerald-400">
            ${(monthGross - monthCoachPay).toFixed(2)}
          </div>
          <p className="text-xs text-slate-400 mt-1">Retained</p>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-purple-500 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Owner Share</span>
          <div className="text-2xl font-bold mt-1 text-purple-400">${monthOwnerPay.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-1">Excluded from coach pay</p>
        </div>
      </div>

      {/* Log payment */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2 text-white">
          <PlusCircle size={18} className="text-emerald-500" /> Log Payment
        </h2>
        <form onSubmit={handleManualAdd} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="lg:col-span-1">
            <label className="block text-xs font-medium text-slate-400 mb-1">Client</label>
            <input
              list="payroll-client-list"
              type="text"
              value={clientName}
              onChange={(e) => handleClientNameChange(e.target.value)}
              required
              placeholder="Client name"
              className={inputClass}
            />
            <datalist id="payroll-client-list">
              {clientList.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Coach</label>
            <select
              value={coachSelect}
              onChange={(e) => setCoachSelect(e.target.value)}
              required
              className={inputClass}
            >
              {coaches.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} {c.isOwner ? '(Owner)' : ''}
                </option>
              ))}
            </select>
          </div>
                   <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Package</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              <button
                type="button"
                onClick={() => {
                  setPackageType('Phase 1: Initial 3-Cycle ($149)');
                  setAmount('149.00');
                }}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition ${
                  amount === '149' || amount === '149.00' || Number(amount) === 149
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                $149 Initial
              </button>
              <button
                type="button"
                onClick={() => {
                  setPackageType('Ongoing Monthly ($99)');
                  setAmount('99.00');
                }}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition ${
                  amount === '99' || amount === '99.00' || Number(amount) === 99
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                $99 Ongoing
              </button>
              <button
                type="button"
                onClick={() => {
                  setPackageType('Other');
                }}
                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
              >
                Other
              </button>
            </div>
            <input
              type="text"
              value={packageType}
              onChange={(e) => setPackageType(e.target.value)}
              className={inputClass}
              placeholder="Package label"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Gross ($)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={isStaffCheck}
                onChange={(e) => setIsStaffCheck(e.target.checked)}
                className="rounded border-slate-700 w-4 h-4"
              />
              Staff Perk (100%)
            </label>
          </div>
          <div className="sm:col-span-2 md:col-span-3 lg:col-span-6">
            <button
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2.5 rounded-xl text-sm"
            >
              Add Payment Entry
            </button>
          </div>
        </form>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold text-white">Payment Records</h2>
            <span className="text-xs text-slate-400">
              Standard:{' '}
              <span className="text-emerald-400 font-bold">
                {config.payNumerator || 4}/{config.payDenominator || 9}ths
              </span>{' '}
              | Staff: <span className="text-blue-400 font-bold">100%</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/60 text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-3">Client</th>
                  <th className="p-3">Coach</th>
                  <th className="p-3">Package</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-right">Gross</th>
                  <th className="p-3 text-right">Coach Pay</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredTxs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 text-xs">
                      No payments this period
                    </td>
                  </tr>
                ) : (
                  filteredTxs.map((tx) => {
                    const amt = getPayrollAmount(tx);
                    const cPay = calculateCoachPay(amt, tx.coach, tx.isStaff);
                    const coachObj = coaches.find(
                      (c) =>
                        (c.name || '').trim().toLowerCase() ===
                        (tx.coach || '').trim().toLowerCase()
                    );
                    const cName = tx.client || 'Unknown';
                    let cycleBadge = null;
                    if (amt >= 140) {
                      const seq = tx._seq149 || 1;
                      if (seq < 3)
                        cycleBadge = (
                          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold">
                            Cycle {seq} of 3
                          </span>
                        );
                      else if (seq === 3)
                        cycleBadge = (
                          <span className="bg-red-500/20 text-red-300 border border-red-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold">
                            Cycle 3 — Switch Due
                          </span>
                        );
                      else
                        cycleBadge = (
                          <span className="bg-red-500/30 text-red-200 border border-red-500/50 px-2 py-0.5 rounded-full text-[10px] font-bold">
                            Over $149 (#{seq})
                          </span>
                        );
                    } else if (amt > 0) {
                      cycleBadge = (
                        <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          Ongoing
                        </span>
                      );
                    }

                    return (
                      <tr key={tx.id} className="hover:bg-slate-800/40">
                        <td className="p-3 font-semibold text-white">{cName}</td>
                        <td className="p-3 text-slate-400">
                          {tx.coach || '—'}
                          {coachObj?.isOwner && (
                            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full ml-1">
                              Owner
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-400 text-xs">
                          <div className="flex flex-wrap gap-1 items-center">
                            <span>{tx.package || 'Standard'}</span>
{isMixedRetailPackage(tx) && (
  <span className="text-[10px] text-amber-400">Mixed cart — check payroll $</span>
)}
                            {cycleBadge}
                            {tx.isStaff && (
                              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full">
                                Staff
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-slate-400 text-xs">{tx.date}</td>
                        <td className="p-3 text-right font-semibold text-white">${amt.toFixed(2)}</td>
                        <td className="p-3 text-right font-semibold text-emerald-400">
                          ${cPay.toFixed(2)}
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => editTransaction(tx.id, getPayrollAmount(tx))}
                              className="text-amber-400 hover:text-amber-300"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTransaction(tx.id)}
                              className="text-slate-400 hover:text-red-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4">
          <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Coach Payouts</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/60 text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-2.5">Coach</th>
                  <th className="p-2.5 text-center">Clients</th>
                  <th className="p-2.5 text-right">Gross</th>
                  <th className="p-2.5 text-right">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {coaches.map((c) => {
                  const s = coachStats[c.name] || { gross: 0, payout: 0, clientSet: new Set() };
                  return (
                    <tr key={c.id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 text-slate-300 font-medium">
                        {c.name}
                        {c.isOwner && (
                          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full ml-1">
                            Owner
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center font-semibold text-purple-400">
                        {s.clientSet.size}
                      </td>
                      <td className="p-2.5 text-right font-semibold text-white">
                        ${s.gross.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right font-bold text-emerald-400">
                        ${s.payout.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}