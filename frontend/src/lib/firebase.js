import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, logEvent, isSupported } from "firebase/analytics";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyA9XAiOtyB0QavKW3dwiI_2e2ksfXkynto",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "crestus-6f962.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "crestus-6f962",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "crestus-6f962.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "854907499926",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:854907499926:web:8f7e858cf1b0870ddcd9b7",
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || "G-257KDP96GZ",
};

// Initialize Firebase
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

let analytics = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(app);
    })
    .catch(() => {});
}

export { analytics };

export const track = (event, params = {}) => {
  try {
    if (analytics) logEvent(analytics, event, params);
  } catch {}
};

export default app;
