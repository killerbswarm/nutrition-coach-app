import React, { useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

function formatDate(dateVal) {
  if (!dateVal) return '';
  try {
    let d;
    if (typeof dateVal === 'object' && dateVal.seconds) {
      d = new Date(dateVal.seconds * 1000);
    } else if (dateVal instanceof Date) {
      d = dateVal;
    } else {
      d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function ClientNotes({
  selectedClient,
  notes: ghlNotes = [],
  loadingGhl = false,
  canManage = false,
}) {
  const { currentUser } = useAuth();
  const [appNotes, setAppNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedClient?.id) {
      setAppNotes([]);
      return;
    }
    const q = query(
      collection(db, 'clients', selectedClient.id, 'notes'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => setAppNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setAppNotes([])
    );
    return () => unsub();
  }, [selectedClient?.id]);

  const addNote = async () => {
    const body = draft.trim();
    if (!body || !selectedClient?.id || !canManage) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'clients', selectedClient.id, 'notes'), {
        body,
        authorId: currentUser?.uid || '',
        authorName: currentUser?.displayName || currentUser?.email || 'Coach',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDraft('');
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id) => {
    const body = editText.trim();
    if (!body || !canManage) return;
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id, 'notes', id), {
        body,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEditText('');
    } catch (err) {
      alert(err.message);
    }
  };

  const removeNote = async (id) => {
    if (!canManage) return;
    if (!window.confirm('Delete this note?')) return;
    try {
      await deleteDoc(doc(db, 'clients', selectedClient.id, 'notes', id));
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">New note</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Add a coaching note…"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addNote}
              disabled={saving || !draft.trim()}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {appNotes.length === 0 && (
          <div className="text-xs text-slate-400">No coaching notes yet.</div>
        )}
        {appNotes.map((n) => (
          <div key={n.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
            {editingId === n.id ? (
              <div className="space-y-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(n.id)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-slate-200 text-sm whitespace-pre-wrap">{n.body}</div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="text-[10px] text-slate-500">
                    {n.authorName || 'Coach'} · {formatDate(n.updatedAt || n.createdAt)}
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(n.id);
                          setEditText(n.body || '');
                        }}
                        className="text-[10px] font-bold text-slate-300 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeNote(n.id)}
                        className="text-[10px] font-bold text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {(loadingGhl || ghlNotes.length > 0) && (
        <div className="pt-2">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">
            HighLevel notes
          </div>
          {loadingGhl && <div className="text-xs text-slate-400">Loading HighLevel notes…</div>}
          <div className="space-y-3">
            {ghlNotes.map((n, idx) => (
              <div key={n.id || idx} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-xs">
                <div className="text-slate-200 text-sm whitespace-pre-wrap">{n.body || n.note || ''}</div>
                <div className="text-[10px] text-slate-500 mt-2">{formatDate(n.dateAdded || n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}