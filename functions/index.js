const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");

const GOOGLE_SA_KEY = defineSecret("GOOGLE_SA_KEY"); // use the secret name you set
const CALENDAR_TIMEZONE = "America/New_York";
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const FATSECRET_CLIENT_ID = defineSecret("FATSECRET_CLIENT_ID");
const FATSECRET_CLIENT_SECRET = defineSecret("FATSECRET_CLIENT_SECRET");
const FATSECRET_CONSUMER_KEY = defineSecret("FATSECRET_CONSUMER_KEY");
const FATSECRET_CONSUMER_SECRET = defineSecret("FATSECRET_CONSUMER_SECRET");
// --- GHL & INBODY API CONFIGURATION ---
const GHL_API_TOKEN = process.env.GHL_API_TOKEN || "pit-b6637265-a6ff-47cf-bcda-78df37fb3526";
const GHL_API_VERSION = "2021-07-28";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "tNtRSRKPPnHXZjLAo4zs";

const INBODY_API_KEY = process.env.INBODY_API_KEY || "dGKyIYZEo88HN9IqnFTh+I2TsesRtGNE8bijk5kwLH0=";
const INBODY_ACCOUNT = process.env.INBODY_ACCOUNT || "swarm";

async function getFatSecretAccessToken() {
  const id = FATSECRET_CLIENT_ID.value();
  const secret = FATSECRET_CLIENT_SECRET.value();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=basic",
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      `FatSecret token failed: ${res.status} ${JSON.stringify(data)}`
    );
  }
  return data.access_token;
}

function fatSecretDateInt(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return Math.floor(utc / 86400000);
}

function oauth1Sign({ method, url, params, consumerSecret, tokenSecret = "" }) {
  const normalized = Object.keys(params)
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`
    )
    .join("&");

  const base = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(normalized),
  ].join("&");

  const key = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(
    tokenSecret
  )}`;

  return crypto.createHmac("sha1", key).update(base).digest("base64");
}

function parseOAuthBody(text) {
  const out = {};
  String(text || "")
    .split("&")
    .forEach((pair) => {
      const [k, v] = pair.split("=");
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || "");
    });
  return out;
}

async function fatSecretOAuth1Request({
  methodParams,
  token = "",
  tokenSecret = "",
}) {
  const url = "https://platform.fatsecret.com/rest/server.api";
  const consumerKey = FATSECRET_CONSUMER_KEY.value();
  const consumerSecret = FATSECRET_CONSUMER_SECRET.value();

  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...(token ? { oauth_token: token } : {}),
  };

  const allParams = { ...methodParams, ...oauth };
  oauth.oauth_signature = oauth1Sign({
    method: "POST",
    url,
    params: allParams,
    consumerSecret,
    tokenSecret,
  });

  const body = new URLSearchParams({ ...methodParams, ...oauth }).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}


// Helper: Parse LookinBody YYYYMMDDHHmmss timestamp into ISO Date String
const parseInBodyDate = (dateStr) => {
  if (!dateStr) return new Date().toISOString();
  const str = String(dateStr).trim();
  if (/^\d{8,14}$/.test(str)) {
    const year = str.substring(0, 4);
    const month = str.substring(4, 6);
    const day = str.substring(6, 8);
    const hour = str.length >= 10 ? str.substring(8, 10) : "12";
    const min = str.length >= 12 ? str.substring(10, 12) : "00";
    const sec = str.length >= 14 ? str.substring(12, 14) : "00";
    // InBody TestDatetimes is local device time (Eastern for CrossFit Swarm), not UTC
    const local = new Date(
      `${year}-${month}-${day}T${hour}:${min}:${sec}-04:00`
    );
    return isNaN(local.getTime())
      ? new Date().toISOString()
      : local.toISOString();
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

// Helper: Case-insensitive metric extractor
const findMetric = (obj, ...targetNames) => {
  if (!obj || typeof obj !== "object") return 0;
  const normalizedTargets = targetNames.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""));

  for (const [key, val] of Object.entries(obj)) {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedTargets.includes(cleanKey)) {
      if (Array.isArray(val) && val.length > 0) {
        const num = parseFloat(val[0]);
        if (!isNaN(num) && num > 0) return num;
      }
      const num = parseFloat(val);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return 0;
};

// Helper: Case-insensitive date string extractor
const findDateStr = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  const dateKeys = ["testdatetimes", "datetimes", "testdate", "date", "createdat", "time", "datetime"];
  for (const [key, val] of Object.entries(obj)) {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (dateKeys.includes(cleanKey) && val) {
      return String(val);
    }
  }
  return null;
};

// Helper: Find existing member document in Firestore
async function findMemberDoc(email, ghlId) {
  if (email) {
    const emailDocId = email.replace(/[^a-zA-Z0-9]/g, "_");
    const docByEmail = await db.collection("members").doc(emailDocId).get();
    if (docByEmail.exists) return docByEmail.ref;

    const q = await db.collection("members").where("email", "==", email).limit(1).get();
    if (!q.empty) return q.docs[0].ref;
  }

  if (ghlId) {
    const docByGhl = await db.collection("members").doc(ghlId).get();
    if (docByGhl.exists) return docByGhl.ref;
  }

  const defaultId = email ? email.replace(/[^a-zA-Z0-9]/g, "_") : ghlId || `user_${Date.now()}`;
  return db.collection("members").doc(defaultId);
}

