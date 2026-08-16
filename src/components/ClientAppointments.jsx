import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

const emptyBookingForm = (appointmentTypes = [], rooms = []) => ({
  appointmentTypeId: appointmentTypes[0]?.id || '',
  roomId: rooms[0]?.id || '',
  date: new Date().toISOString().split('T')[0],
  time: '10:00',
  durationMinutes: appointmentTypes[0]?.durationMinutes || 15,
  notes: '',
});

export default function ClientAppointments({
  selectedClient,
  clientBookings = [],
  rooms = [],
  appointmentTypes = [],
}) {
  const { currentUser } = useAuth();
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState(() =>
    emptyBookingForm(appointmentTypes, rooms)
  );

  const now = new Date();
  const upcoming = clientBookings.filter(
    (b) => new Date(`${b.date}T${b.time || '00:00'}`) >= now
  );
  const past = clientBookings.filter(
    (b) => new Date(`${b.date}T${b.time || '00:00'}`) < now
  );

  const openAddBooking = () => {
    setBookingForm(emptyBookingForm(appointmentTypes, rooms));
    setIsBookingOpen(true);
  };

  const handleSaveClientBooking = async () => {
    if (!selectedClient) return;
    if (!bookingForm.appointmentTypeId) {
      alert('Select an appointment type');
      return;
    }
    if (!bookingForm.roomId) {
      alert('Select a room');
      return;
    }
    const typeObj = appointmentTypes.find(
      (t) => t.id === bookingForm.appointmentTypeId
    );
    const roomObj = rooms.find((r) => r.id === bookingForm.roomId);

    try {
      await addDoc(collection(db, 'bookings'), {
        clientId: selectedClient.id,
        clientName: selectedClient.name || '',
        ghlContactId: selectedClient.ghlContactId || '',
        appointmentTypeId: bookingForm.appointmentTypeId,
        appointmentTypeName: typeObj?.name || '',
        roomId: bookingForm.roomId,
        roomName: roomObj?.name || '',
        date: bookingForm.date,
        time: bookingForm.time,
        durationMinutes: Number(bookingForm.durationMinutes) || 15,
        notes: bookingForm.notes || '',
        coach: selectedClient.coach || '',
        coachEmail: '',
        bookedByUid: currentUser?.uid || '',
        bookedByName:
          currentUser?.displayName ||
          currentUser?.email ||
          '',
        bookedByEmail: currentUser?.email || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setIsBookingOpen(false);
    } catch (err) {
      alert('Failed to create booking: ' + err.message);
    }
  };

  if (!selectedClient) return null;

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={openAddBooking}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl"
          >
            + Add booking
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Upcoming
            </h3>
            <div className="space-y-2">
              {upcoming.map((b) => (
                <div
                  key={b.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex justify-between items-center"
                >
                  <div>
                    <div className="font-bold text-sm text-white">
                      {b.appointmentTypeName || 'Appointment'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {b.date} at {b.time} · {b.roomName || 'No room'}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Upcoming
                  </span>
                </div>
              ))}
              {upcoming.length === 0 && (
                <div className="text-xs text-slate-500">No upcoming appointments</div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Past
            </h3>
            <div className="space-y-2">
              {past.map((b) => (
                <div
                  key={b.id}
                  className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4 opacity-75"
                >
                  <div className="font-bold text-sm text-slate-300">
                    {b.appointmentTypeName || 'Appointment'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {b.date} at {b.time}
                  </div>
                </div>
              ))}
              {past.length === 0 && (
                <div className="text-xs text-slate-500">No past appointments</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isBookingOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                Book for {selectedClient.name}
              </h3>
              <button
                type="button"
                onClick={() => setIsBookingOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Type</label>
              <select
                value={bookingForm.appointmentTypeId}
                onChange={(e) => {
                  const id = e.target.value;
                  const t = appointmentTypes.find((x) => x.id === id);
                  setBookingForm((prev) => ({
                    ...prev,
                    appointmentTypeId: id,
                    durationMinutes: t?.durationMinutes || prev.durationMinutes,
                  }));
                }}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              >
                {appointmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.durationMinutes || 15} min)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Room</label>
              <select
                value={bookingForm.roomId}
                onChange={(e) =>
                  setBookingForm((prev) => ({ ...prev, roomId: e.target.value }))
                }
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-medium">Date</label>
                <input
                  type="date"
                  value={bookingForm.date}
                  onChange={(e) =>
                    setBookingForm((prev) => ({ ...prev, date: e.target.value }))
                  }
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Time</label>
                <input
                  type="time"
                  value={bookingForm.time}
                  onChange={(e) =>
                    setBookingForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium">Notes</label>
              <textarea
                value={bookingForm.notes}
                onChange={(e) =>
                  setBookingForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                rows={2}
              />
            </div>

            <button
              type="button"
              onClick={handleSaveClientBooking}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl"
            >
              Create booking
            </button>
          </div>
        </div>
      )}
    </>
  );
}