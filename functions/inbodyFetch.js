const { onRequest } = require("firebase-functions/v2/https");

const INBODY_BASE = process.env.INBODY_PROXY_URL || "http://165.227.92.146:3000";

function inbodyHeaders() {
  return {
    Account: process.env.INBODY_ACCOUNT || "swarm",
    "API-KEY": process.env.INBODY_API_KEY || "",
    "Content-Type": "application/json",
    "x-proxy-secret": process.env.INBODY_PROXY_SECRET || "swarm-inbody-proxy-2026",
  };
}

async function inbodyPost(path, body) {
  const r = await fetch(`${INBODY_BASE}${path}`, {
    method: "POST",
    headers: inbodyHeaders(),
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = text;
  }
  return { status: r.status, path, request: body, json };
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function kgToLb(v) {
  return Math.round(num(v) * 2.20462 * 10) / 10;
}

function mapInBodyScan(d) {
  if (!d || typeof d !== "object") return {};
  return {
    clientName: d.Name || "",
    email: d["E-mail"] || d.Email || "",
    height: d.Height || "",
    age: num(d.Age),
    gender: d.Gender || "",
    dateOfBirth: d.DateofBirth || "",
    weight: kgToLb(d.Weight),
    tbw: kgToLb(d["TBW(TotalBodyWater)"]),
    dlm: kgToLb(d["DLM(DryLeanMass)"]),
    bfm: kgToLb(d["BFM(BodyFatMass)"]),
    lbm: kgToLb(d["LBM(LeanBodyMass)"]),
    smm: kgToLb(d["SMM(SkeletalMuscleMass)"]),
    bmi: num(d["BMI(BodyMassIndex)"]),
    pbf: num(d["PBF(PercentBodyFat)"]),
    bmr: num(d["BMR(BasalMetabolicRate)"]),
    smi: num(d["SMI(SkeletalMuscleIndex)"]),
    score: num(d.InBodyScore),
    bfmControl: kgToLb(d.BFMControl),
    deviceSerial: d.Serial || d.InBodyType || "",
    segmentalLean: {
      rightArm: kgToLb(d.LBMofRightArm),
      leftArm: kgToLb(d.LBMofLeftArm),
      trunk: kgToLb(d.LBMofTrunk),
      rightLeg: kgToLb(d.LBMofRightLeg),
      leftLeg: kgToLb(d.LBMofLeftLeg),
    },
    segmentalLeanPct: {
      rightArm: num(d["LBM%ofRightArm"]),
      leftArm: num(d["LBM%ofLeftArm"]),
      trunk: num(d["LBM%ofTrunk"]),
      rightLeg: num(d["LBM%ofRightLeg"]),
      leftLeg: num(d["LBM%ofLeftLeg"]),
    },
  };
}

async function fetchFullScan(userId, datetimes) {
  if (!userId || !datetimes) return null;
  const out = await inbodyPost("/inbody/GetFullInBodyDataByID", {
    UserID: String(userId),
    Datetimes: String(datetimes),
  });
  if (out.status !== 200 || !out.json || out.json.error) {
    console.error("InBody fetch failed", out.status, out.json);
    return null;
  }
  return out.json;
}

exports.inbodyPost = inbodyPost;
exports.fetchFullScan = fetchFullScan;
exports.mapInBodyScan = mapInBodyScan;

exports.inbodyApiPull = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  try {
    const method = req.query.method || "GetFullInBodyDataByID";
    const userId = req.query.userId || "";
    const userToken = req.query.userToken || "";
    const datetimes = req.query.datetimes || "";
    const useId = /ByID$/i.test(method);
    const body = {};
    if (useId) {
      if (!userId) return res.status(400).json({ error: "userId required" });
      body.UserID = userId;
    } else {
      if (!userToken) return res.status(400).json({ error: "userToken required" });
      body.UserToken = userToken;
    }
    if (datetimes) body.Datetimes = datetimes;
    const out = await inbodyPost(`/inbody/${method}`, body);
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});