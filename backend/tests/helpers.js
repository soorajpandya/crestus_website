const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig } = require("../lib/config");
const { createApp } = require("../app");
const { createShiprocketClient } = require("../lib/shiprocket");

const WEBHOOK_SECRET = "test-webhook-secret";

// In-memory stand-in for the Cashfree SDK with the exact method names/shapes used by the service.
function createFakeCashfree() {
  const orders = new Map();
  const payments = new Map();
  let seq = 1000;
  const api = {
    calls: [],
    async PGCreateOrder(req) {
      api.calls.push(["create", req]);
      const rec = { order_id: req.order_id, cf_order_id: String(seq++), order_status: "ACTIVE", order_amount: req.order_amount, order_currency: req.order_currency, payment_session_id: `session_${req.order_id}` };
      orders.set(req.order_id, rec);
      return { data: rec };
    },
    async PGFetchOrder(id) {
      const rec = orders.get(id);
      if (!rec) {
        const e = new Error("order not found");
        e.response = { status: 404, data: { message: "order not found" } };
        throw e;
      }
      return { data: { ...rec } };
    },
    async PGOrderFetchPayments(id) {
      return { data: payments.get(id) || [] };
    },
    async PGOrderCreateRefund(id, req) {
      api.calls.push(["refund", id, req]);
      return { data: { cf_refund_id: String(seq++), refund_status: "PENDING", refund_amount: req.refund_amount } };
    },
    PGVerifyWebhookSignature(signature, rawBody, timestamp) {
      const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}${rawBody}`).digest("base64");
      if (expected !== signature) throw new Error("Generated signature and received signature did not match.");
      const obj = JSON.parse(rawBody);
      return { type: obj.type, object: obj };
    },
    // --- test controls ---
    markPaid(id, { amount, method = "upi" } = {}) {
      const rec = orders.get(id);
      rec.order_status = "PAID";
      if (amount !== undefined) rec.order_amount = amount;
      payments.set(id, [{ cf_payment_id: seq++, payment_status: "SUCCESS", payment_amount: rec.order_amount, payment_group: method, payment_completion_time: new Date().toISOString() }]);
    },
    markPartiallyCollected(id, collected) {
      const rec = orders.get(id);
      rec.order_status = "PAID";
      payments.set(id, [{ cf_payment_id: seq++, payment_status: "SUCCESS", payment_amount: collected, payment_group: "upi" }]);
    },
    markFailedAttempt(id) {
      payments.set(id, [{ cf_payment_id: seq++, payment_status: "FAILED", payment_amount: orders.get(id).order_amount, payment_message: "Bank declined" }]);
    },
    markExpired(id) {
      orders.get(id).order_status = "EXPIRED";
    },
    signedWebhook(body) {
      const rawBody = JSON.stringify(body);
      const timestamp = String(Date.now());
      const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}${rawBody}`).digest("base64");
      return { rawBody, headers: { "content-type": "application/json", "x-webhook-signature": signature, "x-webhook-timestamp": timestamp } };
    },
  };
  return api;
}

async function startTestServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crestus-test-"));
  const env = {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    ORDER_STORE: "file",
    ALLOW_INSECURE_DEV_AUTH: "true",
    ADMIN_EMAILS: "admin@crestus.test",
    SHIPROCKET_MOCK: "true",
    SHIPROCKET_ENABLED: "true",
    SHIPROCKET_PICKUP_POSTCODE: "380015",
    SHIPROCKET_PICKUP_LOCATION: "Primary",
    SHIPROCKET_WEBHOOK_TOKEN: "ship-token",
    FULFILLMENT_WORKER_ENABLED: "false",
    FULFILLMENT_BASE_BACKOFF_MS: "10",
    FRONTEND_URL: "https://crestuseccommerce.store",
    CASHFREE_APP_ID: "test",
    CASHFREE_SECRET_KEY: "test",
    ...extraEnv,
  };
  const config = loadConfig(env);
  const cashfree = createFakeCashfree();
  const shiprocket = createShiprocketClient({ config, store: null });
  const quiet = { info() {}, warn() {}, error() {}, log() {} };
  const { app, services } = createApp({ config, cashfree, shiprocket, logger: quiet, processOnPaid: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (method, url, { body, user, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (user) {
      h["x-dev-uid"] = user.uid;
      h["x-dev-email"] = user.email;
    }
    if (body !== undefined && !raw) h["content-type"] = "application/json";
    const res = await fetch(`${base}${url}`, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };

  const close = async () => {
    services.fulfillment.stop();
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { request, services, cashfree, shiprocket, close, base };
}

const USER_A = { uid: "uid-a", email: "alice@crestus.test" };
const USER_B = { uid: "uid-b", email: "bob@crestus.test" };
const ADMIN = { uid: "uid-admin", email: "admin@crestus.test" };

const ADDRESS = { name: "Alice Sharma", email: USER_A.email, phone: "9876543210", line1: "12 Marine Drive, Flat 4B", city: "Mumbai", state: "Maharashtra", pincode: "400001" };

module.exports = { startTestServer, createFakeCashfree, USER_A, USER_B, ADMIN, ADDRESS };
