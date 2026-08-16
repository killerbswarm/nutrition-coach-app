import React from 'react';

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

export default function ClientNotes({ notes = [], loadingGhl = false }) {
  if (loadingGhl) {
    return <div className="text-xs text-slate-400">Loading notes...</div>;
  }

  if (!notes.length) {
    return <div className="text-xs text-slate-400">No notes found</div>;
  }

  return (
    <div className="space-y-3">
      {notes.map((n, idx) => (
        <div
          key={n.id || idx}
          className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs"
        >
          <div className="text-slate-200 text-sm whitespace-pre-wrap">
            {n.body || n.note || ''}
          </div>
          <div className="text-[10px] text-slate-500 mt-2">
            {formatDate(n.dateAdded || n.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}