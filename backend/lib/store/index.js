const fs = require("fs");
const { createFileStore } = require("./fileStore");
const { createFirestoreStore } = require("./firestoreStore");

let adminApp = null;

// Initialises firebase-admin once from service-account JSON/file or application-default credentials.
function initFirebaseAdmin(config) {
  if (adminApp) return adminApp;
  const admin = require("firebase-admin");
  const fb = config.firebase;
  let credential = null;
  if (fb.serviceAccountJson) {
    credential = admin.credential.cert(JSON.parse(fb.serviceAccountJson));
  } else if (fb.serviceAccountFile && fs.existsSync(fb.serviceAccountFile)) {
    credential = admin.credential.cert(JSON.parse(fs.readFileSync(fb.serviceAccountFile, "utf-8")));
  } else if (fb.useApplicationDefault) {
    credential = admin.credential.applicationDefault();
  }
  if (!credential) return null;
  adminApp = admin.apps.length ? admin.app() : admin.initializeApp({ credential, projectId: fb.projectId });
  return adminApp;
}

function createStore(config) {
  if (config.store.driver === "firestore") {
    const app = initFirebaseAdmin(config);
    if (!app) throw new Error("ORDER_STORE=firestore but no Firebase credentials configured");
    const admin = require("firebase-admin");
    return createFirestoreStore({ db: admin.firestore(app) });
  }
  return createFileStore({ dataDir: config.store.dataDir });
}

module.exports = { createStore, initFirebaseAdmin };
