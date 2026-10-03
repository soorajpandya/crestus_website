const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, USER_A, USER_B, ADMIN, ADDRESS } = require("./helpers");

const ITEMS = [{ product_id: "w-midnight-slip", size: "M", qty: 1 }]; // ₹2499 → free shipping
const CHEAP_ITEMS = [{ product_id: "w-midnight-slip", size: "M", qty: 1, price: 1 }];

async function placeOrder(t, items = ITEMS, user = USER_A) {
  const res = await t.request("POST", "/api/orders/create", { user, body: { items, address: ADDRESS, cart_keys: items.map((i) => `${i.product_id}-${i.size}`) } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}

test("quote computes totals on the backend and applies the published shipping policy", async () => {
  const t = await startTestServer();
  try {
    const free = await t.request("POST", "/api/checkout/quote", { user: USER_A, body: { pincode: "400001", items: [{ product_id: "w-midnight-slip", size: "M", qty: 1, price: 5 }] } });
    assert.equal(free.status, 200);
    assert.equal(free.data.totals.subtotal, 2499);
    assert.equal(free.data.totals.shipping, 0);
    assert.equal(free.data.totals.total, 2499);
    assert.equal(free.data.serviceable, true);
    assert.ok(free.data.package.weight_kg > 0);

    const products = t.services.products;
    const cheap = products.find((p) => p.price < 1999);
    const paid = await t.request("POST", "/api/checkout/quote", { user: USER_A, body: { pincode: "400001", items: [{ product_id: cheap.id, size: cheap.sizes[0], qty: 1 }] } });
    assert.equal(paid.data.totals.shipping, 79);
    assert.equal(paid.data.totals.total, cheap.price + 79);

    const badSize = await t.request("POST", "/api/checkout/quote", { user: USER_A, body: { pincode: "400001", items: [{ product_id: "w-midnight-slip", size: "XXXL", qty: 1 }] } });
    assert.equal(badSize.status, 400);

    t.shiprocket.behaviour.courierUnavailable = true;
    const unserviceable = await t.request("POST", "/api/checkout/quote", { user: USER_A, body: { pincode: "999999", items: ITEMS } });
    assert.equal(unserviceable.data.serviceable, false);
    assert.equal(unserviceable.data.totals.shipping, 0);
  } finally {
    await t.close();
  }
});

test("order is persisted before payment and client-supplied amounts are ignored", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t, CHEAP_ITEMS);
    assert.equal(created.amount, 2499);
    assert.ok(created.payment_session_id);
    const stored = await t.services.store.getOrder(created.order_id);
    assert.equal(stored.payment.status, "pending");
    assert.equal(stored.totals.total, 2499);
    assert.equal(stored.items[0].unit_price, 2499);
    assert.equal(stored.items[0].sku, "W-MIDNIGHT-SLIP-M");
    assert.equal(stored.shipping_address.pincode, "400001");
    assert.equal(stored.package.weight_kg, 0.5);
    assert.equal(stored.pickup_location, "Primary");
    assert.equal(t.cashfree.calls[0][1].order_amount, 2499);
    assert.match(t.cashfree.calls[0][1].order_meta.return_url, /^https:\/\/crestuseccommerce\.store\/pending\?order_id=/);
    assert.equal(t.shiprocket.behaviour.calls.filter((c) => c.name === "createAdhocOrder").length, 0);
  } finally {
    await t.close();
  }
});

