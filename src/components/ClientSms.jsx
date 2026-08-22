import React, { useState, useEffect, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, storage } from '../firebase';

const SEND_URL =
  'https://us-central1-swarm-nutrition-app.cloudfunctions.net/sendGhlSms';
const CANCEL_URL =
  'https://us-central1-swarm-nutrition-app.cloudfunctions.net/cancelScheduledGhlSms';

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

function localInputToUnixSeconds(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

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
  const [scheduleAt, setScheduleAt] = useState('');
  const [toast, setToast] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null); // messageId
  const messagesEndRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // When a scheduled time passes, flip local bubbles to "sent" and re-render
  useEffect(() => {
    const pending = (messages || []).filter((m) => {
      if (!m.scheduledFor && m.status !== 'scheduled') return false;
      const t = new Date(m.scheduledFor || m.dateAdded || 0).getTime();
      return t > Date.now();
    });
    if (!pending.length) return undefined;

    const timers = pending.map((m) => {
      const when = new Date(m.scheduledFor || m.dateAdded).getTime();
      const delay = Math.max(when - Date.now() + 1500, 1000);
      return setTimeout(() => {
        if (typeof onMessagesChange !== 'function') return;
        const next = (messages || []).map((row) => {
          const idMatch =
            (m.id && row.id === m.id) ||
            (m.messageId && row.messageId === m.messageId) ||
            (row.body === m.body && row.scheduledFor === m.scheduledFor);
          if (!idMatch) return row;
          return {
            ...row,
            status: 'sent',
            scheduledFor: null,
            dateAdded: row.scheduledFor || row.dateAdded,
          };
        });
        onMessagesChange(next);
      }, delay);
    });

    // also tick once a minute in case tab slept
    const poll = setInterval(() => {
      const anyDue = (messages || []).some((m) => {
        if (m.status !== 'scheduled' && !m.scheduledFor) return false;
        const t = new Date(m.scheduledFor || 0).getTime();
        return t && t <= Date.now();
      });
      if (!anyDue || typeof onMessagesChange !== 'function') return;
      onMessagesChange(
        (messages || []).map((row) => {
          if (row.status !== 'scheduled' && !row.scheduledFor) return row;
          const t = new Date(row.scheduledFor || 0).getTime();
          if (!t || t > Date.now()) return row;
          return {
            ...row,
            status: 'sent',
            scheduledFor: null,
            dateAdded: row.scheduledFor || row.dateAdded,
          };
        })
      );
    }, 30000);

    return () => {
      timers.forEach(clearTimeout);
      clearInterval(poll);
    };
  }, [messages, onMessagesChange]);



  // Load pending scheduled SMS from Firestore so amber bubbles survive refresh
  useEffect(() => {
    if (!selectedClient) return undefined;
    const ghlId =
      selectedClient.ghlContactId ||
      selectedClient.ghlId ||
      selectedClient.ghl ||
      selectedClient.contactId;
    if (!ghlId || ghlId === 'N/A') return undefined;

    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'scheduled_sms'),
          where('contactId', '==', String(ghlId)),
          where('status', '==', 'scheduled')
        );
        const snap = await getDocs(q);
        if (cancelled || !snap.size) return;
        const pending = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: data.messageId || d.id,
            firestoreId: d.id,
            body: data.body || data.message || '',
            message: data.body || data.message || '',
            direction: 'outbound',
            dateAdded: data.scheduledFor,
            scheduledFor: data.scheduledFor,
            status: 'scheduled',
            attachments: data.attachments || [],
          };
        });
        if (typeof onMessagesChange === 'function') {
          const existing = messages || [];
          const ids = new Set(existing.map((m) => m.id).filter(Boolean));
          const bodies = new Set(
            existing
              .filter((m) => m.status === 'scheduled')
              .map((m) => `${m.body}|${m.scheduledFor}`)
          );
          const toAdd = pending.filter((p) => {
            if (p.id && ids.has(p.id)) return false;
            if (bodies.has(`${p.body}|${p.scheduledFor}`)) return false;
            return true;
          });
          if (toAdd.length) onMessagesChange([...toAdd, ...existing]);
        }
      } catch (err) {
        console.warn('scheduled_sms load', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // only when client changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id]);

  const handleSendSms = async () => {
    if (!selectedClient) return;
    const ghlId =
      selectedClient.ghlContactId ||
      selectedClient.ghlId ||
      selectedClient.ghl ||
      selectedClient.contactId;
    if (!ghlId || ghlId === 'N/A' || String(ghlId).startsWith('dummy')) {
      return showToast('No valid contact ID for SMS');
    }
    if (!smsText.trim() && !smsFile) return;

    let scheduledTimestamp = null;
    if (scheduleAt) {
      scheduledTimestamp = localInputToUnixSeconds(scheduleAt);
      if (!scheduledTimestamp) return showToast('Invalid schedule time');
      if (scheduledTimestamp < Math.floor(Date.now() / 1000) + 90) {
        return showToast('Pick a time at least 2 minutes from now');
      }
    }

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
      const payload = {
        contactId: ghlId,
        message: bodyText,
        attachments: attachmentUrl ? [attachmentUrl] : [],
      };
      if (scheduledTimestamp) payload.scheduledTimestamp = scheduledTimestamp;

      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        showToast(data.error || data.message || 'Send failed');
        return;
      }

      const whenIso = scheduledTimestamp
        ? new Date(scheduledTimestamp * 1000).toISOString()
        : new Date().toISOString();

      const messageId =
        data.messageId ||
        data.message?.id ||
        data.message?.messageId ||
        null;

      const optimistic = {
        id: messageId || `local-${Date.now()}`,
        body: bodyText,
        message: bodyText,
        direction: 'outbound',
        dateAdded: whenIso,
        scheduledFor: scheduledTimestamp ? whenIso : null,
        status: scheduledTimestamp ? 'scheduled' : 'sent',
        attachments: attachmentUrl ? [attachmentUrl] : [],
      };

      if (scheduledTimestamp) {
        try {
          const refDoc = await addDoc(collection(db, 'scheduled_sms'), {
            contactId: String(ghlId),
            clientId: selectedClient.id || null,
            messageId: messageId || null,
            body: bodyText,
            message: bodyText,
            scheduledFor: whenIso,
            status: 'scheduled',
            attachments: attachmentUrl ? [attachmentUrl] : [],
            createdAt: serverTimestamp(),
          });
          optimistic.firestoreId = refDoc.id;
          if (!optimistic.id || String(optimistic.id).startsWith('local-')) {
            optimistic.id = messageId || refDoc.id;
          }
        } catch (err) {
          console.warn('scheduled_sms save', err);
        }
      }

      if (typeof onMessagesChange === 'function') {
        onMessagesChange([optimistic, ...(messages || [])]);
      }

      showToast(
        scheduledTimestamp
          ? `Scheduled for ${formatDate(whenIso)}`
          : 'Message sent'
      );

      setSmsText('');
      setScheduleAt('');
      setSmsFile(null);
    } catch (e) {
      showToast(e.message || 'Send failed');
    } finally {
      setIsSendingSms(false);
    }
  };

  const handleCancelScheduled = (messageId) => {
    if (!messageId) {
      showToast('Missing message id — try canceling in GHL');
      return;
    }
    setConfirmCancel(messageId);
  };

  const confirmCancelScheduled = async () => {
    const messageId = confirmCancel;
    if (!messageId) return;
    setConfirmCancel(null);
    try {
      const res = await fetch(CANCEL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json().catch(() => ({}));
      const errText = String(data.error || data.message || data.details?.message || '');
      const alreadyGone =
        !res.ok &&
        (/not found|does not exist|404|no longer|already|invalid/i.test(errText) ||
          res.status === 404);
      if (!res.ok && !alreadyGone && data.error) {
        showToast(errText || 'Cancel failed');
        return;
      }
      // remove Firestore mirror if present (even if GHL already deleted it)
      const row = (messages || []).find(
        (m) => m.id === messageId || m.messageId === messageId
      );
      if (row?.firestoreId) {
        try {
          await deleteDoc(doc(db, 'scheduled_sms', row.firestoreId));
        } catch (err) {
          console.warn('scheduled_sms delete', err);
        }
      } else {
        // fallback: query by messageId
        try {
          const q = query(
            collection(db, 'scheduled_sms'),
            where('messageId', '==', String(messageId))
          );
          const snap = await getDocs(q);
          await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
        } catch (err) {
          console.warn('scheduled_sms delete query', err);
        }
      }

      if (typeof onMessagesChange === 'function') {
        onMessagesChange(
          (messages || []).filter(
            (m) => m.id !== messageId && m.messageId !== messageId
          )
        );
      }
      showToast(alreadyGone ? 'Already gone in GHL — cleared from app' : 'Scheduled message canceled');
    } catch (e) {
      showToast(e.message || 'Cancel failed');
    }
  };

  if (!selectedClient) return null;

  const list = messages || [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'min(550px, calc(100vh - 14rem))',
        maxHeight: 'calc(100vh - 12rem)',
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        background: '#fff',
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 16,
          overflowY: 'auto',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {loadingGhl ? (
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: 32 }}>
            Loading...
          </div>
        ) : list.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: 32 }}>
            No messages found
          </div>
        ) : (
          <>
            {[...list]
              .filter((m) => {
                const body = String(m.body || m.message || m.text || m.msg || '').trim();
                if (!body) return false;
                // Always keep scheduled + normal outbound coach SMS (even short tests like "730")
                if (
                  m.status === 'scheduled' ||
                  m.scheduledFor ||
                  m.direction === 'outbound' ||
                  m.direction === 'out'
                ) {
                  return true;
                }
                const shortTypeOnly =
                  body.length <= 30 &&
                  !/\b(booked|deleted|created|cancelled|canceled|reschedule|see you|your appointment)\b/i.test(
                    body
                  ) &&
                  /^[A-Za-z0-9 \-]+$/.test(body) &&
                  body.split(/\s+/).length <= 4;
                return !shortTypeOnly;
              })
              .reverse()
              .map((m, idx) => {
                const isClient =
                  m.direction === 'inbound' || m.type === 1 || m.direction === 'in';
                const scheduledForMs = m.scheduledFor
                  ? new Date(m.scheduledFor).getTime()
                  : 0;
                const stillQueued =
                  scheduledForMs > Date.now() + 5000 &&
                  (m.status === 'scheduled' ||
                    String(m.status || '').toLowerCase() === 'scheduled' ||
                    !!m.scheduledFor);
                // Once the time has passed, show as a normal sent coach message
                const isScheduled = stillQueued;
                const timeLabel = formatDate(
                  isScheduled
                    ? m.scheduledFor || m.dateAdded || m.date
                    : m.dateAdded || m.createdAt || m.scheduledFor || m.date
                );

                return (
                  <div
                    key={m.id || idx}
                    style={{
                      maxWidth: '80%',
                      padding: '12px 14px',
                      borderRadius: 16,
                      fontSize: 12,
                      alignSelf: isClient ? 'flex-start' : 'flex-end',
                      background: isClient ? '#fff' : isScheduled ? '#f59e0b' : '#2563eb',
                      color: isClient ? '#1e293b' : '#fff',
                      border: isClient ? '1px solid #e2e8f0' : 'none',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 16,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>
                        {isClient ? 'Client' : isScheduled ? 'Scheduled' : 'Coach'}
                      </span>
                      <span style={{ fontSize: 10, opacity: 0.85 }}>
                        {isScheduled ? `For ${timeLabel}` : timeLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                      {String(m.body || m.message || m.text || m.msg || '').trim() || '[No text]'}
                    </div>
                    {isScheduled && (
                      <div
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 10, opacity: 0.95, fontWeight: 600 }}>
                          Queued — will send at this time
                        </span>
                        {(m.id || m.messageId) && (
                          <button
                            type="button"
                            onClick={() => handleCancelScheduled(m.id || m.messageId)}
                            style={{
                              border: '1px solid rgba(255,255,255,0.7)',
                              background: 'rgba(0,0,0,0.15)',
                              color: '#fff',
                              fontSize: 10,
                              fontWeight: 700,
                              borderRadius: 6,
                              padding: '3px 8px',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid #e2e8f0',
          background: '#fff',
          padding: 12,
        }}
      >
        <textarea
          value={smsText}
          onChange={(e) => setSmsText(e.target.value)}
          rows={smsExpanded ? 6 : 2}
          placeholder="Type a message..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '10px 12px',
            fontSize: 14,
            color: '#0f172a',
            background: '#f8fafc',
            resize: 'vertical',
            minHeight: 48,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />

        {scheduleAt && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 600,
              color: '#92400e',
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>Will send {formatDate(scheduleAt)}</span>
            <button
              type="button"
              onClick={() => setScheduleAt('')}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#b45309',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: 12,
                textDecoration: 'underline',
              }}
            >
              Clear
            </button>
          </div>
        )}

        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => setSmsExpanded((v) => !v)}
              style={{
                border: 'none',
                background: 'none',
                fontSize: 12,
                fontWeight: 700,
                color: '#64748b',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {smsExpanded ? 'Collapse' : 'Expand'}
            </button>
            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#2563eb',
                cursor: 'pointer',
              }}
            >
              {smsFile ? 'Change photo' : 'Attach photo'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => setSmsFile(e.target.files?.[0] || null)}
              />
            </label>
            {smsFile && (
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {smsFile.name}{' '}
                <button
                  type="button"
                  onClick={() => setSmsFile(null)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#dc2626',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              style={{
                height: 36,
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '0 10px',
                fontSize: 13,
                color: '#0f172a',
                background: '#fff',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={handleSendSms}
              disabled={isSendingSms || (!smsText.trim() && !smsFile)}
              style={{
                height: 36,
                padding: '0 16px',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                cursor:
                  isSendingSms || (!smsText.trim() && !smsFile)
                    ? 'not-allowed'
                    : 'pointer',
                opacity: isSendingSms || (!smsText.trim() && !smsFile) ? 0.5 : 1,
                background: scheduleAt ? '#f59e0b' : '#2563eb',
                whiteSpace: 'nowrap',
              }}
            >
              {isSendingSms
                ? scheduleAt
                  ? 'Scheduling...'
                  : 'Sending...'
                : scheduleAt
                  ? 'Schedule'
                  : 'Send now'}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: '#0f172a',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            maxWidth: '90vw',
          }}
        >
          {toast}
        </div>
      )}

      {confirmCancel && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setConfirmCancel(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 20,
              width: '100%',
              maxWidth: 360,
              boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
              Cancel scheduled message?
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 1.4 }}>
              This removes it from the queue in the app and in GHL. It will not be sent.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmCancel(null)}
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  color: '#334155',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={confirmCancelScheduled}
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#dc2626',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}