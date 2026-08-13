import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  writeBatch,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';


// Helper: Convert "HH:MM" to total minutes from midnight
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

const isPastAppointment = (appt) => {
  if (!appt?.date) return false;
  const time = appt.time && /^\d{1,2}:\d{2}/.test(appt.time) ? appt.time : '23:59';
  const when = new Date(`${appt.date}T${time}`);
  if (isNaN(when.getTime())) return false;
  return when.getTime() < Date.now();
};

export default function Calendar({ clients = [], ghlAppointments = [], selectedClient = null }) {
  // State for DB Collections
  const [bookings, setBookings] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [calView, setCalView] = useState('list'); // list | day | week | month
  const [viewDate, setViewDate] = useState(() => new Date()); // anchor for day/week/month
  const { isOwner } = useAuth();

  // UI Filter & Modals
  const [selectedRoomFilter, setSelectedRoomFilter] = useState('ALL');
  const [isAddBookingOpen, setIsAddBookingOpen] = useState(false);
  const [isManageRoomsOpen, setIsManageRoomsOpen] = useState(false);
  const [isManageTypesOpen, setIsManageTypesOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null); // null = create mode

  // Live GHL Member Search inside Modal State
  const [ghlQuery, setGhlQuery] = useState('');
  const [ghlResults, setGhlResults] = useState([]);
  const [isSearchingGhl, setIsSearchingGhl] = useState(false);

  // Form States
  const [newBooking, setNewBooking] = useState({
    clientId: selectedClient?.id || '',
    clientName: selectedClient?.name || '',
    ghlContactId: selectedClient?.ghlContactId || '',
    appointmentTypeId: '',
    roomId: '',
    date: new Date().toISOString().split('T')[0],
    time: '10:00',
    durationMinutes: 15,
    notes: '',
  });

  const [editingRoom, setEditingRoom] = useState(null);
  const [roomFormData, setRoomFormData] = useState({ name: '', description: '' });

  const [editingType, setEditingType] = useState(null);
  const [typeFormData, setTypeFormData] = useState({ name: '', durationMinutes: 15 });

  const toYMD = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

  const startOfWeek = (d) => {
    const x = new Date(d);
    const day = x.getDay(); // 0 Sun
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  const bookingsOn = (ymd) =>
    (bookings || []).filter((b) => b.date === ymd);

  // ---------------------------------------------------------------------------
  // 1. AUTO-SEED DEFAULTS & SUBSCRIBE TO FIRESTORE
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const seedDefaultsIfNeeded = async () => {
      // Seed Rooms if empty
      const roomsSnap = await getDocs(collection(db, 'rooms'));
      if (roomsSnap.empty) {
        const batch = writeBatch(db);
        const r1 = doc(collection(db, 'rooms'));
        const r2 = doc(collection(db, 'rooms'));
        batch.set(r1, { name: 'InBody 270 Room', description: 'Primary body composition scanner', createdAt: new Date() });
        batch.set(r2, { name: 'InBody 570 Room', description: 'Secondary / overflow scanner', createdAt: new Date() });
        await batch.commit();
      }

      // Seed Appointment Types if empty
      const typesSnap = await getDocs(collection(db, 'appointment_types'));
      if (typesSnap.empty) {
        const batch = writeBatch(db);
        const t1 = doc(collection(db, 'appointment_types'));
        const t2 = doc(collection(db, 'appointment_types'));
        const t3 = doc(collection(db, 'appointment_types'));
        batch.set(t1, { name: 'InBody Scan', durationMinutes: 15, createdAt: new Date() });
        batch.set(t2, { name: 'Follow-up Appointment', durationMinutes: 30, createdAt: new Date() });
        batch.set(t3, { name: 'Initial Consult', durationMinutes: 60, createdAt: new Date() });
        await batch.commit();
      }
    };

    seedDefaultsIfNeeded();

    // Real-time listener: Rooms
    const unsubscribeRooms = onSnapshot(collection(db, 'rooms'), (snapshot) => {
      const roomDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRooms(roomDocs);
    });

    // Real-time listener: Appointment Types
    const unsubscribeTypes = onSnapshot(collection(db, 'appointment_types'), (snapshot) => {
      const typeDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAppointmentTypes(typeDocs);
    });

    // Real-time listener: Bookings
    const qBookings = query(collection(db, 'bookings'), orderBy('date', 'asc'));
    const unsubscribeBookings = onSnapshot(qBookings, (snapshot) => {
      const bookingDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBookings(bookingDocs);
    });

    return () => {
      unsubscribeRooms();
      unsubscribeTypes();
      unsubscribeBookings();
    };
  }, []);

  // Sync selected client into modal
  useEffect(() => {
    if (selectedClient) {
      setNewBooking((prev) => ({
        ...prev,
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        ghlContactId: selectedClient.ghlContactId || '',
      }));
    }
  }, [selectedClient]);

  // Set default room & type when modal opens or DB loads
  useEffect(() => {
    if (rooms.length > 0 && !newBooking.roomId) {
      setNewBooking((prev) => ({ ...prev, roomId: rooms[0].id }));
    }
    if (appointmentTypes.length > 0 && !newBooking.appointmentTypeId) {
      const defaultType = appointmentTypes[0];
      setNewBooking((prev) => ({
        ...prev,
        appointmentTypeId: defaultType.id,
        durationMinutes: defaultType.durationMinutes || 15,
      }));
    }
  }, [rooms, appointmentTypes]);
  // ---------------------------------------------------------------------------
  // 2. LIVE GHL CONTACT SEARCH & AUTO-IMPORT
  // ---------------------------------------------------------------------------
  const handleSearchGhl = async () => {
    if (!ghlQuery.trim()) return;
    setIsSearchingGhl(true);
    try {
      const res = await fetch(
        `https://us-central1-swarm-nutrition-app.cloudfunctions.net/searchGhlContacts?query=${encodeURIComponent(ghlQuery)}`
      );
      if (res.ok) {
        const data = await res.json();
        setGhlResults(data.contacts || []);
      }
    } catch (err) {
      console.error('GHL Search Error:', err);
    } finally {
      setIsSearchingGhl(false);
    }
  };

  const handleSelectGhlContact = async (contact) => {
    const existingClient = clients.find(
      (c) =>
        (c.ghlContactId && c.ghlContactId === contact.id) ||
        (c.email && contact.email && c.email.toLowerCase() === contact.email.toLowerCase()) ||
        (c.phone && contact.phone && String(c.phone).replace(/\D/g, '') === String(contact.phone).replace(/\D/g, ''))
    );

    if (existingClient) {
      setNewBooking((prev) => ({
        ...prev,
        clientId: existingClient.id,
        clientName: existingClient.name,
        ghlContactId: contact.id,
      }));
    } else {
      try {
        const newClientDoc = {
          name: contact.name,
          email: contact.email || '',
          phone: contact.phone || '',
          ghlContactId: contact.id,
          coach: '',
          createdAt: new Date(),
        };
        const docRef = await addDoc(collection(db, 'clients'), newClientDoc);
        setNewBooking((prev) => ({
          ...prev,
          clientId: docRef.id,
          clientName: contact.name,
          ghlContactId: contact.id,
        }));
      } catch (err) {
        console.error('Auto-import client error:', err);
        setNewBooking((prev) => ({
          ...prev,
          clientId: '',
          clientName: contact.name,
          ghlContactId: contact.id,
        }));
      }
    }

    setGhlResults([]);
    setGhlQuery('');
  };

  // ---------------------------------------------------------------------------
  // 3. APPOINTMENT TYPE SELECTION HANDLER
  // ---------------------------------------------------------------------------
  const handleTypeSelectChange = (typeId) => {
    const matchedType = appointmentTypes.find((t) => t.id === typeId);
    setNewBooking((prev) => ({
      ...prev,
      appointmentTypeId: typeId,
      durationMinutes: matchedType ? matchedType.durationMinutes : 15,
    }));
  };

  // ---------------------------------------------------------------------------
  // 4. BOOKING CREATE / UPDATE + OVERLAP PREVENTION
  // ---------------------------------------------------------------------------
  const handleCreateBooking = async (e) => {
    e.preventDefault();

    if (!newBooking.clientName.trim()) {
      alert('Please select or enter a member name.');
      return;
    }
    if (!newBooking.roomId) {
      alert('Please select a room.');
      return;
    }
    if (!newBooking.appointmentTypeId) {
      alert('Please select an appointment type.');
      return;
    }

    const selectedRoomObj = rooms.find((r) => r.id === newBooking.roomId);
    const selectedTypeObj = appointmentTypes.find((t) => t.id === newBooking.appointmentTypeId);

    const newStartMin = timeToMinutes(newBooking.time);
    const newEndMin = newStartMin + Number(newBooking.durationMinutes);

    // OVERLAP CHECK (skip self when editing)
    const hasOverlap = bookings.some((b) => {
      if (editingBooking && b.id === editingBooking.id) return false;
      if (b.roomId !== newBooking.roomId || b.date !== newBooking.date) return false;

      const existingStart = timeToMinutes(b.time);
      const existingEnd = existingStart + Number(b.durationMinutes || 15);

      return newStartMin < existingEnd && newEndMin > existingStart;
    });

    if (hasOverlap) {
      alert(
        `⚠️ ROOM BOOKING OVERLAP CONFLICT!\n\n"${selectedRoomObj?.name}" is already occupied during this time window (${newBooking.time} for ${newBooking.durationMinutes} min).\n\nPlease choose a different time or select another room.`
      );
      return;
    }

    const client = clients.find((c) => c.id === newBooking.clientId);
    const coachName = newBooking.coach || client?.coach || '';

    const payload = {
      clientId: newBooking.clientId || '',
      clientName: newBooking.clientName.trim(),
      ghlContactId: newBooking.ghlContactId || '',
      appointmentTypeId: newBooking.appointmentTypeId,
      appointmentTypeName: selectedTypeObj?.name || '',
      roomId: newBooking.roomId,
      roomName: selectedRoomObj?.name || '',
      date: newBooking.date,
      time: newBooking.time,
      durationMinutes: Number(newBooking.durationMinutes),
      notes: newBooking.notes || '',
      coach: coachName,
      coachEmail: newBooking.coachEmail || '',
      updatedAt: new Date(),
    };

    try {
      if (editingBooking) {
        await updateDoc(doc(db, 'bookings', editingBooking.id), payload);
      } else {
        await addDoc(collection(db, 'bookings'), {
          ...payload,
          createdAt: new Date(),
        });
      }

      setIsAddBookingOpen(false);
      setEditingBooking(null);
      setNewBooking({
        clientId: selectedClient?.id || '',
        clientName: selectedClient?.name || '',
        ghlContactId: selectedClient?.ghlContactId || '',
        appointmentTypeId: appointmentTypes[0]?.id || '',
        roomId: rooms[0]?.id || '',
        date: new Date().toISOString().split('T')[0],
        time: '10:00',
        durationMinutes: appointmentTypes[0]?.durationMinutes || 15,
        notes: '',
        coach: '',
        coachEmail: '',
      });
    } catch (err) {
      console.error('Save booking error:', err);
      alert('Failed to save appointment: ' + err.message);
    }
  };

  const handleDeleteBooking = async (id) => {
    if (!window.confirm('Delete this booking?')) return;
    try {
      await deleteDoc(doc(db, 'bookings', id));
    } catch (err) {
      console.error('Error deleting booking:', err);
    }
  };

  const openEditBooking = (booking) => {
    setEditingBooking(booking);
    setNewBooking({
      clientId: booking.clientId || '',
      clientName: booking.clientName || '',
      ghlContactId: booking.ghlContactId || '',
      appointmentTypeId: booking.appointmentTypeId || '',
      roomId: booking.roomId || '',
      date: booking.date || new Date().toISOString().split('T')[0],
      time: booking.time || '10:00',
      durationMinutes: booking.durationMinutes || 15,
      notes: booking.notes || '',
      coach: booking.coach || '',
      coachEmail: booking.coachEmail || '',
    });
    setIsAddBookingOpen(true);
  };

  const closeBookingModal = () => {
    setIsAddBookingOpen(false);
    setEditingBooking(null);
  };

  // ---------------------------------------------------------------------------
  // 5. ROOM CRUD HANDLERS
  // ---------------------------------------------------------------------------
  const handleSaveRoom = async (e) => {
    e.preventDefault();
    if (!roomFormData.name.trim()) return;

    try {
      if (editingRoom) {
        await updateDoc(doc(db, 'rooms', editingRoom.id), {
          name: roomFormData.name.trim(),
          description: roomFormData.description.trim(),
        });
      } else {
        await addDoc(collection(db, 'rooms'), {
          name: roomFormData.name.trim(),
          description: roomFormData.description.trim(),
          createdAt: new Date(),
        });
      }
      setEditingRoom(null);
      setRoomFormData({ name: '', description: '' });
    } catch (err) {
      console.error('Error saving room:', err);
    }
  };

  const handleDeleteRoom = async (roomId) => {
    if (!window.confirm('Are you sure you want to delete this room?')) return;
    try {
      await deleteDoc(doc(db, 'rooms', roomId));
    } catch (err) {
      console.error('Error deleting room:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // 6. APPOINTMENT TYPE CRUD HANDLERS
  // ---------------------------------------------------------------------------
  const handleSaveType = async (e) => {
    e.preventDefault();
    if (!typeFormData.name.trim()) return;

    try {
      if (editingType) {
        await updateDoc(doc(db, 'appointment_types', editingType.id), {
          name: typeFormData.name.trim(),
          durationMinutes: Number(typeFormData.durationMinutes),
        });
      } else {
        await addDoc(collection(db, 'appointment_types'), {
          name: typeFormData.name.trim(),
          durationMinutes: Number(typeFormData.durationMinutes),
          createdAt: new Date(),
        });
      }
      setEditingType(null);
      setTypeFormData({ name: '', durationMinutes: 15 });
    } catch (err) {
      console.error('Error saving appointment type:', err);
    }
  };

  const handleDeleteType = async (typeId) => {
    if (!window.confirm('Are you sure you want to delete this appointment type?')) return;
    try {
      await deleteDoc(doc(db, 'appointment_types', typeId));
    } catch (err) {
      console.error('Error deleting appointment type:', err);
    }
  };

  // Combined List: Local DB Bookings + GHL Appointments
  const allAppointments = [
    ...bookings.map((b) => ({ ...b, source: 'Local' })),
    ...ghlAppointments.map((a) => ({
      id: a.id,
      appointmentTypeName: a.title || 'GHL Appointment',
      clientName: a.contactName || selectedClient?.name || 'Client',
      date: a.startTime ? new Date(a.startTime).toISOString().split('T')[0] : 'Today',
      time: a.startTime
        ? new Date(a.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Scheduled',
      roomName: 'GHL Synced Calendar',
      durationMinutes: 30,
      source: 'GHL',
    })),
  ];

  const filteredAppointments = allAppointments.filter((a) => {
    if (selectedRoomFilter === 'ALL') return true;
    return a.roomId === selectedRoomFilter;
  });

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-slate-950 text-slate-100">
      {/* TOP HEADER & MANAGEMENT TOOLBAR */}
      <div className="flex flex-wrap justify-between items-center pb-6 border-b border-slate-800 mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-black text-white">Calendar</h2>
          <p className="text-xs text-slate-400 mt-1">
            All Coaches Bookings are visible to all coaches 
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isOwner && (
            <>
              <button
                onClick={() => setIsManageRoomsOpen(true)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors border border-slate-700"
              >
                ⚙️ Manage Rooms ({rooms.length})
              </button>
              <button
                onClick={() => setIsManageTypesOpen(true)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors border border-slate-700"
              >
                ⚙️ Manage Types ({appointmentTypes.length})
              </button>
            </>
          )}

          {/* Add New Booking stays visible for coaches */}
          <button
            type="button"
            onClick={() => {
              setEditingBooking(null);
              setIsAddBookingOpen(true);
            }}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-colors"
          >
            + Add New Booking
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* MAIN SCHEDULE COLUMN */}
        <div className="md:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
          <div className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-3 gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Schedule</h3>

              <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] overflow-x-auto">
                <button
                  onClick={() => setSelectedRoomFilter('ALL')}
                  className={`px-2.5 py-1 font-bold rounded-md transition-all ${selectedRoomFilter === 'ALL' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  All
                </button>
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => setSelectedRoomFilter(room.id)}
                    className={`px-2.5 py-1 font-bold rounded-md transition-all whitespace-nowrap ${selectedRoomFilter === room.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    {room.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* ===== VIEW SWITCHER — PASTE HERE ===== */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-1">
              {[
                { id: 'list', label: 'List' },
                { id: 'day', label: 'Day' },
                { id: 'week', label: 'Week' },
                { id: 'month', label: 'Month' },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setCalView(v.id)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${calView === v.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {calView !== 'list' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (calView === 'day') setViewDate(addDays(viewDate, -1));
                    else if (calView === 'week') setViewDate(addDays(viewDate, -7));
                    else setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
                  }}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 text-slate-300"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setViewDate(new Date())}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 text-slate-300"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (calView === 'day') setViewDate(addDays(viewDate, 1));
                    else if (calView === 'week') setViewDate(addDays(viewDate, 7));
                    else setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
                  }}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 text-slate-300"
                >
                  ›
                </button>
                <span className="text-sm font-bold text-white">
                  {calView === 'month'
                    ? viewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })
                    : viewDate.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                </span>
              </div>
            )}
          </div>
          {calView === 'list' && (filteredAppointments.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-500">
              No appointments scheduled. Click "Add New Booking" to create one.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAppointments.map((appt) => {
                const past = isPastAppointment(appt);
                return (
                  <div
                    key={appt.id}
                    className={`p-4 rounded-xl flex justify-between items-center gap-4 transition-all border-l-4 ${past
                        ? 'bg-slate-900/40 border border-slate-800 border-l-slate-500 opacity-80'
                        : 'bg-slate-950 border border-slate-800 border-l-blue-500 hover:border-slate-700'
                      }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {past ? (
                          <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wide rounded-md bg-slate-600 text-white">
                            Past
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wide rounded-md bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
                            Upcoming
                          </span>
                        )}

                        <span className={`font-bold text-sm ${past ? 'text-slate-400 line-through' : 'text-white'}`}>
                          {appt.appointmentTypeName || 'Appointment'}
                        </span>

                        {appt.roomName && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            {appt.roomName}
                          </span>
                        )}

                        <span className="px-2 py-0.5 text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full">
                          {appt.durationMinutes || 15} min
                        </span>
                      </div>

                      <div className={`text-xs mt-1 ${past ? 'text-slate-500' : 'text-slate-400'}`}>
                        Member:{' '}
                        <span className={past ? 'text-slate-500' : 'text-slate-200 font-medium'}>
                          {appt.clientName || '—'}
                        </span>
                      </div>

                      {appt.notes && (
                        <div className="text-[11px] text-slate-500 italic mt-1">{appt.notes}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className={`text-right text-xs ${past ? 'text-slate-500' : 'text-slate-300'}`}>
                        <div className="font-semibold">{appt.date}</div>
                        <div>{appt.time}</div>
                      </div>

                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEditBooking(appt)}
                          className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBooking(appt.id)}
                          className="px-2 py-1 text-[10px] font-bold rounded-lg text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
                    {calView === 'day' && (
            <div className="space-y-2">
              {bookingsOn(toYMD(viewDate)).length === 0 ? (
                <p className="text-center py-10 text-xs text-slate-500">No appointments this day</p>
              ) : (
                bookingsOn(toYMD(viewDate))
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                  .map((appt) => (
                    <button
                      key={appt.id}
                      type="button"
                      onClick={() => openEditBooking(appt)}
                      className="w-full text-left p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500/40"
                    >
                      <div className="font-bold text-white text-sm">
                        {appt.time} · {appt.clientName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {appt.appointmentTypeName || 'Appt'} · {appt.roomName || 'Room'}
                      </div>
                    </button>
                  ))
              )}
            </div>
          )}

          {calView === 'week' && (
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
              {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(viewDate), i)).map((d) => {
                const ymd = toYMD(d);
                const items = bookingsOn(ymd).sort((a, b) =>
                  (a.time || '').localeCompare(b.time || '')
                );
                const isToday = ymd === toYMD(new Date());
                return (
                  <div
                    key={ymd}
                    className={`bg-slate-950 border rounded-xl p-2 min-h-[120px] ${
                      isToday ? 'border-blue-500/50' : 'border-slate-800'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-slate-400 mb-2">
                      {d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                    </div>
                    <div className="space-y-1">
                      {items.map((appt) => (
                        <button
                          key={appt.id}
                          type="button"
                          onClick={() => openEditBooking(appt)}
                          className="w-full text-left px-1.5 py-1 rounded-lg bg-blue-600/20 text-[10px] text-blue-200"
                        >
                          <div className="font-bold">{appt.time}</div>
                          <div className="truncate">{appt.clientName}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {calView === 'month' && (() => {
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();
            const start = startOfWeek(new Date(year, month, 1));
            const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
            return (
              <div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="text-center text-[10px] font-bold text-slate-500 py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d) => {
                    const ymd = toYMD(d);
                    const inMonth = d.getMonth() === month;
                    const items = bookingsOn(ymd);
                    const isToday = ymd === toYMD(new Date());
                    return (
                      <button
                        key={ymd}
                        type="button"
                        onClick={() => {
                          setViewDate(d);
                          setCalView('day');
                        }}
                        className={`min-h-[68px] p-1 rounded-xl border text-left ${
                          isToday ? 'border-blue-500/50 bg-blue-600/10' : 'border-slate-800 bg-slate-950'
                        } ${inMonth ? '' : 'opacity-40'}`}
                      >
                        <div className="text-[11px] font-bold text-slate-300">{d.getDate()}</div>
                        {items.slice(0, 2).map((appt) => (
                          <div key={appt.id} className="truncate text-[9px] text-blue-300">
                            {appt.time} {appt.clientName}
                          </div>
                        ))}
                        {items.length > 2 && (
                          <div className="text-[9px] text-slate-500">+{items.length - 2}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ROOM STATUS SIDEBAR */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-3">
            Active Rooms ({rooms.length})
          </h3>

          {rooms.length === 0 ? (
            <div className="text-xs text-slate-500">No rooms created yet.</div>
          ) : (
            rooms.map((room) => {
              const today = new Date().toISOString().split('T')[0];
              const todayBookings = bookings.filter((b) => b.roomId === room.id && b.date === today);
              return (
                <div key={room.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="font-bold text-sm text-white">{room.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{room.description || 'No description'}</div>
                  <div className="text-[11px] text-emerald-400 mt-2 font-medium">
                    {todayBookings.length} booking{todayBookings.length !== 1 ? 's' : ''} today
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>



      {/* ========================================================================= */}
      {/* MODAL 1: ADD / EDIT BOOKING */}
      {/* ========================================================================= */}

      {isAddBookingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl my-8">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="text-base font-bold text-white">
                {editingBooking ? 'Edit Appointment' : 'Add New Calendar Booking'}
              </h3>
              <button onClick={closeBookingModal} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-4 text-xs">
              {/* Member Selection */}
              <div className="space-y-2">
                <label className="block text-slate-300 font-semibold">Select Member</label>

                <select
                  value={newBooking.clientId}
                  onChange={(e) => {
                    const c = clients.find((item) => item.id === e.target.value);
                    setNewBooking((prev) => ({
                      ...prev,
                      clientId: e.target.value,
                      clientName: c ? c.name : prev.clientName,
                      ghlContactId: c ? c.ghlContactId || '' : prev.ghlContactId,
                    }));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose from Local Roster ({clients.length}) --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {/* GHL Search */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-blue-400">🔍 Search & Select GoHighLevel Contact</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search GHL name, phone, email..."
                      value={ghlQuery}
                      onChange={(e) => setGhlQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearchGhl())}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSearchGhl}
                      disabled={isSearchingGhl}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg disabled:opacity-50"
                    >
                      {isSearchingGhl ? '...' : 'Search'}
                    </button>
                  </div>

                  {ghlResults.length > 0 && (
                    <div className="max-h-36 overflow-y-auto space-y-1 pt-1 border-t border-slate-800">
                      {ghlResults.map((contact) => (
                        <div
                          key={contact.id}
                          onClick={() => handleSelectGhlContact(contact)}
                          className="p-2 bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer flex justify-between items-center text-xs"
                        >
                          <div>
                            <div className="font-bold text-white">{contact.name}</div>
                            <div className="text-[10px] text-slate-400">{contact.email || contact.phone || 'GHL Contact'}</div>
                          </div>
                          <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-semibold">
                            Select
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  value={newBooking.clientName}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, clientName: e.target.value }))}
                  placeholder="Selected Member Name..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Appointment Type */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Appointment Type</label>
                <select
                  value={newBooking.appointmentTypeId}
                  onChange={(e) => handleTypeSelectChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">-- Select Type --</option>
                  {appointmentTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.durationMinutes} min)
                    </option>
                  ))}
                </select>
              </div>

              {/* Room */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Room</label>
                <select
                  value={newBooking.roomId}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, roomId: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">-- Select Room --</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    value={newBooking.date}
                    onChange={(e) => setNewBooking((prev) => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Time</label>
                  <input
                    type="time"
                    value={newBooking.time}
                    onChange={(e) => setNewBooking((prev) => ({ ...prev, time: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Duration (minutes)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={newBooking.durationMinutes}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, durationMinutes: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notes (optional)</label>
                <textarea
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  placeholder="Any notes..."
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
              >
                {editingBooking ? 'Save Changes' : 'Create Booking'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: MANAGE ROOMS */}
      {/* ========================================================================= */}
      {isOwner && isManageRoomsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Manage Database Rooms</h3>
              <button onClick={() => setIsManageRoomsOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRoom} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-slate-200">{editingRoom ? 'Edit Room' : 'Add New Room'}</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Room Name (e.g. InBody 270)"
                  value={roomFormData.name}
                  onChange={(e) => setRoomFormData((p) => ({ ...p, name: e.target.value }))}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-blue-500"
                  required
                />
                <input
                  type="text"
                  placeholder="Description..."
                  value={roomFormData.description}
                  onChange={(e) => setRoomFormData((p) => ({ ...p, description: e.target.value }))}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                {editingRoom && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRoom(null);
                      setRoomFormData({ name: '', description: '' });
                    }}
                    className="px-3 py-1 bg-slate-800 text-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                )}
                <button type="submit" className="px-4 py-1.5 bg-blue-600 font-bold text-white rounded-lg hover:bg-blue-500">
                  {editingRoom ? 'Update Room' : 'Add Room'}
                </button>
              </div>
            </form>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {rooms.map((room) => (
                <div key={room.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs">
                  <div>
                    <div className="font-bold text-white">{room.name}</div>
                    <div className="text-slate-400 text-[11px]">{room.description || 'No description'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingRoom(room);
                        setRoomFormData({ name: room.name, description: room.description || '' });
                      }}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteRoom(room.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: MANAGE APPOINTMENT TYPES */}
      {/* ========================================================================= */}
      {isOwner && isManageTypesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Manage Appointment Types</h3>
              <button onClick={() => setIsManageTypesOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveType} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-slate-200">{editingType ? 'Edit Type' : 'Add New Type'}</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Type Name (e.g. InBody Scan)"
                  value={typeFormData.name}
                  onChange={(e) => setTypeFormData((p) => ({ ...p, name: e.target.value }))}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-blue-500"
                  required
                />
                <input
                  type="number"
                  min="5"
                  step="5"
                  placeholder="Duration (min)"
                  value={typeFormData.durationMinutes}
                  onChange={(e) => setTypeFormData((p) => ({ ...p, durationMinutes: e.target.value }))}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                {editingType && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingType(null);
                      setTypeFormData({ name: '', durationMinutes: 15 });
                    }}
                    className="px-3 py-1 bg-slate-800 text-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                )}
                <button type="submit" className="px-4 py-1.5 bg-blue-600 font-bold text-white rounded-lg hover:bg-blue-500">
                  {editingType ? 'Update Type' : 'Add Type'}
                </button>
              </div>
            </form>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {appointmentTypes.map((typeItem) => (
                <div
                  key={typeItem.id}
                  className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{typeItem.name}</div>
                    <div className="text-amber-400 font-mono text-[11px]">{typeItem.durationMinutes} Minutes</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingType(typeItem);
                        setTypeFormData({ name: typeItem.name, durationMinutes: typeItem.durationMinutes });
                      }}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteType(typeItem.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}