test("full payment creates exactly one Shiprocket order and books the shipment end to end", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t);
    t.cashfree.markPaid(created.cashfree_order_id);
    const verify = await t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.paid, true);

    const order = await t.services.store.getOrder(created.order_id);
    assert.equal(order.payment.status, "paid");
    assert.equal(order.payment.amount_paid, 2499);
    assert.ok(order.payment.cf_payment_id);
    assert.equal(order.fulfillment.status, "completed");
    assert.equal(order.fulfillment.stage, "done");
    assert.ok(order.shipment.sr_order_id);
    assert.ok(order.shipment.sr_shipment_id);
    assert.match(order.shipment.awb_code, /^MOCK/);
    assert.equal(order.shipment.courier_name, "Mock Express");
    assert.ok(order.shipment.pickup.scheduled_date);
    assert.ok(order.shipment.manifest_url);
    assert.ok(order.shipment.label_url);
    assert.ok(order.shipment.invoice_url);
    assert.equal(order.tracking.active, true);

    const calls = t.shiprocket.behaviour.calls.map((c) => c.name);
    assert.equal(calls.filter((c) => c === "createAdhocOrder").length, 1);
    assert.equal(calls.filter((c) => c === "assignAwb").length, 1);
    assert.equal(calls.filter((c) => c === "generatePickup").length, 1);

    const payload = t.shiprocket.behaviour.calls.find((c) => c.name === "createAdhocOrder").payload;
    assert.equal(payload.order_id, created.order_id);
    assert.equal(payload.payment_method, "Prepaid");
    assert.equal(payload.sub_total + payload.shipping_charges, order.totals.total);
    assert.equal(payload.order_items[0].selling_price * payload.order_items[0].units, order.totals.subtotal);
    assert.equal(payload.billing_pincode, "400001");
    assert.equal(payload.weight, order.package.weight_kg);

    const view = await t.request("GET", `/api/orders/${created.order_id}`, { user: USER_A });
    assert.equal(view.data.payment.status, "paid");
    assert.equal(view.data.shipment.awb_code, order.shipment.awb_code);
    assert.equal(view.data.shipment.invoice_url, order.shipment.invoice_url);
    assert.equal(view.data.shipment.label_url, undefined);
    assert.equal(view.data.fulfillment.status, "pickup_scheduled");
  } finally {
    await t.close();
  }
});

test("failed, pending, forged, mismatched and partial payments never create shipments", async () => {
  const t = await startTestServer();
  try {
    const srCreates = () => t.shiprocket.behaviour.calls.filter((c) => c.name === "createAdhocOrder").length;

    // pending (ACTIVE) + failed attempt
    const pending = await placeOrder(t);
    t.cashfree.markFailedAttempt(pending.cashfree_order_id);
    const v1 = await t.request("POST", `/api/orders/${pending.order_id}/verify`, { user: USER_A });
    assert.equal(v1.data.paid, false);
    assert.equal(srCreates(), 0);

    // webhook saying failed
    const failedHook = t.cashfree.signedWebhook({ type: "PAYMENT_FAILED_WEBHOOK", data: { order: { order_id: pending.cashfree_order_id }, payment: { payment_status: "FAILED", payment_message: "Bank declined" } } });
    const fh = await t.request("POST", "/api/webhooks/cashfree", { raw: failedHook.rawBody, headers: failedHook.headers });
    assert.equal(fh.status, 200);
    const afterFail = await t.services.store.getOrder(pending.order_id);
    assert.equal(afterFail.payment.status, "failed");
    assert.equal(afterFail.payment.last_failure_reason, "Bank declined");
    assert.equal(afterFail.fulfillment.status, "not_started");

    // forged webhook claiming PAID
    const forged = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: pending.cashfree_order_id, order_status: "PAID" } } });
    const forgedRes = await t.request("POST", "/webhook", { raw: forged, headers: { "content-type": "application/json", "x-webhook-signature": "bogus", "x-webhook-timestamp": "1" } });
    assert.equal(forgedRes.status, 401);
    assert.equal((await t.services.store.getOrder(pending.order_id)).payment.status, "failed");

    // genuine webhook claiming success, but Cashfree API says still ACTIVE → not paid
    const liar = t.cashfree.signedWebhook({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: pending.cashfree_order_id, order_status: "PAID" } } });
    const liarRes = await t.request("POST", "/webhook", { raw: liar.rawBody, headers: liar.headers });
    assert.equal(liarRes.status, 200);
    assert.equal(liarRes.data.paid, false);
    assert.equal(srCreates(), 0);

    // amount mismatch: Cashfree order shows PAID but for a different amount
    const mismatch = await placeOrder(t);
    t.cashfree.markPaid(mismatch.cashfree_order_id, { amount: 10 });
    const v2 = await t.request("POST", `/api/orders/${mismatch.order_id}/verify`, { user: USER_A });
    assert.equal(v2.data.paid, false);
    const mm = await t.services.store.getOrder(mismatch.order_id);
    assert.equal(mm.payment.status, "pending");
    assert.equal(mm.alerts[0].type, "payment_amount_mismatch");
    assert.equal(srCreates(), 0);

    // partial collection
    const partial = await placeOrder(t);
    t.cashfree.markPartiallyCollected(partial.cashfree_order_id, 1000);
    const v3 = await t.request("POST", `/api/orders/${partial.order_id}/verify`, { user: USER_A });
    assert.equal(v3.data.paid, false);
    assert.equal(srCreates(), 0);

    // expired
    const expired = await placeOrder(t);
    t.cashfree.markExpired(expired.cashfree_order_id);
    const v4 = await t.request("POST", `/api/orders/${expired.order_id}/verify`, { user: USER_A });
    assert.equal(v4.data.payment_status, "expired");
    assert.equal(srCreates(), 0);
  } finally {
    await t.close();
  }
});

