import React, { useState, useEffect, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

const SEND_URL =
  'https://us-central1-swarm-nutrition-app.cloudfunctions.net/sendGhlSms';

export default function ClientSms({
  selectedClient,
  messages = [],
  loadingGhl = false,
  onMessagesChange,
}) {
  const [smsText, setSmsText] = useState('');
  const [smsFile, setSmsFile] = useState(null);
  const [smsExpanded, setSmsExpanded] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

  const handleSendSms = async () => {
    if (!selectedClient) return;
    const ghlId =
      selectedClient.ghlContactId ||
      selectedClient.ghlId ||
      selectedClient.ghl ||
      selectedClient.contactId;
    if (!ghlId || ghlId === 'N/A' || String(ghlId).startsWith('dummy')) {
      return alert('No valid contact ID for SMS');
    }
    if (!smsText.trim() && !smsFile) return;

    setIsSendingSms(true);
    try {
      let attachmentUrl = null;
      if (smsFile) {
        const path = `sms-attachments/${selectedClient.id}/${Date.now()}_${smsFile.name.replace(
          /[^a-zA-Z0-9._-]/g,
          '_'
        )}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, smsFile);
        attachmentUrl = await getDownloadURL(storageRef);
      }

      const bodyText = smsText.trim() || (attachmentUrl ? ' ' : '');
      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: ghlId,
          message: bodyText,
          attachments: attachmentUrl ? [attachmentUrl] : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        alert(data.error || data.message || 'Send failed');
        return;
      }

      const optimistic = {
        body: bodyText,
        message: bodyText,
        direction: 'outbound',
        dateAdded: new Date().toISOString(),
        attachments: attachmentUrl ? [attachmentUrl] : [],
      };
      if (typeof onMessagesChange === 'function') {
        onMessagesChange([optimistic, ...(messages || [])]);
      }
      setSmsText('');
      setSmsFile(null);
    } catch (e) {
      alert(e.message || 'Send failed');
    } finally {
      setIsSendingSms(false);
    }
  };

  if (!selectedClient) return null;

  // Alias so pasted JSX that referenced ghlData.messages / loadingGhl still works
  const ghlData = { messages: messages || [] };

  return (
<div className="flex flex-col h-[min(550px,calc(100vh-14rem))] max-h-[calc(100vh-12rem)] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden min-h-0">
                  <div className="flex-1 min-h-0 p-4 overflow-y-auto overflow-x-hidden space-y-3 overscroll-contain">
                    {loadingGhl ? <div className="text-xs text-slate-400 text-center py-8">Loading...</div> :
                      ghlData.messages.length === 0 ? <div className="text-xs text-slate-400 text-center py-8">No messages found</div> : (
                        <>
                          {[...ghlData.messages]
                            .filter((m) => {
                              const body = String(m.body || m.message || m.text || m.msg || '').trim();
                              if (!body) return false;

                              // Hide GHL rows that are only an appointment type name (no real sentence)
                              const looksLikeTypeOnly =
                                body.length < 40 &&
                                !body.includes(' ') === false && // has spaces is ok; check below
                                !/[.!?]|booked|deleted|created|reschedule|see you|appointment is/i.test(body) &&
                                /^(inbody|goal setting|follow-?up|scan|consultation|check-?in)/i.test(body);

                              // Simpler rule: only type name, very short, no "booked"/"deleted"/etc.
                              const shortTypeOnly =
                                body.length <= 30 &&
                                !/\b(booked|deleted|created|cancelled|canceled|reschedule|see you|your appointment)\b/i.test(body) &&
                                /^[A-Za-z0-9 \-]+$/.test(body) &&
                                body.split(/\s+/).length <= 4;

                              if (shortTypeOnly) return false;
                              return true;
                            })
                            .reverse()
                            .map((m, idx) => {
                              const isClient = m.direction === 'inbound' || m.type === 1 || m.direction === 'in';

                              return (
                                <div key={idx} className={`max-w-[80%] p-3.5 rounded-2xl text-xs ${isClient ? 'bg-slate-800 text-slate-200 border border-slate-700 mr-auto' : 'bg-blue-600 text-white ml-auto'}`}>
                                  <div className="flex justify-between items-center mb-1 gap-4">
                                    <span className="font-bold">{isClient ? 'Client' : 'Coach'}</span>
                                    <span className="text-[10px] opacity-70">{formatDate(m.dateAdded || m.createdAt || m.date)}</span>
                                  </div>
                                  <div className="text-sm whitespace-pre-wrap">
                                    {(() => {
                                      const body = String(m.body || m.message || m.text || m.msg || '').trim();
                                      if (body && body !== '[object Object]') return body;

                                      // GHL appointment activity often has type/title but empty body
                                      const typeName =
                                        m.appointmentType ||
                                        m.typeName ||
                                        m.title ||
                                        m.subject ||
                                        (typeof m.type === 'string' ? m.type : '') ||
                                        '';
                                      const action = String(m.action || m.status || m.event || m.meta?.action || '').trim();

                                      if (action || typeName) {
                                        return [action, typeName].filter(Boolean).join(' · ') || 'Appointment update';
                                      }
                                      return '[No text]';
                                    })()}
                                  </div>
                                  {(String(m.type || m.messageType || m.contentType || '').toLowerCase().includes('appointment') ||
                                    String(m.body || m.message || '').toLowerCase().includes('appointment')) && (
                                      <div className="text-[10px] opacity-70 mt-1">Appointment activity</div>
                                    )}
                                </div>
                              );
                            })}
                          <div ref={messagesEndRef} />
                        </>
                      )}
                  </div>
                  <div className="shrink-0 border-t border-slate-800 bg-slate-950 p-3 space-y-2">
                    <textarea
                      value={smsText}
                      onChange={(e) => setSmsText(e.target.value)}
                      rows={smsExpanded ? 6 : 2}
                      placeholder="Type a message..."
                      className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none resize-y min-h-[48px]"
                    />

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSmsExpanded((v) => !v)}
                          className="text-[11px] font-bold text-slate-400 hover:text-white"
                        >
                          {smsExpanded ? 'Collapse' : 'Expand'}
                        </button>

                        <label className="cursor-pointer text-[11px] font-bold text-blue-400 hover:text-blue-300">
                          {smsFile ? 'Change photo' : 'Attach photo'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => setSmsFile(e.target.files?.[0] || null)}
                          />
                        </label>

                        {smsFile && (
                          <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                            {smsFile.name}
                            <button
                              type="button"
                              className="ml-1 text-red-400"
                              onClick={() => setSmsFile(null)}
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleSendSms}
                        disabled={isSendingSms || (!smsText.trim() && !smsFile)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg"
                      >
                        {isSendingSms ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
  );
}