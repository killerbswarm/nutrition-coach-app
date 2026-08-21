// nutrition-coach-app/functions/masterDb.js
const admin = require("firebase-admin");

function getMasterDb() {
  const existing = admin.apps.find((a) => a && a.name === "master");
  if (existing) return existing.firestore();

  const raw = process.env.MASTER_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("MASTER_SERVICE_ACCOUNT secret is missing");
  }
  const sa = typeof raw === "string" ? JSON.parse(raw) : raw;
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(sa),
    },
    "master"
  );
  return app.firestore();
}

module.exports = { getMasterDb };