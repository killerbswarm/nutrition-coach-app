/**
 * One-time: copy payroll data from swarm-nutrition-payroll → swarm-nutrition-app
 * Run: node scripts/migrate-payroll.mjs
 */
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

const OLD = {
  apiKey: 'AIzaSyD9JEXX0dM_DnMrhLFzpBIXY2HSS2fKeMU',
  authDomain: 'swarm-nutrition-payroll.firebaseapp.com',
  projectId: 'swarm-nutrition-payroll',
  storageBucket: 'swarm-nutrition-payroll.firebasestorage.app',
  messagingSenderId: '100537256671',
  appId: '1:100537256671:web:5d419e025fdeea7248376a',
};

// Use the SAME config as src/firebase.js (swarm-nutrition-app)
const NEW = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || 'PASTE_FROM_SRC_FIREBASE_JS',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'swarm-nutrition-app.firebaseapp.com',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'swarm-nutrition-app',
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'swarm-nutrition-app.appspot.com',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'PASTE',
  appId: process.env.VITE_FIREBASE_APP_ID || 'PASTE',
};

const oldApp = initializeApp(OLD, 'old-payroll');
const newApp = initializeApp(NEW, 'new-nutrition');
const oldDb = getFirestore(oldApp);
const newDb = getFirestore(newApp);

async function copyCollection(name, { keepId = true } = {}) {
  const snap = await getDocs(collection(oldDb, name));
  console.log(`${name}: found ${snap.size} docs`);

  let batch = writeBatch(newDb);
  let n = 0;
  let total = 0;

  for (const d of snap.docs) {
    const ref = keepId ? doc(newDb, name, d.id) : doc(collection(newDb, name));
    batch.set(ref, d.data(), { merge: true });
    n++;
    total++;
    if (n >= 400) {
      await batch.commit();
      batch = writeBatch(newDb);
      n = 0;
      console.log(`  …committed batch (${total} so far)`);
    }
  }
  if (n > 0) await batch.commit();
  console.log(`${name}: done (${total})`);
}

async function main() {
  console.log('Migrating payroll → nutrition app…');
  await copyCollection('transactions', { keepId: true });
  await copyCollection('monthly_status', { keepId: true });
  await copyCollection('roster', { keepId: true });
  console.log('Done. Refresh Payroll in the app.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});