// =========================================================================
// ENDPOINT 1: GHL New Member Signup Webhook
// =========================================================================
exports.ghlNewMemberWebhook = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const payload = req.body;
    const email = payload.email || payload.contact?.email;
    const ghlId = payload.contact_id || payload.contact?.id || payload.id;
    const firstName = payload.first_name || payload.contact?.first_name || "New";
    const lastName = payload.last_name || payload.contact?.last_name || "Member";
    const phone = payload.phone || payload.contact?.phone || "";

    if (!email && !ghlId) {
      return res.status(400).json({ error: "Missing email or contact_id" });
    }

    const memberRef = await findMemberDoc(email, ghlId);
    const memberDoc = await memberRef.get();

    if (memberDoc.exists) {
      return res.status(200).json({ message: "Member already exists", id: memberRef.id });
    }

    const newPendingMember = {
      id: memberRef.id,
      firstName,
      lastName,
      email: email || "",
      phone: phone || "",
      dateAdded: new Date().toISOString(),
      startDate: null,
      currentWeek: 0,
      weekOverride: null,
      status: "pending",
      weeklyCheckIns: {},
      lastCheckIn: null,
      riskLevel: "pending",
      inBodyScans: { scan1: false, scan2: false, scan3: false },
    };

    await memberRef.set(newPendingMember);

    return res.status(200).json({
      success: true,
      message: `Pending member created for ${firstName} ${lastName}.`,
      member: newPendingMember,
    });
  } catch (err) {
    console.error("New Member Webhook Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

// =========================================================================
// ENDPOINT 2: GHL Check-In Webhook
// =========================================================================
exports.ghlCheckInWebhook = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const payload = req.body;
    const email = payload.email || payload.contact?.email;
    const ghlId = payload.contact_id || payload.contact?.id || payload.id;
    const firstName = payload.first_name || payload.contact?.first_name || "New";
    const lastName = payload.last_name || payload.contact?.last_name || "Member";
    const phone = payload.phone || payload.contact?.phone || "";

    if (!email && !ghlId) {
      return res.status(400).json({ error: "Missing email or contact_id" });
    }

    const memberRef = await findMemberDoc(email, ghlId);
    const memberDoc = await memberRef.get();
    const now = new Date();

    let memberData;

    if (!memberDoc.exists || memberDoc.data().status === "pending") {
      const existingData = memberDoc.exists ? memberDoc.data() : {};

      memberData = {
        id: memberRef.id,
        firstName: existingData.firstName || firstName,
        lastName: existingData.lastName || lastName,
        email: existingData.email || email || "",
        phone: existingData.phone || phone || "",
        dateAdded: existingData.dateAdded || now.toISOString(),
        startDate: now.toISOString(),
        currentWeek: 1,
        weekOverride: null,
        status: "active",
        weeklyCheckIns: { 1: 1 },
        lastCheckIn: now.toISOString(),
        riskLevel: "high",
        inBodyScans: existingData.inBodyScans || { scan1: false, scan2: false, scan3: false },
      };
      await memberRef.set(memberData, { merge: true });
    } else {
      const existing = memberDoc.data();
      const currentWeek = existing.currentWeek || 1;
      const currentWeeklyCounts = existing.weeklyCheckIns || {};
      const newCountForWeek = (currentWeeklyCounts[currentWeek] || 0) + 1;

      currentWeeklyCounts[currentWeek] = newCountForWeek;

      memberData = {
        ...existing,
        currentWeek,
        weeklyCheckIns: currentWeeklyCounts,
        lastCheckIn: now.toISOString(),
      };

      await memberRef.update({
        currentWeek,
        weeklyCheckIns: currentWeeklyCounts,
        lastCheckIn: now.toISOString(),
      });
    }

    await db.collection("check_ins").add({
      memberId: memberRef.id,
      email: email || "",
      timestamp: now.toISOString(),
      weekNumber: memberData.currentWeek,
      source: "GHL Webhook",
      rawPayload: payload,
    });

    return res.status(200).json({
      success: true,
      message: `Check-in logged for ${firstName} ${lastName}`,
      member: memberData,
    });
  } catch (err) {
    console.error("Check-In Webhook Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

// =========================================================================
// ENDPOINT 3: Fetch GHL Notes, Appointments & Messages for Dashboard
// =========================================================================
exports.getGhlContactDetails = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    const { contactId, email, locationId: queryLocId } = req.query;
    const locationId = queryLocId || GHL_LOCATION_ID;

    if (!contactId && !email) {
      return res.status(400).json({ error: "Missing contactId or email" });
    }

    let resolvedContactId = contactId && contactId !== "N/A" && !contactId.startsWith("dummy") ? contactId : null;

    if (!resolvedContactId && email) {
      const searchRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}`,
        {
          headers: {
            Authorization: `Bearer ${GHL_API_TOKEN}`,
            Version: GHL_API_VERSION,
          },
        }
      );
      const searchData = await searchRes.json();

      if (!searchRes.ok) {
        console.error("GHL Contact Search Error:", searchData);
        return res.status(200).json({ notes: [], appointments: [], messages: [] });
      }

      resolvedContactId = searchData.contacts?.[0]?.id;
    }

    if (!resolvedContactId) {
      return res.status(200).json({ notes: [], appointments: [], messages: [] });
    }

    const [notesRes, eventsRes, apptsRes, convosRes] = await Promise.all([
      fetch(`https://services.leadconnectorhq.com/contacts/${resolvedContactId}/notes`, {
        headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION },
      }),
      fetch(`https://services.leadconnectorhq.com/calendars/events?locationId=${locationId}&contactId=${resolvedContactId}`, {
        headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION },
      }),
      fetch(`https://services.leadconnectorhq.com/contacts/${resolvedContactId}/appointments`, {
        headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION },
      }),
      fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${locationId}&contactId=${resolvedContactId}`, {
        headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION },
      }),
    ]);

    const notesData = await notesRes.json();
    const eventsData = await eventsRes.json();
    const apptsData = await apptsRes.json();
    const convosData = await convosRes.json();

    const combinedAppointments = [
      ...(eventsData.events || []),
      ...(apptsData.appointments || []),
      ...(apptsData.events || []),
    ];

    const uniqueAppointments = Array.from(
      new Map(combinedAppointments.map((item) => [item.id, item])).values()
    );

    let messages = [];
    const conversationId = convosData.conversations?.[0]?.id;
    if (conversationId) {
      const msgRes = await fetch(`https://services.leadconnectorhq.com/conversations/${conversationId}/messages`, {
        headers: { Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION },
      });
      const msgData = await msgRes.json();
      messages = msgData.messages?.messages || msgData.messages || [];
    }

    return res.status(200).json({
      contactId: resolvedContactId,
      notes: notesData.notes || [],
      appointments: uniqueAppointments,
      messages: messages.slice(0, 50),
    });
  } catch (err) {
    console.error("GHL Sync Error:", err);
    return res.status(500).json({ error: "Failed to fetch GHL details", details: err.message });
  }
});

