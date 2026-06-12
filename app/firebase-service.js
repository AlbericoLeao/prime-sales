import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, onSnapshot, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = window.FIREBASE_CONFIG;
if (!firebaseConfig) throw new Error('Firebase config missing. Verifique firebase-config.js.');

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const fb = {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, addDoc, setDoc, getDoc, getDocs, onSnapshot, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch
};

export function col(name) { return collection(db, name); }
export function ref(name, id) { return doc(db, name, id); }

export async function createSecondaryUser(email, password) {
  const secondary = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await deleteApp(secondary);
  return cred;
}
