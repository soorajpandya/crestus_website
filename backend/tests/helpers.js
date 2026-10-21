const crypto = require("crypto");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig } = require("../lib/config");
const { createApp } = require("../app");
const { createShiprocketClient } = require("../lib/shiprocket");

const KEY_SECRET = "fake-key-secret";
const WEBHOOK_SECRET = "fake-webhook-secret";

function createFakeRazorpay() {
  const orders = new Map();
  const payments = new Map();
  let sequence = 1;
  return {
    orders, payments, calls: [], unavailable: false, refundUncertain: false,
    async createOrder(body) {
      this.calls.push(["create", body]);
      const order = { ...body, id: `order_fake${sequence++}`, amount_paid: 0, amount_due: body.amount, status: "created" };
      orders.set(order.id, order);
      return { ...order };
    },
    async fetchOrder(id) {
      if (this.unavailable) throw new Error("Provider unavailable");
      assert.ok(orders.has(id), "Unknown provider order");
      return { ...orders.get(id) };
    },
    async fetchOrderPayments(id) { return { items: payments.get(id) || [] }; },
    async createRefund(id, body) {
      this.calls.push(["refund", id, body]);
      if (this.refundUncertain) throw new Error("Connection reset after submission");
      return { id: `rfnd_fake${sequence++}`, payment_id: id, amount: body.amount, status: "processed" };
    },
    markFailedAttempt(id) {
      const order = orders.get(id);
      order.status = "attempted";
      payments.set(id, [{ id: `pay_failed${sequence++}`, order_id: id, amount: order.amount, status: "failed", captured: false, error_description: "Bank declined" }]);
    },
    markPartiallyCollected(id, collected) {
      this.markPaid(id, { amount: collected });
      orders.get(id).amount_paid = collected;
      orders.get(id).amount_due = orders.get(id).amount - collected;
    },
    markPaid(id, overrides = {}) {
      const order = orders.get(id);
      order.status = "paid";
      order.amount_paid = order.amount;
      order.amount_due = 0;
      const payment = { id: `pay_fake${sequence++}`, order_id: id, amount: order.amount, currency: order.currency, status: "captured", captured: true, method: "upi", ...overrides };
      payments.set(id, [payment]);
      return payment;
    },
    checkout(id, payment) {
      return { razorpay_order_id: id, razorpay_payment_id: payment.id,
        razorpay_signature: crypto.createHmac("sha256", KEY_SECRET).update(`${id}|${payment.id}`).digest("hex") };
    },
    webhook(id, event = "payment.captured") {
      const raw = JSON.stringify({ event, payload: { payment: { entity: { order_id: id } } } }, null, 2);
      return { raw, headers: { "content-type": "application/json", "x-razorpay-signature": crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex") } };
    },
  };
}

async function startTestServer(extraEnv = {}, overrides = {}) {
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
    RAZORPAY_KEY_ID: "rzp_test_fake",
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...extraEnv,
  };
  const config = loadConfig(env);
  const razorpay = createFakeRazorpay();
  const shiprocket = createShiprocketClient({ config, store: null });
  const quiet = { info() {}, warn() {}, error() {}, log() {} };
  const { app, services } = createApp({ config, razorpay, shiprocket, logger: quiet, processOnPaid: true, ...overrides });
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

  return { request, services, razorpay, shiprocket, close, base };
}

const USER_A = { uid: "uid-a", email: "alice@crestus.test" };
const USER_B = { uid: "uid-b", email: "bob@crestus.test" };
const ADMIN = { uid: "uid-admin", email: "admin@crestus.test" };

const ADDRESS = { name: "Alice Sharma", email: USER_A.email, phone: "9876543210", line1: "12 Marine Drive, Flat 4B", city: "Mumbai", state: "Maharashtra", pincode: "400001" };

module.exports = { startTestServer, createFakeRazorpay, USER_A, USER_B, ADMIN, ADDRESS };
