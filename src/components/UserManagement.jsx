import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { initializeApp, getApps, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { Trash2, Shield, User } from "lucide-react";
import StaffPayouts from './StaffPayouts';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("coach");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "coach",
    ghlUserId: "",
  });
  const [selectedStaff, setSelectedStaff] = useState(null); // user object or null
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [ghlUserId, setGhlUserId] = useState("");
  
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
    return () => unsub();
  }, []);

    const openEditUser = (u) => {
    setEditingUser(u);
    setEditForm({
      name: u.name || "",
      email: u.email || "",
      phone: u.phone || "",
      role: u.role || "coach",
      ghlUserId: u.ghlUserId || "",
    });
    setIsEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    if (!editForm.name.trim()) return setError("Name is required");
    try {
      await updateDoc(doc(db, "users", editingUser.id), {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        role: editForm.role,
        ghlUserId: (editForm.ghlUserId || "").trim(),
        // email usually stays the Auth login — only update display field if you want:
        // email: editForm.email.trim().toLowerCase(),
        updatedAt: new Date(),
      });
      setSuccess("Staff member updated.");
      setIsEditOpen(false);
      setEditingUser(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const appName = "SecondaryApp";
      const existing = getApps().find((a) => a.name === appName);
      if (existing) await deleteApp(existing);

      const secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getAuth(secondaryApp);

      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUser = userCredential.user;

      await setDoc(doc(db, "users", newUser.uid), {
  name: name.trim(),
  email: email.trim().toLowerCase(),
  phone: phone.trim(),
  role: role,
  ghlUserId: (ghlUserId || "").trim(),
  createdAt: new Date(),
});

      await signOut(secondaryAuth);
      await deleteApp(secondaryApp);

      setSuccess(`Successfully added ${role === "owner" ? "Owner" : "Coach"}: ${name}`);
      setName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setRole("coach");
      setIsAddOpen(false);
      setGhlUserId("");
    } catch (err) {
      console.error("Error creating user:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      setSuccess("User role updated successfully.");
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePhoneChange = async (userId, newPhone) => {
    try {
      await updateDoc(doc(db, "users", userId), { phone: newPhone.trim() });
      setSuccess("Phone updated.");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (userId, label) => {
    if (!window.confirm(`Remove staff member "${label}" from the app roster?\n\n(Note: This removes their Firestore profile; the Auth login may still exist.)`)) return;
    try {
      await deleteDoc(doc(db, "users", userId));
      setSuccess("Staff member removed from roster.");
    } catch (err) {
      setError(err.message);
    }
  };

  const inputClass =
    "w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500";

   return (
    <div className="p-6 space-y-6 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">Staff</h1>
          <p className="text-xs text-slate-400 mt-1">
            Click a name for payout history · Add staff opens a form
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError("");
            setSuccess("");
            setName("");
            setEmail("");
            setPhone("");
            setPassword("");
            setRole("coach");
            setIsAddOpen(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl"
        >
          + Add Staff
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
          {success}
        </div>
      )}

      {/* Staff list */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
        {users.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">No staff yet</div>
        )}
        {users.map((u) => {
          const active = selectedStaff?.id === u.id;
          return (
            <div
              key={u.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedStaff(u)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedStaff(u);
              }}
              className={`w-full text-left p-3 rounded-xl border transition flex justify-between items-center gap-3 cursor-pointer ${
                active
                  ? "bg-blue-600/20 border-blue-500/40"
                  : "bg-slate-950 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`p-2 rounded-lg shrink-0 ${
                    u.role === "owner"
                      ? "bg-purple-500/15 text-purple-300"
                      : "bg-blue-500/15 text-blue-300"
                  }`}
                >
                  {u.role === "owner" ? <Shield className="w-5 h-5" /> : <User className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">{u.name || "Unnamed Staff"}</div>
                  <div className="text-xs text-slate-400 truncate">{u.email}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {u.phone ? `Phone: ${u.phone}` : "No phone"} · {u.role || "coach"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => openEditUser(u)}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteUser(u.id, u.name || u.email)}
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedStaff && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:static md:inset-auto md:block">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 md:hidden"
            aria-label="Close payouts"
            onClick={() => setSelectedStaff(null)}
          />
          <div className="relative bg-slate-950 border-t border-slate-800 rounded-t-2xl md:rounded-2xl md:border md:mt-2 max-h-[88vh] md:max-h-none overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800">
              <div className="min-w-0">
                <div className="text-[10px] uppercase font-bold tracking-wider text-blue-400">Payout history</div>
                <div className="text-base font-black text-white truncate">{selectedStaff.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaff(null)}
                className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              <StaffPayouts
                key={selectedStaff.id}
                selectedCoachName={selectedStaff.name}
                onClose={() => setSelectedStaff(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Add Staff modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Add Staff Member</h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 font-medium">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="Brian Cook"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Email (login)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="brian@crossfitswarm.com"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Phone (SMS alerts)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                  placeholder="4135551234"
                />
              </div>
              <div>
  <label className="text-xs text-slate-400 font-medium">GHL User ID</label>
  <input
    type="text"
    value={editForm.ghlUserId}
    onChange={(e) => setEditForm({ ...editForm, ghlUserId: e.target.value })}
    placeholder="GoHighLevel user id for this coach"
    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
  />
  <p className="text-[10px] text-slate-500 mt-1">
    Used so Slack / appointments show this coach, not Swarm App
  </p>
</div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Temp Password</label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className={inputClass}
                  placeholder="Min 6 characters"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  <option value="coach">Coach</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl"
                >
                  {loading ? "Creating..." : "Add Staff Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit modal — keep your existing block */}
      {isEditOpen && editingUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            {/* ... same edit fields as you already have ... */}
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Edit Staff</h3>
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 font-medium">Full Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Email (login)</label>
                <input type="email" value={editForm.email} disabled className={`${inputClass} opacity-60`} />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Phone (SMS alerts)</label>
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
  <label className="text-xs text-slate-400 font-medium">GHL User ID</label>
  <input
    type="text"
    value={editForm.ghlUserId || ''}
    onChange={(e) => setEditForm({ ...editForm, ghlUserId: e.target.value })}
    placeholder="GoHighLevel user id for this coach"
    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
  />
  <p className="text-[10px] text-slate-500 mt-1">
    So Slack / appointments show this coach, not Swarm App
  </p>
</div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className={inputClass}
                >
                  <option value="coach">Coach</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
