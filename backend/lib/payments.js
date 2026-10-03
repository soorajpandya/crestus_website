// Cashfree payment service: session creation, idempotent confirmation, webhooks, reconciliation, refunds.
const crypto = require("crypto");
const { withLock } = require("./lock");
const { now } = require("./orders");

const AMOUNT_TOLERANCE = 0.01;

// Internal order id ↔ Cashfree order id: retries append "-rN" so both stay traceable.
const cashfreeOrderIdFor = (orderId, attempt) => (attempt <= 1 ? orderId : `${orderId}-r${attempt}`);
const internalOrderIdFrom = (cashfreeOrderId) => String(cashfreeOrderId || "").replace(/-r\d+$/, "");

function createPaymentService({ config, store, cashfree, logger = console, onPaid = async () => {} }) {
  const environment = config.cashfree.sandbox ? "sandbox" : "production";
  const returnUrl = `${config.frontendUrl}/pending?order_id={order_id}`;

  async function createCashfreeOrder(order, attempt) {
    const cashfreeOrderId = cashfreeOrderIdFor(order.order_id, attempt);
    const response = await cashfree.PGCreateOrder({
      order_id: cashfreeOrderId,
      order_amount: Number(order.totals.total),
      order_currency: order.totals.currency,
      customer_details: {
        customer_id: order.user_id ? order.user_id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50) : order.customer.phone,
        customer_phone: order.customer.phone,
        customer_name: order.customer.name,
        customer_email: order.customer.email,
      },
      order_meta: { return_url: returnUrl },
      order_note: `Crestus order ${order.order_id}`,
      order_tags: { internal_order_id: order.order_id },
    });
    const data = response.data;
    return { cashfree_order_id: cashfreeOrderId, cf_order_id: data.cf_order_id, payment_session_id: data.payment_session_id, created_at: now() };
  }

  async function createPaymentSession(order) {
    const attempt = await createCashfreeOrder(order, 1);
    const updated = await store.updateOrder(order.order_id, (o) => ({
      ...o,
      updated_at: now(),
      payment: { ...o.payment, cashfree_order_id: attempt.cashfree_order_id, cf_order_id: attempt.cf_order_id, payment_session_id: attempt.payment_session_id, attempts: [attempt] },
    }));
    return { order: updated, payment_session_id: attempt.payment_session_id, cashfree_order_id: attempt.cashfree_order_id, cf_order_id: attempt.cf_order_id, environment };
  }

  async function fetchCashfreeStatus(cashfreeOrderId) {
    const res = await cashfree.PGFetchOrder(cashfreeOrderId);
    return res.data;
  }

  async function fetchPayments(cashfreeOrderId) {
    try {
      const res = await cashfree.PGOrderFetchPayments(cashfreeOrderId);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      logger.warn("[payments] could not fetch payments for", cashfreeOrderId, err.response?.data?.message || err.message);
      return [];
    }
  }

  // Single idempotent confirmation path shared by webhook, return page, retry and reconciliation.
  async function confirmPayment(orderId, { source = "verify", hint } = {}) {
    return withLock(`pay:${orderId}`, async () => {
      const order = await store.getOrder(orderId);
      if (!order) return { found: false, paid: false, changed: false, order: null };
      if (order.payment.status === "paid" || order.payment.status === "refunded" || order.payment.status === "partially_refunded") {
        return { found: true, paid: true, changed: false, order };
      }

      const candidateIds = [order.payment.cashfree_order_id, ...(order.payment.attempts || []).map((a) => a.cashfree_order_id)].filter(
        (v, i, arr) => v && arr.indexOf(v) === i
      );
      if (candidateIds.length === 0) return { found: true, paid: false, changed: false, order };

      let paidResult = null;
      let currentStatus = null;
      let failureReason = order.payment.last_failure_reason;
      let mismatch = null;

      for (const cfId of candidateIds) {
        let cfOrder;
        try {
          cfOrder = await fetchCashfreeStatus(cfId);
        } catch (err) {
          logger.warn("[payments] fetch failed for", cfId, err.response?.data?.message || err.message);
          continue;
        }
        if (cfId === order.payment.cashfree_order_id) currentStatus = cfOrder.order_status;
        if (cfOrder.order_status !== "PAID") continue;

        const payments = await fetchPayments(cfId);
        const successful = payments.filter((p) => p.payment_status === "SUCCESS");
        const collected = successful.length ? successful.reduce((s, p) => s + Number(p.payment_amount || 0), 0) : Number(cfOrder.order_amount);
        const amountOk = Math.abs(Number(cfOrder.order_amount) - Number(order.totals.total)) <= AMOUNT_TOLERANCE && collected + AMOUNT_TOLERANCE >= Number(order.totals.total);
        const currencyOk = (cfOrder.order_currency || "INR") === order.totals.currency;
        if (!amountOk || !currencyOk) {
          mismatch = { cashfree_order_id: cfId, expected: order.totals.total, order_amount: cfOrder.order_amount, collected, currency: cfOrder.order_currency };
          continue;
        }
        const primary = successful[0] || {};
        paidResult = {
          cashfree_order_id: cfId,
          cf_order_id: cfOrder.cf_order_id,
          cf_payment_id: primary.cf_payment_id ? String(primary.cf_payment_id) : null,
          payment_method: primary.payment_group || (primary.payment_method ? Object.keys(primary.payment_method)[0] : null),
          amount_paid: collected,
          paid_at: primary.payment_completion_time || primary.payment_time || now(),
        };
        break;
      }

      if (paidResult) {
        const ts = now();
        let changed = false;
        const updated = await store.updateOrder(orderId, (o) => {
          changed = false;
          if (o.payment.status === "paid") return null;
          changed = true;
          return {
            ...o,
            updated_at: ts,
            payment: { ...o.payment, status: "paid", ...paidResult, confirmed_via: source, last_failure_reason: null },
            // Durable fulfillment job persisted in the same write as the payment confirmation.
            fulfillment: { ...o.fulfillment, status: "queued", stage: "serviceability", due: true, next_run_at: ts, attempts: 0, last_error: null, history: [...(o.fulfillment.history || []), { stage: "queued", at: ts, ok: true, message: `Payment confirmed via ${source}` }] },
          };
        });
        if (changed) {
          logger.info(`[payments] ${orderId} confirmed PAID via ${source}`);
          onPaid(updated).catch((err) => logger.error("[payments] onPaid hook failed:", err.message));
        }
        return { found: true, paid: true, changed, order: updated };
      }

      // Not paid: record diagnostic state without ever triggering fulfillment.
      let nextStatus = order.payment.status;
      if (currentStatus === "EXPIRED") nextStatus = "expired";
      else if (currentStatus === "TERMINATED" || currentStatus === "TERMINATION_REQUESTED") nextStatus = "failed";
      if (hint?.failure_reason) failureReason = hint.failure_reason;
      if (hint?.status === "failed" && nextStatus === "pending") nextStatus = "failed";
      if (mismatch) {
        logger.error(`[payments] ${orderId} amount/currency mismatch`, mismatch);
      }
      const updated = await store.updateOrder(orderId, (o) => {
        if (o.payment.status === "paid") return null;
        const alerts = mismatch ? [...(o.alerts || []), { type: "payment_amount_mismatch", at: now(), detail: mismatch }] : o.alerts;
        if (nextStatus === o.payment.status && failureReason === o.payment.last_failure_reason && !mismatch) return null;
        return { ...o, updated_at: now(), alerts, payment: { ...o.payment, status: nextStatus, last_failure_reason: failureReason || null } };
      });
      return { found: true, paid: false, changed: false, order: updated || order, mismatch: Boolean(mismatch) };
    });
  }

  // Failed/abandoned attempts leave the Cashfree order ACTIVE; a new Cashfree order is created only when needed.
  async function retryPayment(orderId) {
    const confirmed = await confirmPayment(orderId, { source: "retry" });
    if (!confirmed.found) return null;
    if (confirmed.paid) return { paid: true, order: confirmed.order };
    return withLock(`pay:${orderId}`, async () => {
      const order = await store.getOrder(orderId);
      if (order.payment.status === "paid") return { paid: true, order };
      let current = null;
      try {
        current = order.payment.cashfree_order_id ? await fetchCashfreeStatus(order.payment.cashfree_order_id) : null;
      } catch {}
      if (current && current.order_status === "ACTIVE" && current.payment_session_id) {
        const reset = await store.updateOrder(orderId, (o) => (o.payment.status === "paid" ? null : { ...o, updated_at: now(), payment: { ...o.payment, status: "pending", last_failure_reason: null } }));
        return { paid: false, order: reset, payment_session_id: current.payment_session_id, cashfree_order_id: order.payment.cashfree_order_id, environment };
      }
      const attemptNo = (order.payment.attempts || []).length + 1;
      const attempt = await createCashfreeOrder(order, attemptNo);
      const updated = await store.updateOrder(orderId, (o) => ({
        ...o,
        updated_at: now(),
        payment: { ...o.payment, status: "pending", last_failure_reason: null, cashfree_order_id: attempt.cashfree_order_id, cf_order_id: attempt.cf_order_id, payment_session_id: attempt.payment_session_id, attempts: [...(o.payment.attempts || []), attempt] },
      }));
      return { paid: false, order: updated, payment_session_id: attempt.payment_session_id, cashfree_order_id: attempt.cashfree_order_id, environment };
    });
  }

  // Verifies the signature against the exact raw body, then re-confirms with Cashfree's API before acting.
  async function handleWebhook({ rawBody, headers }) {
    const signature = headers["x-webhook-signature"];
    const timestamp = headers["x-webhook-timestamp"];
    if (!signature || !timestamp || !rawBody) {
      const err = new Error("Missing webhook signature headers");
      err.status = 400;
      throw err;
    }
    let event;
    try {
      event = cashfree.PGVerifyWebhookSignature(String(signature), rawBody, String(timestamp));
    } catch (err) {
      const e = new Error("Invalid webhook signature");
      e.status = 401;
      throw e;
    }
    const body = event?.object || JSON.parse(rawBody);
    const type = body?.type || event?.type;
    const cfOrderId = body?.data?.order?.order_id;
    if (!cfOrderId) return { handled: false, type };
    const orderId = internalOrderIdFrom(cfOrderId);
    const hint = {};
    if (type === "PAYMENT_FAILED_WEBHOOK" || type === "PAYMENT_USER_DROPPED_WEBHOOK") {
      hint.status = "failed";
      hint.failure_reason = body?.data?.payment?.payment_message || body?.data?.error_details?.error_description || (type === "PAYMENT_USER_DROPPED_WEBHOOK" ? "Payment was not completed" : "Payment failed");
    }
    const result = await confirmPayment(orderId, { source: "webhook", hint });
    return { handled: result.found, type, order_id: orderId, paid: result.paid };
  }

  // Scheduled safety net for missed webhooks / closed browsers.
  async function reconcilePendingPayments() {
    const pending = await store.listPendingPayments();
    const cutoff = Date.now() - config.worker.paymentPendingTtlMs;
    for (const order of pending) {
      if (!order.payment.cashfree_order_id) continue;
      try {
        const res = await confirmPayment(order.order_id, { source: "reconcile" });
        if (!res.paid && Date.parse(order.created_at) < cutoff) {
          await store.updateOrder(order.order_id, (o) => (o.payment.status === "pending" ? { ...o, updated_at: now(), payment: { ...o.payment, status: "expired" } } : null));
        }
      } catch (err) {
        logger.warn("[payments] reconcile failed for", order.order_id, err.message);
      }
    }
  }

  async function createRefund(orderId, { amount, reason, by }) {
    return withLock(`pay:${orderId}`, async () => {
      const order = await store.getOrder(orderId);
      if (!order) return null;
      if (!["paid", "partially_refunded"].includes(order.payment.status)) {
        const e = new Error("Only paid orders can be refunded");
        e.status = 409;
        throw e;
      }
      const alreadyRefunded = (order.payment.refunds || []).filter((r) => r.status !== "CANCELLED").reduce((s, r) => s + Number(r.amount), 0);
      const refundable = Number(order.payment.amount_paid) - alreadyRefunded;
      const refundAmount = Number(amount || refundable);
      if (!(refundAmount > 0) || refundAmount - refundable > AMOUNT_TOLERANCE) {
        const e = new Error(`Refund amount must be between 0 and ${refundable}`);
        e.status = 400;
        throw e;
      }
      const refundId = `rf_${order.order_id}_${crypto.randomBytes(3).toString("hex")}`;
      const res = await cashfree.PGOrderCreateRefund(order.payment.cashfree_order_id, { refund_amount: refundAmount, refund_id: refundId, refund_note: (reason || "Refund").slice(0, 100) });
      const refund = { refund_id: refundId, cf_refund_id: res.data?.cf_refund_id ? String(res.data.cf_refund_id) : null, amount: refundAmount, status: res.data?.refund_status || "PENDING", reason: reason || null, by: by || null, created_at: now() };
      const total = alreadyRefunded + refundAmount;
      return store.updateOrder(orderId, (o) => ({
        ...o,
        updated_at: now(),
        payment: { ...o.payment, refunds: [...(o.payment.refunds || []), refund], status: total + AMOUNT_TOLERANCE >= Number(o.payment.amount_paid) ? "refunded" : "partially_refunded" },
      }));
    });
  }

  return { createPaymentSession, confirmPayment, retryPayment, handleWebhook, reconcilePendingPayments, createRefund, environment, internalOrderIdFrom };
}

module.exports = { createPaymentService, cashfreeOrderIdFor, internalOrderIdFrom };
