const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");

const GOOGLE_SA_KEY = defineSecret("GOOGLE_SA_KEY"); // use the secret name you set
const CALENDAR_TIMEZONE = "America/New_York";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- GHL & INBODY API CONFIGURATION ---
const GHL_API_TOKEN = process.env.GHL_API_TOKEN || "pit-b6637265-a6ff-47cf-bcda-78df37fb3526";
const GHL_API_VERSION = "2021-07-28";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "tNtRSRKPPnHXZjLAo4zs";

const INBODY_API_KEY = process.env.INBODY_API_KEY || "dGKyIYZEo88HN9IqnFTh+I2TsesRtGNE8bijk5kwLH0=";
const INBODY_ACCOUNT = process.env.INBODY_ACCOUNT || "swarm";

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
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
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

    const { contactId, message } = req.body;

    if (!contactId || !message) {
      return res.status(400).json({ error: "Missing contactId or message text" });
    }

    const response = await fetch(`https://services.leadconnectorhq.com/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "SMS",
        contactId: contactId,
        message: message,
      }),
    });

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

// =========================================================================
// ENDPOINT 7: InBody Webhook
// =========================================================================
exports.inbodyWebhook = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const payload = req.body;
    const rawPhone = payload.Mobile || payload.phone || payload.UserPhone || payload.ID || payload.TelHP || payload.User_ID || payload.UserID || "";
    const cleanPhone = String(rawPhone).replace(/\D/g, "");

    let matchedClientId = null;
    let matchedClientName = payload.Name || "Member";

    if (cleanPhone) {
      const clientsSnap = await db.collection("clients").get();
      const matched = clientsSnap.docs.find((d) => {
        const cData = d.data();
        const cPhone = String(cData.phone || "").replace(/\D/g, "");
        return cPhone && (cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone));
      });

      if (matched) {
        matchedClientId = matched.id;
        matchedClientName = matched.data().name || matchedClientName;
      }
    }

    const scanRecord = {
      clientId: matchedClientId,
      clientName: payload.Name || payload.UserName || matchedClientName,
      phone: String(cleanPhone),
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
    return res.status(200).json({ success: true, message: "InBody scan saved to database successfully", scan: scanRecord });
  } catch (err) {
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