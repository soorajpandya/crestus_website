const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { startTestServer, createFakeRazorpay, USER_A, USER_B, ADMIN, ADDRESS } = require("./helpers");
const { loadConfig } = require("../lib/config");
const { createRazorpayClient } = require("../lib/razorpay");

const KEY_SECRET = "fake-key-secret";
const WEBHOOK_SECRET = "fake-webhook-secret";
const ITEMS = [{ product_id: "w-midnight-slip", size: "M", qty: 1, price: 1 }];

async function setup(env = {}) {
  const razorpay = createFakeRazorpay();
  const server = await startTestServer({ PAYMENT_GATEWAY: "razorpay", RAZORPAY_KEY_ID: "rzp_test_fake", RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, ...env }, { razorpay });
  return { ...server, razorpay };
}
async function place(t) {
  const response = await t.request("POST", "/api/orders/create", { user: USER_A, body: { address: ADDRESS, items: ITEMS } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}
const verify = (t, created, body) => t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A, body });
const shipCount = t => t.shiprocket.behaviour.calls.filter(call => call.name === "createAdhocOrder").length;

test("new checkout defaults to Razorpay, snapshots trusted prices, uses paise and exposes no secret", async () => {
  assert.equal(loadConfig({}).paymentGateway, "razorpay");
  assert.equal(loadConfig({ PAYMENT_GATEWAY: "cashfree", CASHFREE_APP_ID: "retired" }).paymentGateway, "razorpay");
  assert.equal(loadConfig({}).cashfree, undefined);
  const t = await setup();
  try {
    const created = await place(t);
    assert.equal(created.gateway, "razorpay");
    assert.equal(created.key_id, "rzp_test_fake");
    assert.equal(created.environment, "sandbox");
    assert.equal(created.amount_minor, created.amount * 100);
    assert.equal(created.currency, "INR");
    assert.equal(created.payment_session_id, undefined);
    assert.equal(JSON.stringify(created).includes(KEY_SECRET), false);
    const stored = await t.services.store.getOrder(created.order_id);
    assert.equal(stored.payment.gateway, "razorpay");
    assert.equal(stored.payment.status, "pending");
    assert.equal(stored.payment.razorpay_order_id, created.razorpay_order_id);
    assert.equal(stored.totals.total, require("../products.json").find(p => p.id === ITEMS[0].product_id).price);
    const body = t.razorpay.calls[0][1];
    assert.equal(body.amount, created.amount_minor);
    assert.equal(body.partial_payment, false);
    assert.equal(body.receipt, created.order_id);
    assert.equal(body.notes.internal_order_id, created.order_id);
    assert.equal(shipCount(t), 0);
    assert.equal((await t.request("GET", "/health")).data.gateway, "razorpay");
  } finally { await t.close(); }
});

test("retired gateway records are readable but cannot create, retry, refund or confirm through a provider", async () => {
  const t = await setup();
  try {
    for (const status of ["pending", "paid"]) {
      const created = await place(t);
      const stored = await t.services.store.getOrder(created.order_id);
      const legacy = { ...stored, payment: { ...stored.payment, gateway: "cashfree", status, cashfree_order_id: "original_provider_id", razorpay_order_id: null, amount_paid: status === "paid" ? created.amount : null } };
      await t.services.store.putOrder(legacy);
      const before = JSON.stringify(legacy);
      const callCount = t.razorpay.calls.length;
      t.razorpay.fetchOrder = async () => { assert.fail("A retired gateway record must not contact Razorpay"); };
      const result = await t.services.payments.confirmPayment(created.order_id);
      assert.equal(result.retired_gateway, true);
      assert.equal(result.paid, status === "paid");
      assert.equal(result.changed, false);
      for (const operation of [() => t.services.payments.retryPayment(created.order_id), () => t.services.payments.createRefund(created.order_id, {}), () => t.services.payments.createPaymentSession(legacy)]) {
        await assert.rejects(operation(), error => error.status === 409);
      }
      const view = await t.request("GET", `/api/orders/${created.order_id}`, { user: USER_A });
      assert.equal(view.data.payment.gateway, "cashfree");
      assert.equal(view.data.payment.can_retry, false);
      await t.services.payments.reconcilePendingPayments();
      assert.equal(JSON.stringify(await t.services.store.getOrder(created.order_id)), before);
      assert.equal(t.razorpay.calls.length, callCount);
      assert.equal(shipCount(t), 0);
    }
    for (const route of ["/webhook", "/api/webhooks/cashfree"]) {
      assert.equal((await t.request("POST", route, { body: {} })).status, 404);
    }
  } finally { await t.close(); }
});