// =========================================================================
// ENDPOINT 4: Create a New Staff Note in GHL
// =========================================================================
exports.createGhlNote = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { contactId, note } = req.body;

    if (!contactId || !note) {
      return res.status(400).json({ error: "Missing contactId or note body" });
    }

    const response = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: note,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("GHL Note Error Details:", data);
      return res.status(400).json({ error: data.message || "Failed to create note in GHL", details: data });
    }

    return res.status(200).json({ success: true, note: data.note });
  } catch (err) {
    console.error("Create Note Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

// =========================================================================
// ENDPOINT 5: Send an SMS Text via GHL
// =========================================================================
exports.sendGhlSms = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { contactId, message, attachments } = req.body;

    if (!contactId || !message) {
      return res.status(400).json({ error: "Missing contactId or message text" });
    }

        const payload = {
      type: "SMS",
      contactId,
      message: message || "",
    };
    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments;
    }

    const response = await fetch(
      "https://services.leadconnectorhq.com/conversations/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GHL_API_TOKEN}`,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("GHL Send SMS Error Details:", data);
      return res.status(400).json({ error: data.message || "Failed to send SMS via GHL", details: data });
    }

    return res.status(200).json({ success: true, message: data });
  } catch (err) {
    console.error("Send SMS Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

// =========================================================================
// ENDPOINT 6: Search & Import GHL Contacts
// =========================================================================
exports.searchGhlContacts = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    const { query: searchQuery, limit } = req.query;
    const searchTerm = searchQuery ? searchQuery.trim() : "";
    const maxResults = limit || 100;

    let ghlUrl = `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&limit=${maxResults}`;
    if (searchTerm) {
      ghlUrl += `&query=${encodeURIComponent(searchTerm)}`;
    }

    const response = await fetch(ghlUrl, {
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: GHL_API_VERSION,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("GHL Search Contacts Error:", data);
      return res.status(200).json({
        success: false,
        error: data.message || "Failed to fetch GHL contacts",
        details: data,
        contacts: [],
      });
    }

    const rawContacts = data.contacts || [];
    const formattedContacts = rawContacts.map((c) => {
      const fullName = c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.email || "Unnamed Contact";
      return {
        id: c.id,
        name: fullName,
        email: c.email || "",
        phone: c.phone || "",
        tags: c.tags || [],
      };
    });

    return res.status(200).json({ success: true, contacts: formattedContacts });
  } catch (err) {
    console.error("Search Contacts Endpoint Error:", err);
    return res.status(200).json({ success: false, error: err.message, contacts: [] });
  }
});

const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || "FRepS6g9Esd8GRGSg3jQ";

function bookingToStartEnd(data) {
  const date = data.date; // YYYY-MM-DD
  const time = (data.time || "10:00").slice(0, 5); // HH:mm
  const mins = Number(data.durationMinutes) || 15;

  const [h, m] = time.split(":").map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + mins;
  const eh = String(Math.floor(endMin / 60)).padStart(2, "0");
  const em = String(endMin % 60).padStart(2, "0");

  // Eastern time. If times are off by 1h in winter, switch to -05:00
  const offset = "-04:00";

  return {
    startTime: `${date}T${time}:00${offset}`,
    endTime: `${date}T${eh}:${em}:00${offset}`,
  };
}

async function ghlCreateAppointment(data) {
  const contactId = data.ghlContactId;
  if (!contactId || !GHL_CALENDAR_ID) {
    console.log("GHL create skipped: missing ghlContactId or GHL_CALENDAR_ID");
    return null;
  }

  const { startTime, endTime } = bookingToStartEnd(data);

  const body = {
    calendarId: GHL_CALENDAR_ID,
    locationId: GHL_LOCATION_ID,
    assignedUserId: data.ghlAssignedUserId || "xMvRtd4w6phpplFJw6is",
    contactId,
    startTime,
    endTime,
    title: data.appointmentTypeName || "Nutrition Appointment",
    appointmentStatus: "confirmed",
    description: [
      data.clientName && `Client: ${data.clientName}`,
      data.roomName && `Room: ${data.roomName}`,
      data.coach && `Coach: ${data.coach}`,
      data.notes && `Notes: ${data.notes}`,
    ]
      .filter(Boolean)
      .join("\n"),
    address: data.roomName || "",
    ignoreFreeSlotValidation: true,
    ignoreDateRange: true,
    toNotify: true, // REQUIRED for GHL automations
  };

  const res = await fetch(
    "https://services.leadconnectorhq.com/calendars/events/appointments",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("GHL create failed", res.status, json);
    return null;
  }

  return json.id || json.appointment?.id || json.event?.id || null;
}

