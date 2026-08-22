import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const masterConfig = {
  apiKey: import.meta.env.VITE_CHECKINS_API_KEY || import.meta.env.VITE_MASTER_API_KEY,
  authDomain: import.meta.env.VITE_CHECKINS_AUTH_DOMAIN || import.meta.env.VITE_MASTER_AUTH_DOMAIN,
  projectId:
    import.meta.env.VITE_CHECKINS_PROJECT_ID ||
    import.meta.env.VITE_MASTER_PROJECT_ID ||
    "swarm-checkins-5436d",
  storageBucket: import.meta.env.VITE_CHECKINS_STORAGE_BUCKET || import.meta.env.VITE_MASTER_STORAGE_BUCKET,
  messagingSenderId:
    import.meta.env.VITE_CHECKINS_MESSAGING_SENDER_ID || import.meta.env.VITE_MASTER_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_CHECKINS_APP_ID || import.meta.env.VITE_MASTER_APP_ID,
};

const masterApp = initializeApp(masterConfig, "master");
export const masterDb = getFirestore(masterApp);
export const masterAuth = getAuth(masterApp);

export async function ensureMasterAuth() {
  if (masterAuth.currentUser) return masterAuth.currentUser;
  const cred = await signInAnonymously(masterAuth);
  return cred.user;
}