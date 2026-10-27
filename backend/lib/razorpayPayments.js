const crypto = require("crypto");
const { withLock } = require("./lock");
const { now } = require("./orders");
const { isHistoricalImport, requireOperationalOrder } = require("./historicalImport");

const settled = order => ["paid", "refunded", "partially_refunded"].includes(order.payment.status);
const fail = (message, status) => Object.assign(new Error(message), { status });
function requireRazorpayOrder(order) {
  requireOperationalOrder(order);
  if (order.payment.gateway !== "razorpay") throw fail("This order uses a retired payment gateway. Contact support before placing a new order.", 409);
}
function minorAmount(amount) {
  const value = Number(amount);
  const minor = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(minor) || Math.abs(value * 100 - minor) > 0.000001) throw fail("Invalid payment amount", 400);
  return minor;
}
function validSignature(message, signature, secret) {
  if (!secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(message).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function createRazorpayPaymentService({ config, store, razorpay, logger = console, onPaid = async () => {} }) {
  const environment = config.razorpay.keyId.startsWith("rzp_test_") ? "sandbox" : "production";
  const idsFor = order => [...new Set([order.payment.razorpay_order_id, ...(order.payment.attempts || []).map(a => a.razorpay_order_id)].filter(Boolean))];
  const checkoutPayload = order => ({
    gateway: "razorpay", environment, key_id: config.razorpay.keyId,
    razorpay_order_id: order.payment.razorpay_order_id,
    amount_minor: minorAmount(order.totals.total), currency: order.totals.currency,
    prefill: { name: order.customer.name, email: order.customer.email, contact: order.customer.phone },
  });
  async function createPaymentSession(order) {
    requireRazorpayOrder(order);
    if (!config.razorpay.keyId || !config.razorpay.keySecret) throw fail("Razorpay is not configured", 503);
    const amount = minorAmount(order.totals.total);
    const created = await razorpay.createOrder({
      amount, currency: order.totals.currency, receipt: order.order_id, partial_payment: false,
      notes: { internal_order_id: order.order_id, products: order.items.map(item => item.name).join(", ").slice(0, 250) },
    });
    if (!/^order_[A-Za-z0-9]+$/.test(created.id || "") || created.amount !== amount || created.currency !== order.totals.currency) throw fail("Invalid order response from Razorpay", 502);
    const attempt = { razorpay_order_id: created.id, created_at: now() };
    const updated = await store.updateOrder(order.order_id, o => ({ ...o, updated_at: now(), payment: {
      ...o.payment, gateway: "razorpay", status: "pending", razorpay_order_id: created.id,
      attempts: [...(o.payment.attempts || []), attempt], last_failure_reason: null,
    } }));
    return { order: updated, ...checkoutPayload(updated) };
  }

  function verifyCheckout(order, checkout) {
    const providerId = idsFor(order).find(id => id === checkout.razorpay_order_id);
    if (!providerId || !/^pay_[A-Za-z0-9]+$/.test(checkout.razorpay_payment_id || "") ||
        !validSignature(`${providerId}|${checkout.razorpay_payment_id}`, checkout.razorpay_signature, config.razorpay.keySecret)) {
      throw fail("Invalid Razorpay payment signature", 401);
    }
  }

  // Only authoritative, captured, fully collected payments can enqueue fulfillment.
  async function confirmPayment(orderId, { source = "verify", checkout } = {}) {
    return withLock(`pay:${orderId}`, async () => {
      const order = await store.getOrder(orderId);
      if (!order) return { found: false, paid: false, changed: false, order: null };
      if (isHistoricalImport(order)) return { found: true, paid: settled(order), changed: false, historical_import: true, order };
      if (order.payment.gateway !== "razorpay") return { found: true, paid: settled(order), changed: false, retired_gateway: true, order };
      if (checkout) verifyCheckout(order, checkout);
      if (settled(order)) return { found: true, paid: true, changed: false, order };
      const expected = minorAmount(order.totals.total);
      let mismatch = null;
      for (const id of idsFor(order)) {
        // Provider errors propagate; never offer a fresh payment while status is unknown.
        const remote = await razorpay.fetchOrder(id);
        if (remote.status !== "paid") continue;
        const response = await razorpay.fetchOrderPayments(id);
        const captured = (response.items || []).filter(p => p.status === "captured" && p.captured === true && p.order_id === id);
        const payment = captured.find(p => p.amount === expected && p.currency === order.totals.currency &&
          (!checkout || (checkout.razorpay_order_id === id && checkout.razorpay_payment_id === p.id)));
        const matching = remote.id === id && remote.amount === expected && remote.amount_paid === expected && remote.amount_due === 0 && remote.currency === order.totals.currency;
        if (!matching || !payment) {
          mismatch = { gateway: "razorpay", razorpay_order_id: id, expected_minor: expected, order_amount_minor: remote.amount, collected_minor: remote.amount_paid, currency: remote.currency };
          continue;
        }
        const ts = now();
        let changed = false;
        const updated = await store.updateOrder(orderId, o => {
          changed = false;
          if (settled(o)) return null;
          changed = true;
          return { ...o, updated_at: ts,
            payment: { ...o.payment, status: "paid", gateway: "razorpay", razorpay_order_id: id, razorpay_payment_id: payment.id,
              payment_method: payment.method || null, amount_paid: payment.amount / 100, paid_at: ts, confirmed_via: source, last_failure_reason: null },
            fulfillment: { ...o.fulfillment, status: "queued", stage: "serviceability", due: true, next_run_at: ts, attempts: 0, last_error: null,
              history: [...(o.fulfillment.history || []), { stage: "queued", at: ts, ok: true, message: `Payment confirmed via ${source}` }] },
          };
        });
        if (changed) {
          logger.info(`[payments] ${orderId} confirmed PAID via ${source}`);
          onPaid(updated).catch(error => logger.error("[payments] onPaid hook failed:", error.message));
        }
        return { found: true, paid: true, changed, order: updated };
      }
      if (mismatch) {
        await store.updateOrder(orderId, o => settled(o) ? null : ({ ...o, updated_at: now(),
          alerts: [...(o.alerts || []).filter(a => a.type !== "payment_amount_mismatch"), { type: "payment_amount_mismatch", at: now(), detail: mismatch }] }));
      }
      return { found: true, paid: false, changed: false, order: await store.getOrder(orderId), mismatch: Boolean(mismatch) };
    });
  }

  async function retryPayment(orderId) {
    const order = await store.getOrder(orderId);
    if (!order) return null;
    requireRazorpayOrder(order);
    const confirmed = await confirmPayment(orderId, { source: "retry" });
    if (confirmed.paid) return { paid: true, order: confirmed.order };
    if (confirmed.mismatch) throw fail("Payment needs review before retrying. Please contact support.", 409);
    return withLock(`pay:${orderId}`, async () => {
      const current = await store.getOrder(orderId);
      if (settled(current)) return { paid: true, order: current };
      if (!current.payment.razorpay_order_id) return { paid: false, ...await createPaymentSession(current) };
      const remote = await razorpay.fetchOrder(current.payment.razorpay_order_id);
      if (remote.status === "paid") throw fail("Payment is being verified. Please check your order shortly.", 409);
      if (!["created", "attempted"].includes(remote.status) || remote.amount !== minorAmount(current.totals.total) || remote.currency !== current.totals.currency) throw fail("Payment needs review before retrying", 409);
      const updated = await store.updateOrder(orderId, o => settled(o) ? null : ({ ...o, updated_at: now(), payment: { ...o.payment, status: "pending", last_failure_reason: null } }));
      if (settled(updated)) return { paid: true, order: updated };
      return { paid: false, order: updated, ...checkoutPayload(updated) };
    });
  }

  async function handleWebhook({ rawBody, headers }) {
    if (!config.razorpay.webhookSecret) throw fail("Razorpay webhook is not configured", 503);
    if (!rawBody || !headers["x-razorpay-signature"]) throw fail("Missing Razorpay webhook signature", 400);
    if (!validSignature(rawBody, headers["x-razorpay-signature"], config.razorpay.webhookSecret)) throw fail("Invalid Razorpay webhook signature", 401);
    let event;
    try { event = JSON.parse(rawBody); } catch { throw fail("Invalid webhook body", 400); }
    if (!["order.paid", "payment.captured", "payment.authorized", "payment.failed"].includes(event.event)) return { handled: false, type: event.event || null };
    const providerId = event.payload?.order?.entity?.id || event.payload?.payment?.entity?.order_id;
    if (!/^order_[A-Za-z0-9]+$/.test(providerId || "")) return { handled: false, type: event.event };
    const remote = await razorpay.fetchOrder(providerId);
    const internalId = remote.notes?.internal_order_id;
    const order = typeof internalId === "string" ? await store.getOrder(internalId) : null;
    if (!order || isHistoricalImport(order) || order.payment.gateway !== "razorpay" || !idsFor(order).includes(providerId)) return { handled: false, type: event.event };
    const result = await confirmPayment(order.order_id, { source: "webhook" });
    return { handled: true, type: event.event, order_id: order.order_id, paid: result.paid };
  }

  async function reconcilePendingPayments() {
    for (const order of await store.listPendingPayments()) {
      if (isHistoricalImport(order) || order.payment.gateway !== "razorpay" || !order.payment.razorpay_order_id) continue;
      try { await confirmPayment(order.order_id, { source: "reconcile" }); }
      catch (error) { logger.warn("[payments] Razorpay reconciliation failed for", order.order_id, error.message); }
    }
  }

  async function createRefund(orderId, { amount, reason, by }) {
    return withLock(`pay:${orderId}`, async () => {
      const order = await store.getOrder(orderId);
      if (!order) return null;
      requireRazorpayOrder(order);
      if (!["paid", "partially_refunded"].includes(order.payment.status) || !order.payment.razorpay_payment_id) throw fail("Only paid orders can be refunded", 409);
      const reserved = (order.payment.refunds || []).filter(r => !["CANCELLED", "FAILED"].includes(r.status)).reduce((s, r) => s + minorAmount(r.amount), 0);
      const refundable = minorAmount(order.payment.amount_paid) - reserved;
      const refundMinor = amount === undefined || amount === null || amount === "" ? refundable : minorAmount(amount);
      if (refundMinor <= 0 || refundMinor > refundable) throw fail("Refund exceeds the remaining paid amount", 400);
      // Reserve before contacting the provider: ambiguous network failures must never cause a duplicate refund.
      const refundId = `rf_${crypto.randomBytes(12).toString("hex")}`;
      const intent = { refund_id: refundId, amount: refundMinor / 100, status: "SUBMITTING", reason: reason || null, by: by || null, created_at: now() };
      await store.updateOrder(orderId, o => {
        const currentReserved = (o.payment.refunds || []).filter(r => !["CANCELLED", "FAILED"].includes(r.status)).reduce((sum, r) => sum + minorAmount(r.amount), 0);
        if (!['paid', 'partially_refunded'].includes(o.payment.status) || refundMinor > minorAmount(o.payment.amount_paid) - currentReserved) throw fail("Refund exceeds the remaining paid amount", 400);
        return { ...o, updated_at: now(), payment: { ...o.payment, refunds: [...(o.payment.refunds || []), intent] } };
      });
      let refund;
      try {
        refund = await razorpay.createRefund(order.payment.razorpay_payment_id, { amount: refundMinor, receipt: refundId, notes: { internal_order_id: orderId, reason: String(reason || "Refund").slice(0, 250) } });
        if (!refund.id || refund.payment_id !== order.payment.razorpay_payment_id || refund.amount !== refundMinor || !["processed", "pending", "failed"].includes(refund.status)) throw fail("Invalid Razorpay refund response", 502);
      } catch (error) {
        await store.updateOrder(orderId, o => ({ ...o, updated_at: now(), payment: { ...o.payment, refunds: o.payment.refunds.map(r => r.refund_id === refundId ? { ...r, status: "UNKNOWN" } : r) } }));
        throw fail("Refund status is unknown. Verify it in Razorpay before retrying.", 502);
      }
      return store.updateOrder(orderId, o => {
        const refunds = o.payment.refunds.map(r => r.refund_id === refundId ? { ...r, razorpay_refund_id: refund.id, status: refund.status.toUpperCase() } : r);
        const processed = refunds.filter(r => r.status === "PROCESSED").reduce((sum, r) => sum + minorAmount(r.amount), 0);
        const status = processed >= minorAmount(o.payment.amount_paid) ? "refunded" : processed > 0 ? "partially_refunded" : o.payment.status;
        return { ...o, updated_at: now(), payment: { ...o.payment, refunds, status } };
      });
    });
  }
  return { createPaymentSession, confirmPayment, retryPayment, handleWebhook, reconcilePendingPayments, createRefund, environment,
    gateway: "razorpay", configured: Boolean(config.razorpay.keyId && config.razorpay.keySecret), internalOrderIdFrom: id => String(id || "") };
}

module.exports = { createRazorpayPaymentService, minorAmount, validSignature };