test("duplicate webhooks and concurrent confirmations do not duplicate fulfillment", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t);
    t.cashfree.markPaid(created.cashfree_order_id);
    const hook = t.cashfree.signedWebhook({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: created.cashfree_order_id, order_status: "PAID" }, payment: { payment_status: "SUCCESS" } } });

    const results = await Promise.all([
      t.request("POST", "/webhook", { raw: hook.rawBody, headers: hook.headers }),
      t.request("POST", "/webhook", { raw: hook.rawBody, headers: hook.headers }),
      t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A }),
      t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A }),
      t.request("POST", "/api/orders/verify", { user: USER_A, body: { order_id: created.order_id } }),
    ]);
    results.forEach((r) => assert.equal(r.status, 200));
    await t.services.fulfillment.processOrder(created.order_id);
    await t.services.payments.reconcilePendingPayments();
    await t.services.fulfillment.runDueJobs();

    const calls = t.shiprocket.behaviour.calls.map((c) => c.name);
    assert.equal(calls.filter((c) => c === "createAdhocOrder").length, 1);
    assert.equal(calls.filter((c) => c === "assignAwb").length, 1);
    assert.equal(calls.filter((c) => c === "generatePickup").length, 1);
    const order = await t.services.store.getOrder(created.order_id);
    assert.equal(order.fulfillment.status, "completed");
    assert.equal(order.payment.confirmed_via !== null, true);
  } finally {
    await t.close();
  }
});

test("browser closed: webhook alone (or reconciliation) completes payment and fulfillment", async () => {
  const t = await startTestServer();
  try {
    const a = await placeOrder(t);
    t.cashfree.markPaid(a.cashfree_order_id);
    const hook = t.cashfree.signedWebhook({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: a.cashfree_order_id } } });
    const ack = await t.request("POST", "/webhook", { raw: hook.rawBody, headers: hook.headers });
    assert.equal(ack.status, 200);
    assert.equal(ack.data.paid, true);
    // Webhook is acknowledged once payment + job are persisted; the worker finishes in the background.
    await t.services.fulfillment.processOrder(a.order_id);
    assert.equal((await t.services.store.getOrder(a.order_id)).fulfillment.status, "completed");

    const b = await placeOrder(t);
    t.cashfree.markPaid(b.cashfree_order_id);
    await t.services.payments.reconcilePendingPayments();
    await t.services.fulfillment.processOrder(b.order_id);
    const order = await t.services.store.getOrder(b.order_id);
    assert.equal(order.payment.status, "paid");
    assert.equal(order.payment.confirmed_via, "reconcile");
    assert.equal(order.fulfillment.status, "completed");
  } finally {
    await t.close();
  }
});

