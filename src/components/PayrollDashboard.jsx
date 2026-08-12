import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { TrendingUp, PieChart as PieIcon, Users, AlertTriangle, Filter } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const DEFAULT_CONFIG = { payNumerator: 4, payDenominator: 9 };

export default function PayrollDashboard({ config = DEFAULT_CONFIG }) {
  const [coaches, setCoaches] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [tfMonths, setTfMonths] = useState(12);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Coaches = staff users from this app
  useEffect(() => {
    const unsubC = onSnapshot(collection(db, 'users'), (snap) => {
      setCoaches(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || data.email || 'Unnamed',
            email: data.email || '',
            isOwner: data.role === 'owner' || data.isOwner === true,
            ...data,
          };
        })
      );
    });

    const unsubT = onSnapshot(collection(db, 'transactions'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      setTransactions(list);
    });

    return () => {
      unsubC();
      unsubT();
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

  // Alerts: 3x ~$149 cycles, no $99 yet
  const clientStats = {};
  transactions.forEach((t) => {
    const name = t.client || 'Unknown';
    const amt = Number(t.amount) || 0;
    if (!clientStats[name]) clientStats[name] = { count149: 0, count99: 0 };
    if (amt >= 140) clientStats[name].count149++;
    if (amt < 140 && amt > 0) clientStats[name].count99++;
  });
  const needsSwitch = Object.entries(clientStats).filter(
    ([, s]) => s.count149 >= 3 && s.count99 === 0
  );

  let filteredTxs = [...transactions];
  if (startDate && endDate) {
    filteredTxs = filteredTxs.filter((t) => t.date && t.date >= startDate && t.date <= endDate);
  } else if (tfMonths !== 'ALL') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - Number(tfMonths) + 1);
    const cutoffStr = cutoff.toISOString().slice(0, 7);
    filteredTxs = filteredTxs.filter((t) => t.date && t.date.slice(0, 7) >= cutoffStr);
  }

  let totalGross = 0;
  let totalCoachPay = 0;
  const coachShareMap = {};
  coaches.forEach((c) => {
    if (c.name) coachShareMap[c.name] = 0;
  });

  filteredTxs.forEach((tx) => {
    const amt = Number(tx.amount) || 0;
    const cPay = calculateCoachPay(amt, tx.coach, tx.isStaff);
    const coachObj = coaches.find(
      (c) => (c.name || '').trim().toLowerCase() === (tx.coach || '').trim().toLowerCase()
    );
    totalGross += amt;
    if (!coachObj || !coachObj.isOwner) totalCoachPay += cPay;
    if (tx.coach) coachShareMap[tx.coach] = (coachShareMap[tx.coach] || 0) + cPay;
  });

  const netRetained = totalGross - totalCoachPay;
  const marginPct = totalGross > 0 ? ((netRetained / totalGross) * 100).toFixed(1) : 0;

  const monthlyGroups = {};
  filteredTxs.forEach((t) => {
    if (!t.date) return;
    const k = t.date.slice(0, 7);
    if (!monthlyGroups[k]) monthlyGroups[k] = { gross: 0, coachPay: 0, clients: new Set() };
    const amt = Number(t.amount) || 0;
    const cPay = calculateCoachPay(amt, t.coach, t.isStaff);
    const coachObj = coaches.find(
      (c) => (c.name || '').trim().toLowerCase() === (t.coach || '').trim().toLowerCase()
    );
    monthlyGroups[k].gross += amt;
    if (!coachObj || !coachObj.isOwner) monthlyGroups[k].coachPay += cPay;
    if (t.client) monthlyGroups[k].clients.add(t.client);
  });

  const sortedKeys = Object.keys(monthlyGroups).sort();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabels = sortedKeys.map((k) => {
    const [y, m] = k.split('-');
    return `${monthNames[parseInt(m, 10) - 1]} '${y.slice(2)}`;
  });

  const lineData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Gross Revenue ($)',
        data: sortedKeys.map((k) => monthlyGroups[k].gross),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'Gym Net Retained ($)',
        data: sortedKeys.map((k) => monthlyGroups[k].gross - monthlyGroups[k].coachPay),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'Coach Payouts ($)',
        data: sortedKeys.map((k) => monthlyGroups[k].coachPay),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        tension: 0.3,
        fill: false,
      },
    ],
  };

  const doughnutData = {
    labels: Object.keys(coachShareMap),
    datasets: [
      {
        data: Object.values(coachShareMap),
        backgroundColor: ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#64748b'],
      },
    ],
  };

  const barData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Active Paying Clients',
        data: sortedKeys.map((k) => monthlyGroups[k].clients.size),
        backgroundColor: '#a855f7',
        borderRadius: 6,
      },
    ],
  };

  const avgClients =
    sortedKeys.length > 0
      ? (
          sortedKeys.reduce((a, k) => a + monthlyGroups[k].clients.size, 0) / sortedKeys.length
        ).toFixed(1)
      : 0;

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#f8fafc', font: { size: 11, weight: '600' } } },
    },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
    },
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-emerald-500" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Analytics Range
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[3, 6, 12, 'ALL'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setTfMonths(m);
                setStartDate('');
                setEndDate('');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                tfMonths === m && !startDate
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-100'
              }`}
            >
              {m === 'ALL' ? 'All Time' : `Last ${m} Months`}
            </button>
          ))}
          <div className="h-4 w-px bg-slate-700 mx-1 hidden md:block" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 px-2.5 py-1 rounded-lg text-xs text-slate-100 outline-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 px-2.5 py-1 rounded-lg text-xs text-slate-100 outline-none"
          />
        </div>
      </div>

      {/* Alerts */}
      {needsSwitch.length > 0 && (
        <div className="bg-red-500/10 border-l-4 border-l-red-500 border border-red-500/20 p-4 rounded-2xl space-y-2">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
            <AlertTriangle size={18} className="animate-pulse" />
            <span>Action Required: Initial 3-Cycle Commitments Completed</span>
          </div>
          <p className="text-xs text-slate-400">
            Switch these clients to the <strong>$99/mo ongoing</strong> plan:
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {needsSwitch.map(([cName, s]) => (
              <span
                key={cName}
                className="bg-red-500/20 text-red-300 border border-red-500/40 px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <span>{cName}</span>
                <span className="bg-red-500 text-slate-950 text-[10px] px-1.5 rounded-full font-bold">
                  {s.count149} Paid ($149)
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Gross Revenue
          </span>
          <div className="text-2xl font-bold mt-1 text-white">${totalGross.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-1">{filteredTxs.length} Payments Collected</p>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-amber-500 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Coach Payouts
          </span>
          <div className="text-2xl font-bold mt-1 text-amber-500">${totalCoachPay.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-1">
            Contractor Share ({config.payNumerator || 4}/{config.payDenominator || 9}ths)
          </p>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-emerald-500 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Gym Net Retained
          </span>
          <div className="text-2xl font-bold mt-1 text-emerald-400">${netRetained.toFixed(2)}</div>
          <p className="text-xs text-slate-400 mt-1">{marginPct}% Net Retention Margin</p>
        </div>
        <div className="bg-slate-900 border-l-4 border-l-purple-500 border border-slate-800 p-5 rounded-2xl">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Active Clients Avg
          </span>
          <div className="text-2xl font-bold mt-1 text-purple-400">{avgClients} Clients/Mo</div>
          <p className="text-xs text-slate-400 mt-1">Unique Paying Members</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl lg:col-span-2 space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-lg font-bold flex items-center gap-2 text-white">
              <TrendingUp size={18} className="text-emerald-500" /> Financial Trends
            </h2>
            <p className="text-xs text-slate-400">Gross, Net Retained, and Coach Payouts</p>
          </div>
          <div className="h-72 w-full">
            {sortedKeys.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                No transaction data yet
              </div>
            ) : (
              <Line data={lineData} options={chartOpts} />
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-lg font-bold flex items-center gap-2 text-white">
              <PieIcon size={18} className="text-amber-500" /> Coach Payout Share
            </h2>
            <p className="text-xs text-slate-400">Contractor payout distribution</p>
          </div>
          <div className="h-72 w-full flex items-center justify-center">
            {Object.values(coachShareMap).every((v) => !v) ? (
              <div className="text-sm text-slate-500">No payouts in range</div>
            ) : (
              <Doughnut
                data={doughnutData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: { color: '#f8fafc', font: { size: 10 } },
                    },
                  },
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4">
        <div className="border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold flex items-center gap-2 text-white">
            <Users size={18} className="text-purple-400" /> Active Member Roster Trend
          </h2>
          <p className="text-xs text-slate-400">Unique paying nutrition clients per month</p>
        </div>
        <div className="h-64 w-full">
          {sortedKeys.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              No transaction data yet
            </div>
          ) : (
            <Bar
              data={barData}
              options={{
                ...chartOpts,
                scales: {
                  ...chartOpts.scales,
                  y: { ...chartOpts.scales.y, ticks: { color: '#94a3b8', stepSize: 1 } },
                },
              }}
            />
          )}
        </div>
      </div>

      {transactions.length === 0 && (
        <p className="text-center text-xs text-slate-500">
          Charts will fill when <code className="text-slate-400">transactions</code> exist in this
          Firebase project. Next: port Run Payroll to log payments here.
        </p>
      )}
    </div>
  );
}