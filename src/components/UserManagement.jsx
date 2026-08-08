import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { Trash2, Shield, User } from "lucide-react";

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
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("coach");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
    return () => unsub();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
      const secondaryAuth = getAuth(secondaryApp);

      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUser = userCredential.user;

      await setDoc(doc(db, "users", newUser.uid), {
        name: name,
        email: email,
        role: role,
        createdAt: new Date(),
      });

      await signOut(secondaryAuth);

      setSuccess(`Successfully added ${role === "owner" ? "Owner" : "Coach"}: ${name}`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("coach");
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
      setError("Failed to update role: " + err.message);
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`Are you sure you want to delete staff member "${userName}"?`)) return;

    try {
      await deleteDoc(doc(db, "users", userId));
      setSuccess(`Staff member "${userName}" deleted.`);
    } catch (err) {
      setError("Failed to delete staff member: " + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Add New Staff Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-1">Add New Staff Member</h2>
        <p className="text-sm text-slate-500 mb-6">Create new Coach or Owner credentials for the portal.</p>

        {error && <div className="p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm border border-red-200">{error}</div>}
        {success && <div className="p-3 mb-4 bg-emerald-50 text-emerald-600 rounded-lg text-sm border border-emerald-200">{success}</div>}

        <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Sarah Connor"
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              placeholder="sarah@gym.com"
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="coach">Coach</option>
              <option value="owner">Owner</option>
            </select>
          </div>

          <div className="md:col-span-2 flex justify-end mt-2">
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loading ? "Creating User..." : "Add Staff Member"}
            </button>
          </div>
        </form>
      </div>

      {/* Staff Roster & Role Management Table */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-4">Current Staff Roster</h2>
        <div className="divide-y divide-slate-100">
          {users.map((u) => (
            <div key={u.id} className="py-3 flex justify-between items-center gap-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${u.role === "owner" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                  {u.role === "owner" ? <Shield className="w-5 h-5" /> : <User className="w-5 h-5" />}
                </div>
                <div>
                  <div className="font-semibold text-slate-800">{u.name || "Unnamed Staff"}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <select
                  className="border border-slate-300 rounded-lg text-xs p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={u.role || "coach"}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                >
                  <option value="coach">Coach</option>
                  <option value="owner">Owner</option>
                </select>

                <button
                  onClick={() => handleDeleteUser(u.id, u.name || u.email)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete Staff Member"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}