test("Shiprocket failure preserves payment success and resumes from the failed stage", async () => {
  const t = await startTestServer({ FULFILLMENT_MAX_ATTEMPTS: "3" });
  try {
    // transient failure at AWB stage → retry_wait, order created only once
    t.shiprocket.behaviour.failStage = "assign_awb";
    t.shiprocket.behaviour.failMode = "timeout";
    const created = await placeOrder(t);
    t.cashfree.markPaid(created.cashfree_order_id);
    await t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A });

    let order = await t.services.store.getOrder(created.order_id);
    assert.equal(order.payment.status, "paid");
    assert.equal(order.fulfillment.status, "retry_wait");
    assert.equal(order.fulfillment.stage, "assign_awb");
    assert.ok(order.shipment.sr_order_id);
    assert.equal(order.fulfillment.last_error.uncertain, true);

    const view = await t.request("GET", `/api/orders/${created.order_id}`, { user: USER_A });
    assert.equal(view.data.payment.status, "paid");
    assert.equal(view.data.fulfillment.status, "preparing");
    assert.equal(JSON.stringify(view.data).includes("timed out"), false);

    // provider recovers → due job resumes at assign_awb without re-creating the order
    t.shiprocket.behaviour.failStage = null;
    await new Promise((r) => setTimeout(r, 15));
    await t.services.fulfillment.runDueJobs();
    order = await t.services.store.getOrder(created.order_id);
    assert.equal(order.fulfillment.status, "completed");
    assert.equal(t.shiprocket.behaviour.calls.filter((c) => c.name === "createAdhocOrder").length, 1);

    // validation failure → needs_attention + admin retry
    t.shiprocket.behaviour.calls.length = 0;
    t.shiprocket.behaviour.failStage = "pickup";
    t.shiprocket.behaviour.failMode = "validation";
    const second = await placeOrder(t);
    t.cashfree.markPaid(second.cashfree_order_id);
    await t.request("POST", `/api/orders/${second.order_id}/verify`, { user: USER_A });
    order = await t.services.store.getOrder(second.order_id);
    assert.equal(order.fulfillment.status, "needs_attention");
    assert.equal(order.fulfillment.stage, "pickup");
    assert.equal(order.alerts.at(-1).type, "fulfillment_needs_attention");

    const forbidden = await t.request("POST", `/api/admin/orders/${second.order_id}/fulfillment/retry`, { user: USER_A, body: {} });
    assert.equal(forbidden.status, 403);

    t.shiprocket.behaviour.failStage = null;
    const retry = await t.request("POST", `/api/admin/orders/${second.order_id}/fulfillment/retry`, { user: ADMIN, body: {} });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.fulfillment.status, "completed");
    assert.equal(t.shiprocket.behaviour.calls.filter((c) => c.name === "createAdhocOrder").length, 1);
    assert.equal(t.shiprocket.behaviour.calls.filter((c) => c.name === "assignAwb").length, 1);

    const docs = await t.request("GET", `/api/admin/orders/${second.order_id}/documents`, { user: ADMIN });
    assert.ok(docs.data.label_url && docs.data.manifest_url && docs.data.invoice_url);
  } finally {
    await t.close();
  }
});