async function ghlUpdateAppointment(eventId, data) {
  if (!eventId || !data.ghlContactId || !GHL_CALENDAR_ID) return;

  const { startTime, endTime } = bookingToStartEnd(data);

  const body = {
    calendarId: GHL_CALENDAR_ID,
    locationId: GHL_LOCATION_ID,
    assignedUserId: data.ghlAssignedUserId || "xMvRtd4w6phpplFJw6is",
    contactId: data.ghlContactId,
    startTime,
    endTime,
    title: data.appointmentTypeName || "Nutrition Appointment",
    appointmentStatus: "confirmed",
    description: [
      data.clientName && `Client: ${data.clientName}`,
      data.roomName && `Room: ${data.roomName}`,
      data.coach && `Coach: ${data.coach}`,
      data.notes && `Notes: ${data.notes}`,
    ]
      .filter(Boolean)
      .join("\n"),
    toNotify: true,
    ignoreFreeSlotValidation: true,
  };

  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/events/appointments/${eventId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    console.error("GHL update failed", res.status, await res.text());
  }
}

async function ghlDeleteAppointment(eventId) {
  if (!eventId) return;

  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/events/${eventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    console.error("GHL delete failed", res.status, await res.text());
  }
}


exports.syncBookingCreateToGhl = onDocumentCreated(
  "bookings/{bookingId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    if (data.ghlAppointmentId) return; // already synced

    const ghlId = await ghlCreateAppointment(data);
    console.log("GHL create result", ghlId);
    if (ghlId) {
      await event.data.ref.set({ ghlAppointmentId: ghlId }, { merge: true });
    }
  }
);

exports.syncBookingUpdateToGhl = onDocumentUpdated(
  "bookings/{bookingId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data();
    if (!after) return;

    // Ignore writes that only set sync metadata (stops double-create)
    const ignore = new Set([
      "ghlAppointmentId",
      "googleEventId",
      "googleSyncAt",
      "updatedAt",
    ]);
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [...allKeys].filter(
      (k) =>
        !ignore.has(k) &&
        JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)
    );
    if (changed.length === 0) {
      console.log("GHL update skipped: sync-only change");
      return;
    }

    // Already in GHL → update only
    if (after.ghlAppointmentId) {
      await ghlUpdateAppointment(after.ghlAppointmentId, after);
      return;
    }

    // No GHL id yet (legacy booking) → create once
    const ghlId = await ghlCreateAppointment(after);
    console.log("GHL create-from-update result", ghlId);
    if (ghlId) {
      await event.data.after.ref.set({ ghlAppointmentId: ghlId }, { merge: true });
    }
  }
);

exports.syncBookingDeleteToGhl = onDocumentDeleted(
  "bookings/{bookingId}",
  async (event) => {
    const data = event.data?.data();
    if (!data?.ghlAppointmentId) return;
    await ghlDeleteAppointment(data.ghlAppointmentId);
  }
);

exports.syncBookingCreateToGhl = onDocumentCreated("bookings/{bookingId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  if (data.ghlAppointmentId) return; // already synced

  const ghlId = await ghlCreateAppointment(data);
  if (ghlId) {
    await event.data.ref.set({ ghlAppointmentId: ghlId }, { merge: true });
  }
});

