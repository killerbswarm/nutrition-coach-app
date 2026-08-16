import React, { useState } from 'react';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

export default function ClientHabits({
  selectedClient,
  clientHabits = [],
  habits = [],
  onOpenLibrary,
}) {
  const [isAssignHabitOpen, setIsAssignHabitOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({
    habitId: '',
    weeksAssigned: 4,
    startDate: new Date().toISOString().split('T')[0],
  });

  const openAssignHabit = () => {
    setAssignForm({
      habitId: habits[0]?.id || '',
      weeksAssigned: 4,
      startDate: new Date().toISOString().split('T')[0],
    });
    setIsAssignHabitOpen(true);
  };

  const handleAssignHabit = async () => {
    if (!assignForm.habitId || !selectedClient) return alert('Select a habit');
    const habit = habits.find((h) => h.id === assignForm.habitId);
    if (!habit) return;
    if (
      clientHabits.some(
        (ch) => ch.habitId === habit.id && ch.status === 'active'
      )
    ) {
      return alert('Already assigned.');
    }
    try {
      await addDoc(collection(db, 'client_habits'), {
        clientId: selectedClient.id,
        habitId: habit.id,
        habitName: habit.name,
        category: habit.category || 'Nutrition',
        startDate: assignForm.startDate,
        weeksAssigned: Number(assignForm.weeksAssigned) || 4,
        status: 'active',
        checkIns: {},
        createdAt: new Date(),
      });
      setIsAssignHabitOpen(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRemoveClientHabit = async (ch) => {
    if (!window.confirm(`Remove "${ch.habitName}"?`)) return;
    try {
      await deleteDoc(doc(db, 'client_habits', ch.id));
    } catch (err) {
      alert(err.message);
    }
  };

  if (!selectedClient) return null;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-300">
            Assigned Habits ({clientHabits.length})
          </h3>
          <div className="flex gap-2">
            {typeof onOpenLibrary === 'function' && (
              <button
                type="button"
                onClick={onOpenLibrary}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Manage Library
              </button>
            )}
            <button
              type="button"
              onClick={openAssignHabit}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-500"
            >
              + Assign Habit
            </button>
          </div>
        </div>

        {clientHabits.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
            <p className="text-sm text-slate-400">No habits assigned yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clientHabits.map((ch) => (
              <div
                key={ch.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex justify-between items-center"
              >
                <div>
                  <div className="font-bold text-sm text-white">{ch.habitName}</div>
                  <div className="text-xs text-slate-400 mt-1 flex gap-3 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {ch.category}
                    </span>
                    <span>Started {ch.startDate}</span>
                    <span>{ch.weeksAssigned} weeks</span>
                    <span className="capitalize text-emerald-400">{ch.status}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveClientHabit(ch)}
                  className="p-1.5 text-slate-400 hover:text-red-400"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {isAssignHabitOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                Assign Habit to {selectedClient?.name}
              </h3>
              <button
                type="button"
                onClick={() => setIsAssignHabitOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            {habits.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">
                No habits yet.{' '}
                {typeof onOpenLibrary === 'function' && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAssignHabitOpen(false);
                      onOpenLibrary();
                    }}
                    className="text-blue-400 underline"
                  >
                    Create one
                  </button>
                )}
              </div>
            ) : (
              <>
                <select
                  value={assignForm.habitId}
                  onChange={(e) =>
                    setAssignForm({ ...assignForm, habitId: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                >
                  {habits.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.category})
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={assignForm.startDate}
                    onChange={(e) =>
                      setAssignForm({ ...assignForm, startDate: e.target.value })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="number"
                    min="1"
                    max="52"
                    value={assignForm.weeksAssigned}
                    onChange={(e) =>
                      setAssignForm({
                        ...assignForm,
                        weeksAssigned: e.target.value,
                      })
                    }
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAssignHabit}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl"
                >
                  Assign Habit
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}