test("missing Razorpay keys fail closed before storing a checkout order", async () => {
  const t = await setup({ RAZORPAY_KEY_SECRET: "" });
  try {
    const response = await t.request("POST", "/api/orders/create", { user: USER_A, body: { address: ADDRESS, items: ITEMS } });
    assert.equal(response.status, 503);
    assert.deepEqual(await t.services.store.listOrders(), []);
    assert.deepEqual(t.razorpay.calls, []);
  } finally { await t.close(); }
});

test("verified captured payment enqueues one shipment despite duplicate and out-of-order confirmations", async () => {
  const t = await setup();
  try {
    const created = await place(t);
    const payment = t.razorpay.markPaid(created.razorpay_order_id);
    const callback = t.razorpay.checkout(created.razorpay_order_id, payment);
    const hook = t.razorpay.webhook(created.razorpay_order_id);
    const responses = await Promise.all([verify(t, created, callback), t.request("POST", "/api/webhooks/razorpay", hook), verify(t, created, callback)]);
    for (const response of responses) { assert.equal(response.status, 200); assert.equal(response.data.paid, true); }
    for (let i = 0; i < 50 && (await t.services.store.getOrder(created.order_id)).fulfillment.status !== "completed"; i++) await new Promise(setImmediate);
    assert.equal(shipCount(t), 1);
    const stale = await t.request("POST", "/api/webhooks/razorpay", t.razorpay.webhook(created.razorpay_order_id, "payment.failed"));
    assert.equal(stale.data.paid, true);
    const order = await t.services.store.getOrder(created.order_id);
    assert.equal(order.payment.razorpay_payment_id, payment.id);
    assert.equal(order.payment.amount_paid, created.amount);
    assert.equal(order.fulfillment.status, "completed");
    assert.equal(order.fulfillment.history.filter(h => h.stage === "queued").length, 1);
    const retry = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A });
    assert.equal(retry.data.paid, true);
    assert.equal(t.razorpay.calls.filter(c => c[0] === "create").length, 1);
    assert.equal(t.services.cashfree, undefined);
  } finally { await t.close(); }
});

test("forged, incomplete and foreign-order checkout signatures cannot confirm or ship", async () => {
  const t = await setup();
  try {
    const created = await place(t);
    const payment = t.razorpay.markPaid(created.razorpay_order_id);
    const signature = t.razorpay.checkout(created.razorpay_order_id, payment);
    assert.equal((await verify(t, created, { ...signature, razorpay_signature: "0".repeat(64) })).status, 401);
    assert.equal((await verify(t, created, { razorpay_payment_id: payment.id })).status, 401);
    const other = await place(t);
    assert.equal((await verify(t, other, signature)).status, 401);
    const owned = await t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_B, body: signature });
    assert.equal(owned.status, 404);
    assert.equal(shipCount(t), 0);
    assert.equal((await t.services.store.getOrder(created.order_id)).payment.status, "pending");
  } finally { await t.close(); }
});

test("authorization alone, wrong currency, short collection and payment from another order never ship", async () => {
  for (const scenario of ["authorized", "currency", "short", "foreign", "order_amount", "payment_amount", "payment_id"]) {
    const t = await setup();
    try {
      const created = await place(t);
      const payment = t.razorpay.markPaid(created.razorpay_order_id);
      const order = t.razorpay.orders.get(created.razorpay_order_id);
      if (scenario === "authorized") { order.status = "attempted"; payment.status = "authorized"; payment.captured = false; }
      if (scenario === "currency") payment.currency = "USD";
      if (scenario === "short") order.amount_paid -= 1;
      if (scenario === "foreign") payment.order_id = "order_other";
      if (scenario === "order_amount") order.amount += 1;
      if (scenario === "payment_amount") payment.amount -= 1;
      const callback = t.razorpay.checkout(created.razorpay_order_id, scenario === "payment_id" ? { id: "pay_other" } : payment);
      const response = await verify(t, created, callback);
      assert.equal(response.status, 200, scenario);
      assert.equal(response.data.paid, false, scenario);
      assert.equal(shipCount(t), 0, scenario);
      assert.equal((await t.services.store.getOrder(created.order_id)).fulfillment.due, false, scenario);
      if (scenario !== "authorized") {
        const retry = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A });
        // A callback for a different payment ID cannot bypass verification; API re-check may find the genuine captured payment.
        if (scenario !== "payment_id") assert.equal(retry.status, 409, scenario);
      }
    } finally { await t.close(); }
  }
});