// =========================================================================
// ENDPOINT 7: InBody Webhook
// =========================================================================
exports.inbodyWebhook = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const payload = req.body;
    const digits = (p) => String(p || "").replace(/\D/g, "");
    const last10 = (p) => {
      const d = digits(p);
      return d.length >= 10 ? d.slice(-10) : d;
    };

    const cleanPhone = last10(
      payload.Mobile ||
        payload.phone ||
        payload.UserPhone ||
        payload.ID ||
        payload.TelHP ||
        payload.User_ID ||
        payload.UserID ||
        ""
    );

    let matchedClientId = null;
    let matchedClientName = payload.Name || payload.UserName || "";
    let matchedGhlId = "";

    // 1) Match local clients by phone
    if (cleanPhone) {
      const clientsSnap = await db.collection("clients").get();
      const matched = clientsSnap.docs.find((d) => {
        const cPhone = last10(d.data().phone);
        return cPhone && cPhone === cleanPhone;
      });
      if (matched) {
        matchedClientId = matched.id;
        matchedClientName = matched.data().name || matchedClientName;
        matchedGhlId = matched.data().ghlContactId || "";
      }
    }

    // 2) If still no real name, look up GHL by phone
    const needsName =
      !matchedClientName ||
      /^member/i.test(matchedClientName) ||
      /^unknown/i.test(matchedClientName);

    if (needsName && cleanPhone && process.env.GHL_API_TOKEN) {
      try {
        const ghlUrl =
          `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}` +
          `&limit=20&query=${encodeURIComponent(cleanPhone)}`;
        const ghlRes = await fetch(ghlUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_TOKEN || GHL_API_TOKEN}`,
            Version: GHL_API_VERSION,
          },
        });
        const ghlData = await ghlRes.json();
        const contacts = ghlData.contacts || [];
        const hit =
          contacts.find((c) => {
            const p = last10(c.phone);
            return p && (p === cleanPhone || cleanPhone.endsWith(p) || p.endsWith(cleanPhone));
          }) || contacts[0];
        if (hit) {
          const full =
            hit.contactName ||
            `${hit.firstName || ""} ${hit.lastName || ""}`.trim() ||
            hit.email ||
            "";
          if (full) matchedClientName = full;
          matchedGhlId = hit.id || matchedGhlId;
        }
      } catch (e) {
        console.error("GHL lookup on inbody webhook failed", e.message);
      }
    }

    if (!matchedClientName) matchedClientName = "Member";

    const scanRecord = {
      clientId: matchedClientId,
      clientName: matchedClientName,
      ghlContactId: matchedGhlId || null,
      phone: cleanPhone,
      scanDate: parseInBodyDate(findDateStr(payload)),
      weight: findMetric(payload, "Weight", "WT", "Weight_lbs", "WT_lbs"),
      smm: findMetric(payload, "SMM", "SkeletalMuscleMass", "SMM_lbs"),
      pbf: findMetric(payload, "PBF", "PercentBodyFat", "PBF_Percent", "PercentFat"),
      bfm: findMetric(payload, "BFM", "BodyFatMass", "BFM_lbs"),
      score: findMetric(payload, "InBodyScore", "Score", "InBody_Score", "TotalScore"),
      deviceSerial: payload.EquipSerial || payload.DeviceSerial || payload.Equip || "InBody 270/570",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      rawPayload: payload,
    };
    await db.collection("inbody_scans").add(scanRecord);
    return res.status(200).json({
      success: true,
      message: "InBody scan saved",
      scan: scanRecord,
    });
  } catch (err) {
    console.error("inbodyWebhook error", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

// =========================================================================
// ENDPOINT 8: Direct LookinBody API Scan Sync
// =========================================================================
exports.fetchInbodyScansFromApi = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  return res.status(200).json({ success: true, message: "Webhook sync active." });
});

// ---------- Google Calendar helpers ----------
function getCalendarClient(saKeyJson, coachEmail) {
  const credentials = typeof saKeyJson === "string" ? JSON.parse(saKeyJson) : saKeyJson;
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    subject: coachEmail, // impersonate the coach
  });
  return google.calendar({ version: "v3", auth });
}

function buildEventFromBooking(booking) {
  const date = booking.date; // YYYY-MM-DD
  const time = booking.time || "10:00"; // HH:MM
  const duration = Number(booking.durationMinutes) || 30;

  // Compute end time in local clock (no Date/UTC)
  const [h, m] = time.split(":").map(Number);
  const startTotal = h * 60 + m;
  const endTotal = startTotal + duration;
  const endH = Math.floor(endTotal / 60) % 24;
  const endM = endTotal % 60;
  const dayOffset = Math.floor(endTotal / (24 * 60));

  let endDate = date;
  if (dayOffset > 0) {
    const d = new Date(date + "T12:00:00"); // noon avoids DST edge cases
    d.setDate(d.getDate() + dayOffset);
    endDate = d.toISOString().slice(0, 10);
  }

  const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

  const title = `${booking.appointmentTypeName || "Appointment"} — ${booking.clientName || "Client"}`;
  const description = [
    booking.roomName ? `Room: ${booking.roomName}` : null,
    booking.notes ? `Notes: ${booking.notes}` : null,
    booking.clientName ? `Client: ${booking.clientName}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: title,
    description,
    start: {
      dateTime: `${date}T${time}:00`,
      timeZone: CALENDAR_TIMEZONE, // America/New_York
    },
    end: {
      dateTime: `${endDate}T${endTime}:00`,
      timeZone: CALENDAR_TIMEZONE,
    },
  };
}

async function resolveCoachEmail(booking) {
  // Prefer email stored on the booking
  if (booking.coachEmail) return booking.coachEmail;

  // Fallback: look up users by coach name
  if (!booking.coach) return null;
  const snap = await db.collection("users").get();
  const coachName = String(booking.coach).toLowerCase();
  for (const doc of snap.docs) {
    const u = doc.data();
    const name = String(u.name || "").toLowerCase();
    const email = u.email || "";
    if (
      email &&
      (name === coachName ||
        name.includes(coachName) ||
        coachName.includes(name) ||
        email.toLowerCase().includes(coachName.split(" ")[0]))
    ) {
      return email;
    }
  }
  return null;
}

