// nutrition-coach-app/functions/masterDb.js
const admin = require("firebase-admin");

function parseServiceAccount(raw) {
  if (!raw) {
    throw new Error(
      "MASTER_SERVICE_ACCOUNT secret is missing. Run: firebase functions:secrets:set MASTER_SERVICE_ACCOUNT"
    );
  }

  // Already an object (some runtimes inject parsed JSON)
  if (typeof raw === "object") {
    return raw;
  }

  let text = String(raw).trim();
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // If accidentally wrapped in quotes
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    text = text.slice(1, -1).trim();
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    // Sometimes the secret is double-encoded as a JSON string
    try {
      const once = JSON.parse(text);
      if (typeof once === "string") return JSON.parse(once);
      return once;
    } catch {
      const preview = text.slice(0, 40).replace(/\n/g, "\\n");
      throw new Error(
        "MASTER_SERVICE_ACCOUNT is not valid JSON (starts with: " +
          preview +
          "...). Re-set it with the full service account JSON from swarm-checkins-5436d. Original: " +
          err.message
      );
    }
  }
}

function getMasterDb() {
  const existing = admin.apps.find((a) => a && a.name === "master");
  if (existing) return existing.firestore();

  const sa = parseServiceAccount(process.env.MASTER_SERVICE_ACCOUNT);

  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error(
      "MASTER_SERVICE_ACCOUNT JSON is missing client_email, private_key, or project_id"
    );
  }

  // private_key newlines sometimes get escaped as \\n in secrets
  if (typeof sa.private_key === "string" && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(sa),
    },
    "master"
  );
  return app.firestore();
}

module.exports = { getMasterDb };