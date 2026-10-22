const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuth } = require("../lib/auth");
const { loadConfig } = require("../lib/config");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../app");
const admin = require("firebase-admin");

const auth = createAuth(loadConfig({ NODE_ENV: "test", ADMIN_EMAILS: "admin@example.com" }));

test("email allowlist requires email verification; explicit admin claims remain authoritative", () => {
  const identity = { uid: "new-signup", email: "admin@example.com", claims: {}, emailVerified: false };
  assert.equal(auth.isAdminIdentity(identity), false);
  assert.equal(auth.isAdminIdentity({ ...identity, emailVerified: true }), true);
  assert.equal(auth.isAdminIdentity({ ...identity, claims: { admin: true } }), true);
});

test("unverified customers own UID-linked orders but cannot claim another customer's email-linked order", () => {
  const customer = { uid: "new-signup", email: "customer@example.com", emailVerified: false };
  const order = { user_id: "original-customer", customer: { email: customer.email } };
  assert.equal(auth.ownsOrder(customer, order), false);
  assert.equal(auth.ownsOrder({ ...customer, emailVerified: true }, order), true);
  assert.equal(auth.ownsOrder(customer, { ...order, user_id: customer.uid }), true);
});

test("real token middleware excludes unverified email from order queries and admin access", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crestus-auth-test-"));
  const config = loadConfig({
    NODE_ENV: "test", ORDER_STORE: "file", DATA_DIR: dataDir,
    FIREBASE_USE_APPLICATION_DEFAULT: "true", ADMIN_EMAILS: "admin@example.com",
  });
  const firebaseAuth = createAuth(config);
  t.mock.method(admin.auth(), "verifyIdToken", async (token) => ({
    uid: "email-signup", email: "admin@example.com", email_verified: token === "verified",
  }));
  const { app, services } = createApp({ config, auth: firebaseAuth, razorpay: {}, shiprocket: {} });
  let query;
  services.store.listOrdersForUser = async (args) => { query = args; return []; };
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, token) => fetch(base + url, { headers: { authorization: `Bearer ${token}` } });
  try {
    assert.equal((await request("/api/orders", "unverified")).status, 200);
    assert.deepEqual(query, { userId: "email-signup", email: null });
    assert.equal((await request("/api/admin/orders", "unverified")).status, 403);
    assert.equal((await (await request("/api/auth/me", "unverified")).json()).is_admin, false);
    assert.equal((await request("/api/orders", "verified")).status, 200);
    assert.deepEqual(query, { userId: "email-signup", email: "admin@example.com" });
    assert.equal((await (await request("/api/auth/me", "verified")).json()).is_admin, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
    await admin.app().delete();
  }
});