test("tracking webhooks are authenticated, deduplicated and order-independent", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t);
    t.cashfree.markPaid(created.cashfree_order_id);
    await t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A });
    const order = await t.services.store.getOrder(created.order_id);
    const awb = order.shipment.awb_code;

    const statusBefore = order.tracking.status;
    // Wrong token: acknowledged (provider validators expect 2xx) but nothing is applied.
    const bad = await t.request("POST", "/api/webhooks/shipping-updates", { body: { awb, order_id: created.order_id, shipment_status_id: 7, current_status: "Delivered", current_timestamp: "2026-10-08 15:30:00" }, headers: { "x-api-key": "wrong" } });
    assert.equal(bad.status, 200);
    assert.equal(bad.data.handled, false);
    assert.equal(bad.data.reason, "unauthorized");
    assert.equal((await t.services.store.getOrder(created.order_id)).tracking.status, statusBefore);
    // Shiprocket's URL-validation ping carries no shipment data and must be acknowledged without a token.
    const ping = await t.request("POST", "/api/webhooks/shipping-updates", { body: {} });
    assert.equal(ping.status, 200);
    assert.equal((await t.request("GET", "/api/webhooks/shipping-updates")).status, 200);
    assert.equal((await t.request("HEAD", "/api/webhooks/shipping-updates")).status, 200);

    // Exact shape of Shiprocket's URL-validation request (captured): raw token in Authorization, dummy ids, "NA" statuses.
    const validator = await t.request("POST", "/api/webhooks/shipping-updates", {
      headers: { authorization: "ship-token" },
      body: {
        awb: "123456", courier_name: "dummy courier_name", current_status: "Delivered", current_status_id: 7, shipment_status: "Delivered", shipment_status_id: 7,
        current_timestamp: "03 10 2026 17:53:11", order_id: "dummpy shiprocket order id 123", sr_order_id: 1234, etd: "2026-10-03 17:53:11",
        scans: [{ location: "Mumbai", date: "2022-05-16 16:18:47", activity: "Manifested", status: "new", "sr-status": "NA", "sr-status-label": "NA" }],
        is_return: 0, channel_id: 1234,
      },
    });
    assert.equal(validator.status, 200);
    assert.equal(validator.data.handled, false);
    assert.equal((await t.services.store.getOrder(created.order_id)).tracking.status, statusBefore);

    const send = (body) => t.request("POST", "/api/webhooks/shipping-updates", { body, headers: { authorization: "ship-token" } });
    const late = {
      awb,
      order_id: created.order_id,
      current_status: "In Transit",
      shipment_status_id: 18,
      current_timestamp: "2026-10-05 08:00:00",
      etd: "2026-10-09 18:00:00",
      scans: [
        { date: "2026-10-04 10:00:00", activity: "Picked up", location: "Ahmedabad", "sr-status": "42", "sr-status-label": "PICKED UP" },
        { date: "2026-10-05 08:00:00", activity: "In transit", location: "Mumbai", "sr-status": "18", "sr-status-label": "IN TRANSIT" },
      ],
    };
    const r1 = await send(late);
    assert.equal(r1.status, 200);
    assert.equal(r1.data.handled, true);
    let o = await t.services.store.getOrder(created.order_id);
    assert.equal(o.tracking.status, "in_transit");
    const countAfterFirst = o.tracking.events.length;

    // duplicate delivery of the same webhook adds nothing
    await send(late);
    o = await t.services.store.getOrder(created.order_id);
    assert.equal(o.tracking.events.length, countAfterFirst);

    // older event arriving late must not regress the status
    await send({ awb, order_id: created.order_id, current_status: "Pickup Scheduled", shipment_status_id: 3, current_timestamp: "2026-10-03 12:00:00", scans: [] });
    o = await t.services.store.getOrder(created.order_id);
    assert.equal(o.tracking.status, "in_transit");
    assert.equal(o.tracking.events.length, countAfterFirst + 1);

    // delivered only from provider event
    await send({ awb, order_id: created.order_id, current_status: "Delivered", shipment_status_id: 7, current_timestamp: "2026-10-08 15:30:00", scans: [] });
    o = await t.services.store.getOrder(created.order_id);
    assert.equal(o.tracking.status, "delivered");
    assert.equal(o.tracking.active, false);
    assert.ok(o.tracking.delivered_at);

    // webhook for an unknown AWB is ignored, not applied to this order
    const unknown = await send({ awb: "NOPE123", order_id: "ord_unknown", current_status: "RTO", shipment_status_id: 9, current_timestamp: "2026-10-09 10:00:00" });
    assert.equal(unknown.data.handled, false);
    assert.equal((await t.services.store.getOrder(created.order_id)).tracking.status, "delivered");

    const view = await t.request("GET", `/api/orders/${created.order_id}`, { user: USER_A });
    assert.equal(view.data.fulfillment.status, "delivered");
    assert.equal(view.data.tracking.events[0].status, "delivered");
    assert.ok(view.data.shipment.etd);
  } finally {
    await t.close();
  }
});