// CREATE
exports.syncBookingToGoogleCalendar = onDocumentCreated(
  {
    document: "bookings/{bookingId}",
    secrets: [GOOGLE_SA_KEY],
  },
  async (event) => {
    const booking = event.data.data();
    const bookingId = event.params.bookingId;

    const coachEmail = await resolveCoachEmail(booking);
    if (!coachEmail) {
      console.log("No coach email for booking", bookingId);
      return;
    }

    try {
      const calendar = getCalendarClient(GOOGLE_SA_KEY.value(), coachEmail);
      const resource = buildEventFromBooking(booking);
      const res = await calendar.events.insert({
        calendarId: "primary",
        resource,
      });

      await db.collection("bookings").doc(bookingId).update({
        googleEventId: res.data.id,
        coachEmail,
        googleSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("Created Google event", res.data.id, "for", coachEmail);
    } catch (err) {
      console.error("Google Calendar create failed:", err.message);
    }
  }
);

// UPDATE
exports.updateBookingOnGoogleCalendar = onDocumentUpdated(
  {
    document: "bookings/{bookingId}",
    secrets: [GOOGLE_SA_KEY],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const bookingId = event.params.bookingId;

    // Avoid loop when we only write googleEventId
    if (
      before.googleEventId === after.googleEventId &&
      before.date === after.date &&
      before.time === after.time &&
      before.durationMinutes === after.durationMinutes &&
      before.clientName === after.clientName &&
      before.appointmentTypeName === after.appointmentTypeName
    ) {
      return;
    }

    const coachEmail = after.coachEmail || (await resolveCoachEmail(after));
    if (!coachEmail) return;

    try {
      const calendar = getCalendarClient(GOOGLE_SA_KEY.value(), coachEmail);
      const resource = buildEventFromBooking(after);

      if (after.googleEventId) {
        await calendar.events.patch({
          calendarId: "primary",
          eventId: after.googleEventId,
          resource,
        });
        console.log("Updated Google event", after.googleEventId);
      } else {
        const res = await calendar.events.insert({
          calendarId: "primary",
          resource,
        });
        await db.collection("bookings").doc(bookingId).update({
          googleEventId: res.data.id,
          coachEmail,
        });
      }
    } catch (err) {
      console.error("Google Calendar update failed:", err.message);
    }
  }
);

// DELETE
exports.deleteBookingOnGoogleCalendar = onDocumentDeleted(
  {
    document: "bookings/{bookingId}",
    secrets: [GOOGLE_SA_KEY],
  },
  async (event) => {
    const booking = event.data.data();
    if (!booking?.googleEventId) return;

    const coachEmail = booking.coachEmail || (await resolveCoachEmail(booking));
    if (!coachEmail) return;

    try {
      const calendar = getCalendarClient(GOOGLE_SA_KEY.value(), coachEmail);
      await calendar.events.delete({
        calendarId: "primary",
        eventId: booking.googleEventId,
      });
      console.log("Deleted Google event", booking.googleEventId);
    } catch (err) {
      console.error("Google Calendar delete failed:", err.message);
    }
  }
);

// =========================================================================
// Notify coach when an active client texts the gym
// =========================================================================
exports.notifyCoachOnInboundSms = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    // GHL may send GET challenge or POST JSON
    if (req.method === "GET") {
      return res.status(200).send("ok");  
    }
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const body = req.body || {};

const idKeys = Object.keys(body).filter(
  (k) => /id|email|phone|name|message|body|text/i.test(k)
);
console.log(
  "ID-ISH FIELDS",
  JSON.stringify(
    {
      id: body.id,
      contactId: body.contactId,
      contact_id: body.contact_id,
      email: body.email,
      phone: body.phone,
      phone_number: body.phone_number,
      full_name: body.full_name,
      firstName: body.firstName,
      lastName: body.lastName,
      first_name: body.first_name,
      last_name: body.last_name,
      message: body.message,
      idKeys,
    },
    null,
    0
  )
);
    // GHL webhook field names vary — cover common ones
      const contactId = String(
      body.contactId ||
      body.contact_id ||
      body.contact?.id ||
      body.contact?.contactId ||
      body.data?.contactId ||
      body.data?.contact_id ||
      // only use body.id if nothing else exists — it is often message/conversation id
      ""
    ).trim();

    console.log("Resolved contactId", contactId || "(empty)", "body.id=", body.id);

    const contactName =
      body.full_name ||
      body.fullName ||
      body.contact_name ||
      body.name ||
      [body.firstName || body.first_name, body.lastName || body.last_name].filter(Boolean).join(" ") ||
      "A client";
      const rawMsg =
      body.message ||
      body.body ||
      body.text ||
      body.msg ||
      body.messageBody ||
      body.Message ||
      body.conversation?.message ||
      body.data?.message ||
      "";

    let messagePreview = "";
    if (typeof rawMsg === "string") {
      messagePreview = rawMsg;
    } else if (rawMsg && typeof rawMsg === "object") {
      messagePreview =
        rawMsg.body ||
        rawMsg.text ||
        rawMsg.message ||
        rawMsg.content ||
        rawMsg.msg ||
        "";
      if (typeof messagePreview !== "string") {
        messagePreview = "";
      }
    }

    messagePreview = String(messagePreview || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    if (!contactId) {
      console.log("notifyCoachOnInboundSms: no contactId", JSON.stringify(body).slice(0, 500));
      return res.status(200).json({ ok: true, skipped: "no contactId" });
    }

    // Find client(s) with this GHL id
    const clientsSnap = await db
      .collection("clients")
      .where("ghlContactId", "==", String(contactId))
      .limit(5)
      .get();

    if (clientsSnap.empty) {
      console.log("No client for GHL contact", contactId);
      return res.status(200).json({ ok: true, skipped: "no client" });
    }

    const results = [];

    for (const clientDoc of clientsSnap.docs) {
      const client = { id: clientDoc.id, ...clientDoc.data() };
      const status = client.status || "active";
      if (status !== "active") {
        results.push({ clientId: client.id, skipped: "inactive" });
        continue;
      }

      if (!client.coachId) {
        results.push({ clientId: client.id, skipped: "no coachId" });
        continue;
      }

      const coachDoc = await db.collection("users").doc(client.coachId).get();
      if (!coachDoc.exists) {
        results.push({ clientId: client.id, skipped: "coach not found" });
        continue;
      }

      const coach = coachDoc.data();
      const coachPhone = String(coach.phone || "").replace(/\D/g, "");
      if (coachPhone.length < 10) {
        results.push({ clientId: client.id, skipped: "coach has no phone" });
        continue;
      }

      // Find or create GHL contact for the coach so we can SMS them
      let coachGhlId = coach.ghlContactId || null;

      if (!coachGhlId) {
        // Search by phone
        const searchRes = await fetch(
          `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(coachPhone)}`,
          {
            headers: {
              Authorization: `Bearer ${GHL_API_TOKEN}`,
              Version: GHL_API_VERSION,
            },
          }
        );
        const searchData = await searchRes.json().catch(() => ({}));
        const found = searchData?.contacts?.[0] || searchData?.contact;
        if (found?.id) {
          coachGhlId = found.id;
        } else {
          // Create contact
          const createRes = await fetch(`https://services.leadconnectorhq.com/contacts/`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${GHL_API_TOKEN}`,
              Version: GHL_API_VERSION,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              locationId: GHL_LOCATION_ID,
              firstName: (coach.name || "Coach").split(" ")[0],
              lastName: (coach.name || "").split(" ").slice(1).join(" ") || "",
              email: coach.email || "",
              phone: coachPhone,
            }),
          });
          const createData = await createRes.json().catch(() => ({}));
          coachGhlId = createData?.contact?.id || createData?.id || null;
        }

        if (coachGhlId) {
          await db.collection("users").doc(client.coachId).update({
            ghlContactId: coachGhlId,
            phone: coach.phone || coachPhone,
          });
        }
      }

      if (!coachGhlId) {
        results.push({ clientId: client.id, skipped: "could not resolve coach GHL contact" });
        continue;
      }

      const clientLabel = client.name || contactName || "A client";
      const smsBody = messagePreview
        ? `${clientLabel}, Your nutrition client just messaged the gym: "${String(messagePreview).slice(0, 120)}"`
        : `${clientLabel}, Your nutrition client just messaged the gym.`;

      const sendRes = await fetch(`https://services.leadconnectorhq.com/conversations/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GHL_API_TOKEN}`,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "SMS",
          contactId: coachGhlId,
          message: smsBody,
        }),
      });

      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        console.error("SMS to coach failed", sendData);
        results.push({ clientId: client.id, error: sendData.message || "send failed" });
      } else {
        console.log("Notified coach", coach.email, "about", clientLabel);
        results.push({ clientId: client.id, notified: true, coachEmail: coach.email });
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("notifyCoachOnInboundSms error", err);
    return res.status(500).json({ error: err.message });
  }
});
exports.fatsecretMyIp = onRequest({ cors: true }, async (req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = await r.json();
    res.json({ ip: j.ip, note: "Add this IP to FatSecret IP Restrictions" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Test: GET ?q=chicken */
exports.fatsecretSearchFoods = onRequest(
  {
    cors: true,
    secrets: [FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET],
  },
  async (req, res) => {
    try {
      const q = String(req.query.q || req.body?.q || "chicken").trim();
      const token = await getFatSecretAccessToken();

      const params = new URLSearchParams({
        method: "foods.search",
        search_expression: q,
        format: "json",
      });

      const apiRes = await fetch(
        "https://platform.fatsecret.com/rest/server.api",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );

      const data = await apiRes.json();
      res.status(apiRes.ok ? 200 : 400).json({
        success: apiRes.ok,
        status: apiRes.status,
        data,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

/** POST { clientId } — create profile once, save tokens on client */
exports.fatsecretEnsureProfile = onRequest(
  {
    cors: true,
    secrets: [FATSECRET_CONSUMER_KEY, FATSECRET_CONSUMER_SECRET],
  },
  async (req, res) => {
    try {
      const clientId = String(req.body?.clientId || req.query.clientId || "").trim();
      if (!clientId) {
        return res.status(400).json({ success: false, error: "clientId required" });
      }

      const ref = admin.firestore().collection("clients").doc(clientId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: "client not found" });
      }

      const c = snap.data() || {};
      if (c.fatsecretAuthToken && c.fatsecretAuthSecret) {
        return res.json({
          success: true,
          alreadyLinked: true,
          clientId,
        });
      }

      const { ok, status, data } = await fatSecretOAuth1Request({
        methodParams: {
          method: "profile.create",
          user_id: clientId,
          format: "json",
        },
      });

      // Response shapes vary; handle common forms
      const token =
        data?.profile?.auth_token ||
        data?.auth_token ||
        data?.profile_auth_token;
      const secret =
        data?.profile?.auth_secret ||
        data?.auth_secret ||
        data?.profile_auth_secret;

      if (!ok || !token || !secret) {
        console.error("profile.create", status, data);
        return res.status(400).json({
          success: false,
          error: "profile.create failed",
          detail: data,
        });
      }

      await ref.set(
        {
          fatsecretAuthToken: token,
          fatsecretAuthSecret: secret,
          fatsecretUserId: clientId,
          fatsecretLinkedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.json({ success: true, alreadyLinked: false, clientId });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: e.message });
    }
  }
);

/** GET/POST clientId + date=YYYY-MM-DD */
exports.fatsecretGetDiary = onRequest(
  {
    cors: true,
    secrets: [FATSECRET_CONSUMER_KEY, FATSECRET_CONSUMER_SECRET],
  },
  async (req, res) => {
    try {
      const clientId = String(req.body?.clientId || req.query.clientId || "").trim();
      const dateStr =
        String(req.body?.date || req.query.date || "").trim() ||
        new Date().toISOString().slice(0, 10);

      if (!clientId) {
        return res.status(400).json({ success: false, error: "clientId required" });
      }

      const snap = await admin.firestore().collection("clients").doc(clientId).get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: "client not found" });
      }
      const c = snap.data() || {};
      if (!c.fatsecretAuthToken || !c.fatsecretAuthSecret) {
        return res.status(400).json({
          success: false,
          error: "not_linked",
          message: "Create FatSecret profile first",
        });
      }

      const dateInt = fatSecretDateInt(dateStr);
      const { ok, status, data } = await fatSecretOAuth1Request({
        methodParams: {
          method: "food_entries.get.v2",
          date: String(dateInt),
          format: "json",
        },
        token: c.fatsecretAuthToken,
        tokenSecret: c.fatsecretAuthSecret,
      });

      if (!ok) {
        return res.status(400).json({ success: false, status, data });
      }

      const raw = data?.food_entries?.food_entry;
      const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];

      let calories = 0;
      let protein = 0;
      let carbs = 0;
      let fat = 0;
      for (const e of entries) {
        calories += parseFloat(e.calories) || 0;
        protein += parseFloat(e.protein) || 0;
        carbs += parseFloat(e.carbohydrate) || 0;
        fat += parseFloat(e.fat) || 0;
      }

      return res.json({
        success: true,
        date: dateStr,
        dateInt,
        entries,
        totals: {
          calories: Math.round(calories),
          protein: Math.round(protein * 10) / 10,
          carbs: Math.round(carbs * 10) / 10,
          fat: Math.round(fat * 10) / 10,
        },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: e.message });
    }
  }
);

/**
 * GET/POST ?clientId=...
 * Returns authorizeUrl. User logs into FatSecret, allows app,
 * then gets a PIN/verifier (oob). Finish connect is a separate step.
 */
exports.fatsecretStartConnect = onRequest(
  {
    cors: true,
    secrets: [FATSECRET_CONSUMER_KEY, FATSECRET_CONSUMER_SECRET],
  },
  async (req, res) => {
    try {
      const clientId = String(
        req.query.clientId || req.body?.clientId || ""
      ).trim();
      if (!clientId) {
        return res.status(400).json({ success: false, error: "clientId required" });
      }

      const db = admin.firestore();
      const ref = db.collection("clients").doc(clientId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: "client not found" });
      }

      const url = "https://authentication.fatsecret.com/oauth/request_token";
      const consumerKey = FATSECRET_CONSUMER_KEY.value();
      const consumerSecret = FATSECRET_CONSUMER_SECRET.value();

      const oauth = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString("hex"),
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: "1.0",
        oauth_callback: "oob",
      };

      oauth.oauth_signature = oauth1Sign({
        method: "POST",
        url,
        params: oauth,
        consumerSecret,
        tokenSecret: "",
      });

      const body = new URLSearchParams(oauth).toString();
      const tokenRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const rawText = await tokenRes.text();
      const parsed = parseOAuthBody(rawText);

      if (!tokenRes.ok || !parsed.oauth_token || !parsed.oauth_token_secret) {
        console.error("request_token failed", tokenRes.status, rawText);
        return res.status(400).json({
          success: false,
          error: "request_token failed",
          status: tokenRes.status,
          detail: rawText.slice(0, 500),
        });
      }

      await ref.set(
        {
          fatsecretOauthPending: {
            token: parsed.oauth_token,
            secret: parsed.oauth_token_secret,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );

      const authorizeUrl =
        "https://authentication.fatsecret.com/oauth/authorize?oauth_token=" +
        encodeURIComponent(parsed.oauth_token);

      return res.json({
        success: true,
        clientId,
        authorizeUrl,
        next: "Open authorizeUrl, log in as the client, Allow, then copy the PIN/verifier into fatsecretFinishConnect",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: e.message });
    }
  }
);

/**
 * GET/POST ?clientId=...&verifier=9672058
 * Exchanges oob PIN for access tokens → saves on client
 */
exports.fatsecretFinishConnect = onRequest(
  {
    cors: true,
    secrets: [FATSECRET_CONSUMER_KEY, FATSECRET_CONSUMER_SECRET],
  },
  async (req, res) => {
    try {
      const clientId = String(
        req.query.clientId || req.body?.clientId || ""
      ).trim();
      const verifier = String(
        req.query.verifier || req.body?.verifier || ""
      ).trim();

      if (!clientId || !verifier) {
        return res.status(400).json({
          success: false,
          error: "clientId and verifier required",
        });
      }

      const db = admin.firestore();
      const ref = db.collection("clients").doc(clientId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: "client not found" });
      }

      const pending = snap.data()?.fatsecretOauthPending;
      if (!pending?.token || !pending?.secret) {
        return res.status(400).json({
          success: false,
          error: "no_pending",
          message: "Run fatsecretStartConnect first for this client",
        });
      }

      const url = "https://authentication.fatsecret.com/oauth/access_token";
      const consumerKey = FATSECRET_CONSUMER_KEY.value();
      const consumerSecret = FATSECRET_CONSUMER_SECRET.value();

      const oauth = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString("hex"),
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: "1.0",
        oauth_token: pending.token,
        oauth_verifier: verifier,
      };

      oauth.oauth_signature = oauth1Sign({
        method: "POST",
        url,
        params: oauth,
        consumerSecret,
        tokenSecret: pending.secret,
      });

      const body = new URLSearchParams(oauth).toString();
      const tokenRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const rawText = await tokenRes.text();
      const parsed = parseOAuthBody(rawText);

      if (!tokenRes.ok || !parsed.oauth_token || !parsed.oauth_token_secret) {
        console.error("access_token failed", tokenRes.status, rawText);
        return res.status(400).json({
          success: false,
          error: "access_token failed",
          status: tokenRes.status,
          detail: rawText.slice(0, 500),
        });
      }

      await ref.set(
        {
          fatsecretAuthToken: parsed.oauth_token,
          fatsecretAuthSecret: parsed.oauth_token_secret,
          fatsecretConnectedAt: admin.firestore.FieldValue.serverTimestamp(),
          fatsecretUsername: snap.data()?.fatsecretUsername || "",
          fatsecretOauthPending: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );

      return res.json({
        success: true,
        clientId,
        message: "FatSecret account connected. Load diary next.",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: e.message });
    }
  }
);