test("webhooks require the separate secret and exact raw payload", async () => {
  const t = await setup();
  try {
    const created = await place(t);
    t.razorpay.markPaid(created.razorpay_order_id);
    const hook = t.razorpay.webhook(created.razorpay_order_id);
    assert.equal((await t.request("POST", "/api/webhooks/razorpay", { ...hook, raw: hook.raw + " " })).status, 401);
    assert.equal((await t.request("POST", "/api/webhooks/razorpay", { ...hook, headers: { "content-type": "application/json" } })).status, 400);
    assert.equal(shipCount(t), 0);
    assert.equal((await t.request("POST", "/api/webhooks/razorpay", hook)).data.paid, true);
  } finally { await t.close(); }
  const unconfigured = await setup({ RAZORPAY_WEBHOOK_SECRET: "" });
  try {
    assert.equal((await unconfigured.request("POST", "/api/webhooks/razorpay", { body: {} })).status, 503);
  } finally { await unconfigured.close(); }
});

test("payment retry reuses Razorpay order; provider errors cannot create a second order", async () => {
  const t = await setup();
  try {
    const created = await place(t);
    const retry = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.razorpay_order_id, created.razorpay_order_id);
    assert.equal(retry.data.gateway, "razorpay");
    t.razorpay.unavailable = true;
    assert.equal((await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A })).status, 500);
    assert.equal(t.razorpay.calls.filter(c => c[0] === "create").length, 1);
    assert.equal(shipCount(t), 0);
  } finally { await t.close(); }
});

test("scheduled reconciliation confirms capture without a browser callback", async () => {
  const t = await setup();
  try {
    const created = await place(t);
    t.razorpay.markPaid(created.razorpay_order_id);
    await t.services.payments.reconcilePendingPayments();
    assert.equal((await t.services.store.getOrder(created.order_id)).payment.status, "paid");
    assert.equal(t.services.cashfree, undefined);
  } finally { await t.close(); }
});


test("Razorpay refunds use integer paise, block zero/over-refunds and reserve uncertain requests", async () => {
  const t = await setup();
  try {
    const created = await place(t);
    const payment = t.razorpay.markPaid(created.razorpay_order_id);
    await verify(t, created);
    const refund = body => t.request("POST", `/api/admin/orders/${created.order_id}/refund`, { user: ADMIN, body });
    assert.equal((await refund({ amount: 0 })).status, 400);
    assert.equal((await refund({ amount: created.amount + 1 })).status, 400);
    const partial = await refund({ amount: 1.23 });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.payment.status, "partially_refunded");
    const call = t.razorpay.calls.find(c => c[0] === "refund");
    assert.equal(call[1], payment.id);
    assert.equal(call[2].amount, 123);
    t.razorpay.refundUncertain = true;
    assert.equal((await refund({})).status, 502);
    assert.equal((await refund({})).status, 400);
    assert.equal(t.razorpay.calls.filter(c => c[0] === "refund").length, 2);
    assert.equal((await t.services.store.getOrder(created.order_id)).payment.refunds.at(-1).status, "UNKNOWN");
    assert.equal(t.services.cashfree, undefined);
  } finally { await t.close(); }
});

test("REST client uses backend auth, correct API resources and sanitized provider failures", async () => {
  const calls = [];
  const config = loadConfig({ RAZORPAY_KEY_ID: "rzp_test_fake", RAZORPAY_KEY_SECRET: KEY_SECRET });
  const client = createRazorpayClient({ config, fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: "order_fake" }) }; } });
  await client.createOrder({ amount: 123, currency: "INR" });
  await client.fetchOrder("order_fake");
  await client.fetchOrderPayments("order_fake");
  await client.createRefund("pay_fake", { amount: 123 });
  assert.deepEqual(calls.map(c => c.url), ["https://api.razorpay.com/v1/orders", "https://api.razorpay.com/v1/orders/order_fake", "https://api.razorpay.com/v1/orders/order_fake/payments", "https://api.razorpay.com/v1/payments/pay_fake/refund"]);
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from(`rzp_test_fake:${KEY_SECRET}`).toString("base64")}`);
  const failing = createRazorpayClient({ config, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { description: KEY_SECRET } }) }) });
  await assert.rejects(failing.fetchOrder("order_fake"), error => error.status === 502 && !error.message.includes(KEY_SECRET));
});