test("customers can only access their own orders; admin routes need the admin role", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t);
    const mine = await t.request("GET", `/api/orders/${created.order_id}`, { user: USER_A });
    assert.equal(mine.status, 200);
    const theirs = await t.request("GET", `/api/orders/${created.order_id}`, { user: USER_B });
    assert.equal(theirs.status, 404);
    const verifyTheirs = await t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_B });
    assert.equal(verifyTheirs.status, 404);
    const retryTheirs = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_B });
    assert.equal(retryTheirs.status, 404);
    const listB = await t.request("GET", "/api/orders", { user: USER_B });
    assert.deepEqual(listB.data, []);
    const anon = await t.request("GET", "/api/orders");
    assert.equal(anon.status, 401);

    const adminList = await t.request("GET", "/api/admin/orders", { user: USER_A });
    assert.equal(adminList.status, 403);
    const adminOk = await t.request("GET", "/api/admin/orders", { user: ADMIN });
    assert.equal(adminOk.status, 200);
    assert.equal(adminOk.data[0].payment.payment_session_id, undefined);

    const pub = await t.request("GET", `/api/orders/track/${created.order_id}`);
    assert.equal(pub.status, 404);
    const pubOk = await t.request("GET", `/api/orders/track/${created.order_id}?email=${encodeURIComponent(USER_A.email)}`);
    assert.equal(pubOk.status, 200);
    assert.equal(pubOk.data.shipping_address, undefined);
  } finally {
    await t.close();
  }
});

test("retry payment reuses or recreates a Cashfree session and refuses when already paid", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t);
    t.cashfree.markFailedAttempt(created.cashfree_order_id);
    const r1 = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A });
    assert.equal(r1.data.paid, false);
    assert.equal(r1.data.payment_session_id, `session_${created.cashfree_order_id}`);

    t.cashfree.markExpired(created.cashfree_order_id);
    const r2 = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A });
    assert.equal(r2.data.cashfree_order_id, `${created.order_id}-r2`);
    assert.equal(t.cashfree.calls.filter((c) => c[0] === "create").at(-1)[1].order_amount, 2499);

    t.cashfree.markPaid(r2.data.cashfree_order_id);
    // Cashfree's return_url carries the suffixed id; customer routes must resolve it to the internal order.
    const viaSuffix = await t.request("POST", `/api/orders/${r2.data.cashfree_order_id}/verify`, { user: USER_A });
    assert.equal(viaSuffix.status, 200);
    assert.equal(viaSuffix.data.order_id, created.order_id);
    assert.equal(viaSuffix.data.paid, true);
    const hook = t.cashfree.signedWebhook({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: r2.data.cashfree_order_id } } });
    const hr = await t.request("POST", "/webhook", { raw: hook.rawBody, headers: hook.headers });
    assert.equal(hr.data.order_id, created.order_id);
    const r3 = await t.request("POST", `/api/orders/${created.order_id}/retry-payment`, { user: USER_A });
    assert.equal(r3.data.paid, true);
    assert.equal(t.shiprocket.behaviour.calls.filter((c) => c.name === "createAdhocOrder").length, 1);
  } finally {
    await t.close();
  }
});

test("admin can cancel a shipment and refund separately", async () => {
  const t = await startTestServer();
  try {
    const created = await placeOrder(t);
    t.cashfree.markPaid(created.cashfree_order_id);
    await t.request("POST", `/api/orders/${created.order_id}/verify`, { user: USER_A });

    const cancel = await t.request("POST", `/api/admin/orders/${created.order_id}/fulfillment/cancel`, { user: ADMIN, body: { reason: "Customer request" } });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.fulfillment.status, "cancelled");
    assert.equal(cancel.data.payment.status, "paid");
    assert.equal(t.shiprocket.behaviour.calls.filter((c) => c.name === "cancelOrders").length, 1);

    const tooMuch = await t.request("POST", `/api/admin/orders/${created.order_id}/refund`, { user: ADMIN, body: { amount: 99999 } });
    assert.equal(tooMuch.status, 400);
    const refund = await t.request("POST", `/api/admin/orders/${created.order_id}/refund`, { user: ADMIN, body: { reason: "Cancelled before dispatch" } });
    assert.equal(refund.status, 200);
    assert.equal(refund.data.payment.status, "refunded");
    assert.equal(refund.data.payment.refunds[0].amount, 2499);
  } finally {
    await t.close();
  }
});
