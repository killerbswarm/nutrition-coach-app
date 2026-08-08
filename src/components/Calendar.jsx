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

// Helper: Convert "HH:MM" to total minutes from midnight
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

export default function Calendar({ clients = [], ghlAppointments = [], selectedClient = null }) {
  // State for DB Collections
  const [bookings, setBookings] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [appointmentTypes, setAppointmentTypes] = useState([]);

  // UI Filter & Modals
  const [selectedRoomFilter, setSelectedRoomFilter] = useState('ALL');
  const [isAddBookingOpen, setIsAddBookingOpen] = useState(false);
  const [isManageRoomsOpen, setIsManageRoomsOpen] = useState(false);
  const [isManageTypesOpen, setIsManageTypesOpen] = useState(false);

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
        batch.set(r1, { name: 'InBody 270 Room', description: 'Standard body comp room', createdAt: new Date() });
        batch.set(r2, { name: 'InBody 570 Room', description: 'Advanced segmental body comp room', createdAt: new Date() });
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
        `https://searchghlcontacts-mllpdtijza-uc.a.run.app?query=${encodeURIComponent(ghlQuery)}`
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
    // Check if contact already exists in local clients roster
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
      // Auto-import GHL contact into Firestore clients collection so they appear in roster permanently
      try {
        const newClientDoc = {
          name: contact.name,
          email: contact.email || '',
          phone: contact.phone || '',
          ghlContactId: contact.id,
          coach: 'Coach Brian',
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
  // 3. APPOINTMENT TYPE SELECTION HANDLER (Auto-populates Duration)
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
  // 4. BOOKING CREATION & OVERLAP PREVENTION
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

    // OVERLAP CHECK: Calculate start & end time window per room & date
    const hasOverlap = bookings.some((b) => {
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

    try {
      await addDoc(collection(db, 'bookings'), {
        clientId: newBooking.clientId,
        clientName: newBooking.clientName,
        ghlContactId: newBooking.ghlContactId || '',
        appointmentTypeId: newBooking.appointmentTypeId,
        appointmentTypeName: selectedTypeObj?.name || 'Appointment',
        roomId: newBooking.roomId,
        roomName: selectedRoomObj?.name || 'Room',
        date: newBooking.date,
        time: newBooking.time,
        durationMinutes: Number(newBooking.durationMinutes),
        notes: newBooking.notes,
        createdAt: new Date(),
      });

      setIsAddBookingOpen(false);
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
      });
    } catch (err) {
      console.error('Error creating booking:', err);
      alert('Failed to save booking: ' + err.message);
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
      time: a.startTime ? new Date(a.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled',
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
          <h2 className="text-2xl font-black text-white">Master Calendar & Bookings</h2>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic room schedule & appointment booking system.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            ⚙️ Manage Appt Types ({appointmentTypes.length})
          </button>

          <button
            onClick={() => setIsAddBookingOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 font-bold text-xs rounded-xl shadow-lg transition-colors text-white"
          >
            ➕ Add New Booking
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* MAIN SCHEDULE COLUMN */}
        <div className="md:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
          <div className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-3 gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Schedule</h3>

              {/* Dynamic Room Filter Tabs */}
              <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] overflow-x-auto">
                <button
                  onClick={() => setSelectedRoomFilter('ALL')}
                  className={`px-2.5 py-1 font-bold rounded-md transition-all ${
                    selectedRoomFilter === 'ALL' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Rooms
                </button>
                {rooms.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoomFilter(r.id)}
                    className={`px-2.5 py-1 font-bold rounded-md transition-all whitespace-nowrap ${
                      selectedRoomFilter === r.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>

            <span className="text-xs text-slate-400 font-mono">{filteredAppointments.length} Bookings</span>
          </div>

          {filteredAppointments.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
              No upcoming appointments booked for this view.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAppointments.map((appt) => (
                <div
                  key={appt.id}
                  className="p-4 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl flex justify-between items-center transition-all"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{appt.appointmentTypeName}</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          appt.source === 'GHL'
                            ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}
                      >
                        {appt.source}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {appt.roomName}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full">
                        {appt.durationMinutes} min
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Member: <span className="text-slate-200 font-medium">{appt.clientName}</span>
                    </div>
                    {appt.notes && <div className="text-[11px] text-slate-500 italic mt-1">{appt.notes}</div>}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-blue-400 font-bold">{appt.date}</div>
                      <div className="text-[11px] text-slate-400">{appt.time}</div>
                    </div>
                    {appt.source === 'Local' && (
                      <button
                        onClick={() => handleDeleteBooking(appt.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete Booking"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ROOM STATUS SIDEBAR */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-3">
            Active Rooms ({rooms.length})
          </h3>

          {rooms.length === 0 ? (
            <div className="text-xs text-slate-500 py-4">No rooms added. Click "Manage Rooms" to add one.</div>
          ) : (
            rooms.map((room) => {
              const todayStr = new Date().toISOString().split('T')[0];
              const roomTodayBookings = bookings.filter((b) => b.roomId === room.id && b.date === todayStr);

              return (
                <div key={room.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-emerald-400 text-sm">{room.name}</span>
                    <span className="px-2 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold rounded-full">
                      {roomTodayBookings.length} Today
                    </span>
                  </div>
                  <p className="text-slate-400">{room.description || 'Configured room station'}</p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: ADD BOOKING MODAL (WITH LIVE GHL SEARCH) */}
      {/* ========================================================================= */}
      {isAddBookingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl my-8">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="text-base font-bold text-white">Add New Calendar Booking</h3>
              <button onClick={() => setIsAddBookingOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-4 text-xs">
              {/* Member Selection Section */}
              <div className="space-y-2">
                <label className="block text-slate-300 font-semibold">Select Member</label>

                {/* Option A: Pick from Local Roster */}
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
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                </select>

                {/* Option B: Search GHL Contacts Live */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-blue-400 flex items-center justify-between">
                    <span>🔍 Search & Select GoHighLevel Contact</span>
                  </div>
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

                  {/* Search Results dropdown */}
                  {ghlResults.length > 0 && (
                    <div className="max-h-36 overflow-y-auto space-y-1 pt-1 border-t border-slate-800">
                      {ghlResults.map((contact) => (
                        <div
                          key={contact.id}
                          onClick={() => handleSelectGhlContact(contact)}
                          className="p-2 bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer flex justify-between items-center text-xs transition-colors"
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

                {/* Option C: Final Selected / Custom Name Input */}
                <input
                  type="text"
                  value={newBooking.clientName}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, clientName: e.target.value }))}
                  placeholder="Selected Member Name..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Dynamic Appointment Type Selection */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Appointment Type</label>
                <select
                  value={newBooking.appointmentTypeId}
                  onChange={(e) => handleTypeSelectChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                >
                  {appointmentTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.durationMinutes} min)
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic Room Selection */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Room / Machine</label>
                <select
                  value={newBooking.roomId}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, roomId: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date, Time, Duration */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    value={newBooking.date}
                    onChange={(e) => setNewBooking((prev) => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-200 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newBooking.time}
                    onChange={(e) => setNewBooking((prev) => ({ ...prev, time: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-200 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Duration (min)</label>
                  <input
                    type="number"
                    value={newBooking.durationMinutes}
                    onChange={(e) => setNewBooking((prev) => ({ ...prev, durationMinutes: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-200 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional appointment notes..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddBookingOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500">
                  Save Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: MANAGE ROOMS MODAL (ADD / EDIT / DELETE) */}
      {/* ========================================================================= */}
      {isManageRoomsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Manage Database Rooms</h3>
              <button onClick={() => setIsManageRoomsOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {/* Room Add / Edit Form */}
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

            {/* Existing Rooms List */}
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
      {/* MODAL 3: MANAGE APPOINTMENT TYPES MODAL (ADD / EDIT / DELETE) */}
      {/* ========================================================================= */}
      {isManageTypesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Manage Appointment Types</h3>
              <button onClick={() => setIsManageTypesOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {/* Type Add / Edit Form */}
            <form onSubmit={handleSaveType} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-slate-200">{editingType ? 'Edit Type' : 'Add New Type'}</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Name (e.g. InBody Scan)"
                  value={typeFormData.name}
                  onChange={(e) => setTypeFormData((p) => ({ ...p, name: e.target.value }))}
                  className="col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-blue-500"
                  required
                />
                <input
                  type="number"
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

            {/* Existing Types List */}
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