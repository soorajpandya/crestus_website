// Durable fulfillment worker: resumes each order from its persisted stage, never recreating Shiprocket orders/AWBs/pickups.
const { withLock } = require("./lock");
const { ShiprocketError } = require("./shiprocket");
const { now } = require("./orders");

const STAGES = ["serviceability", "create_order", "assign_awb", "pickup", "manifest", "label", "invoice"];
const nextStage = (stage) => STAGES[STAGES.indexOf(stage) + 1] || "done";

class StageError extends Error {
  constructor(message, { code = "STAGE_FAILED", transient = false, uncertain = false, data } = {}) {
    super(message);
    this.code = code;
    this.transient = transient;
    this.uncertain = uncertain;
    this.data = data;
  }
}

const fmtIst = (iso) => {
  const d = new Date(iso || Date.now());
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
};

function buildAdhocOrderPayload(order, config) {
  const [first, ...rest] = order.customer.name.trim().split(/\s+/);
  const addr = order.shipping_address;
  const sr = config.shiprocket;
  const payload = {
    order_id: order.order_id,
    order_date: fmtIst(order.payment.paid_at || order.created_at),
    pickup_location: order.pickup_location || sr.pickupLocation,
    comment: `Crestus order ${order.order_id}`,
    billing_customer_name: first,
    billing_last_name: rest.join(" ") || "",
    billing_address: addr.line1,
    billing_address_2: addr.line2 || "",
    billing_city: addr.city,
    billing_pincode: addr.pincode,
    billing_state: addr.state,
    billing_country: addr.country || "India",
    billing_email: order.customer.email,
    billing_phone: order.customer.phone,
    shipping_is_billing: true,
    order_items: order.items.map((i) => ({
      name: i.size ? `${i.name} (${i.size})` : i.name,
      sku: i.sku,
      units: i.qty,
      selling_price: i.unit_price,
      discount: 0,
      tax: 0,
      ...(config.shipping.hsnCode ? { hsn: config.shipping.hsnCode } : {}),
    })),
    payment_method: "Prepaid",
    shipping_charges: order.totals.shipping,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: order.totals.subtotal,
    length: order.package.length_cm,
    breadth: order.package.breadth_cm,
    height: order.package.height_cm,
    weight: order.package.weight_kg,
  };
  if (sr.channelId) payload.channel_id = sr.channelId;
  return payload;
}

const includesAlready = (err) => /already/i.test(`${err?.message || ""} ${JSON.stringify(err?.data || {})}`);

function createFulfillmentService({ config, store, shiprocket, shipping, tracking, payments, logger = console }) {
  const w = config.worker;

  async function alertAdmin(order, alert) {
    logger.error(`[fulfillment][ALERT] ${order.order_id}: ${alert.type} — ${alert.message}`);
    if (config.adminAlertWebhookUrl) {
      try {
        await fetch(config.adminAlertWebhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `Crestus fulfillment alert — ${order.order_id}: ${alert.type}: ${alert.message}` }) });
      } catch (err) {
        logger.warn("[fulfillment] alert webhook failed:", err.message);
      }
    }
  }

  const wrap = (err) => {
    if (err instanceof StageError) return err;
    if (err instanceof ShiprocketError) return new StageError(err.message, { code: err.code, transient: err.transient, uncertain: err.uncertain, data: err.data });
    return new StageError(err.message || "Unexpected error", { code: "UNEXPECTED", transient: false });
  };

  // ---- stages -------------------------------------------------------------
  const stages = {
    async serviceability(order) {
      if (!shiprocket.enabled) throw new StageError("Shiprocket is not configured", { code: "NOT_CONFIGURED" });
      const svc = await shipping.checkServiceability({ pincode: order.shipping_address.pincode, weightKg: order.package.weight_kg, declaredValue: order.totals.subtotal });
      if (!svc.serviceable || !svc.selected) throw new StageError("No courier is serviceable for this pincode", { code: "COURIER_UNAVAILABLE" });
      const variance = Math.round((svc.selected.rate - Number(order.totals.shipping)) * 100) / 100;
      if (variance > 0) logger.warn(`[fulfillment] ${order.order_id} courier rate ${svc.selected.rate} exceeds charged shipping ${order.totals.shipping}; customer total unchanged`);
      return (o) => ({
        ...o,
        shipment: { ...o.shipment, courier_company_id: svc.selected.courier_company_id, courier_name: svc.selected.courier_name, selected_courier_rate: svc.selected.rate, shipping_cost_variance: variance, courier_etd: svc.selected.etd || null },
      });
    },

    async create_order(order) {
      if (order.shipment.sr_order_id) return null;
      let created = null;
      if (order.fulfillment.last_error?.stage === "create_order" && order.fulfillment.last_error?.uncertain) {
        // A timed-out create may have succeeded: reconcile before sending again.
        const existing = await shiprocket.findOrderByChannelOrderId(order.order_id);
        if (existing) created = { order_id: existing.id || existing.order_id, shipment_id: existing.shipments?.[0]?.id || existing.shipment_id };
      }
      if (!created) created = await shiprocket.createAdhocOrder(buildAdhocOrderPayload(order, config));
      if (!created?.order_id || !created?.shipment_id) throw new StageError("Shiprocket did not return order/shipment ids", { code: "BAD_RESPONSE", data: created });
      return (o) => ({
        ...o,
        shipment: {
          ...o.shipment,
          sr_order_id: String(created.order_id),
          sr_shipment_id: String(created.shipment_id),
          awb_code: created.awb_code || o.shipment.awb_code,
          courier_name: created.courier_name || o.shipment.courier_name,
        },
      });
    },

    async assign_awb(order) {
      if (order.shipment.awb_code) return (o) => ({ ...o, tracking: { ...o.tracking, active: true, status: o.tracking.status || "preparing" } });
      const shipmentId = order.shipment.sr_shipment_id;
      let data = null;
      if (order.fulfillment.last_error?.stage === "assign_awb" && order.fulfillment.last_error?.uncertain) {
        try {
          const srOrder = await shiprocket.getOrder(order.shipment.sr_order_id);
          const awb = srOrder?.data?.shipments?.awb || srOrder?.data?.awb_data?.awb;
          if (awb) data = { awb_code: awb, courier_company_id: srOrder.data.shipments?.courier_id, courier_name: srOrder.data.shipments?.courier };
        } catch {}
      }
      if (!data) {
        let resp;
        try {
          resp = await shiprocket.assignAwb({ shipmentId, courierId: order.shipment.courier_company_id });
        } catch (err) {
          if (err instanceof ShiprocketError && !err.transient && order.shipment.courier_company_id) {
            logger.warn(`[fulfillment] ${order.order_id} preferred courier failed, letting Shiprocket pick`);
            resp = await shiprocket.assignAwb({ shipmentId });
          } else throw err;
        }
        data = resp?.response?.data || resp?.data || resp;
        if (Number(resp?.awb_assign_status) !== 1 && !data?.awb_code) {
          throw new StageError(resp?.message || data?.awb_assign_error || "AWB assignment failed", { code: "AWB_FAILED", data: resp });
        }
      }
      if (!data?.awb_code) throw new StageError("AWB missing in Shiprocket response", { code: "BAD_RESPONSE", data });
      return (o) => ({
        ...o,
        shipment: { ...o.shipment, awb_code: String(data.awb_code), courier_company_id: data.courier_company_id ?? o.shipment.courier_company_id, courier_name: data.courier_name || o.shipment.courier_name },
        tracking: { ...o.tracking, active: true, status: o.tracking.status || "preparing" },
      });
    },

    async pickup(order) {
      if (order.shipment.pickup?.scheduled_date || order.shipment.pickup?.requested) return null;
      let resp;
      try {
        resp = await shiprocket.generatePickup({ shipmentId: order.shipment.sr_shipment_id });
      } catch (err) {
        if (err instanceof ShiprocketError && !err.transient && includesAlready(err)) resp = { pickup_status: 1, response: { already: true } };
        else throw err;
      }
      const r = resp?.response || {};
      if (Number(resp?.pickup_status) !== 1 && !r.pickup_scheduled_date) throw new StageError(resp?.message || "Pickup request failed", { code: "PICKUP_FAILED", data: resp });
      return (o) => ({
        ...o,
        shipment: { ...o.shipment, pickup: { requested: true, scheduled_date: r.pickup_scheduled_date || null, token: r.pickup_token_number || null, requested_at: now() } },
        tracking: { ...o.tracking, status: o.tracking.status === "preparing" || !o.tracking.status ? "pickup_scheduled" : o.tracking.status },
      });
    },

    async manifest(order) {
      if (order.shipment.manifest_url) return null;
      let url = null;
      try {
        const gen = await shiprocket.generateManifest({ shipmentId: order.shipment.sr_shipment_id });
        url = gen?.manifest_url || null;
      } catch (err) {
        if (!(err instanceof ShiprocketError && !err.transient && includesAlready(err))) throw err;
      }
      if (!url) {
        const printed = await shiprocket.printManifest({ srOrderId: order.shipment.sr_order_id });
        url = printed?.manifest_url || null;
      }
      if (!url) throw new StageError("Manifest URL missing", { code: "BAD_RESPONSE" });
      return (o) => ({ ...o, shipment: { ...o.shipment, manifest_url: url } });
    },

    async label(order) {
      if (order.shipment.label_url) return null;
      const resp = await shiprocket.generateLabel({ shipmentId: order.shipment.sr_shipment_id });
      if (!resp?.label_url) throw new StageError(resp?.response || "Label URL missing", { code: "BAD_RESPONSE", data: resp });
      return (o) => ({ ...o, shipment: { ...o.shipment, label_url: resp.label_url } });
    },

    async invoice(order) {
      if (order.shipment.invoice_url) return null;
      const resp = await shiprocket.printInvoice({ srOrderId: order.shipment.sr_order_id });
      if (!resp?.invoice_url) throw new StageError("Invoice URL missing", { code: "BAD_RESPONSE", data: resp });
      return (o) => ({ ...o, shipment: { ...o.shipment, invoice_url: resp.invoice_url } });
    },
  };

  // ---- job processing -----------------------------------------------------
  async function processOrder(orderId) {
    return withLock(`ful:${orderId}`, async () => {
      let order = await store.getOrder(orderId);
      if (!order) return null;
      if (!["paid", "partially_refunded"].includes(order.payment.status)) return order; // never ship unpaid
      if (!["queued", "retry_wait", "processing"].includes(order.fulfillment.status)) return order;

      order = await store.updateOrder(orderId, (o) => ({ ...o, updated_at: now(), fulfillment: { ...o.fulfillment, status: "processing", due: false, started_at: o.fulfillment.started_at || now() } }));
      let stage = order.fulfillment.stage || STAGES[0];

      while (stage !== "done") {
        try {
          const patch = await stages[stage](order);
          const completedStage = stage;
          stage = nextStage(stage);
          order = await store.updateOrder(orderId, (o) => {
            const base = patch ? patch(o) : o;
            return {
              ...base,
              updated_at: now(),
              fulfillment: { ...base.fulfillment, stage, attempts: 0, last_error: null, history: [...(base.fulfillment.history || []), { stage: completedStage, at: now(), ok: true }].slice(-50) },
            };
          });
        } catch (rawErr) {
          const err = wrap(rawErr);
          const attempts = (order.fulfillment.attempts || 0) + 1;
          const retry = err.transient && attempts < w.maxAttempts;
          const backoff = Math.min(w.maxBackoffMs, w.baseBackoffMs * 2 ** (attempts - 1));
          const lastError = { stage, code: err.code, message: err.message, uncertain: Boolean(err.uncertain), transient: Boolean(err.transient), at: now(), data: safeData(err.data) };
          order = await store.updateOrder(orderId, (o) => ({
            ...o,
            updated_at: now(),
            fulfillment: {
              ...o.fulfillment,
              status: retry ? "retry_wait" : "needs_attention",
              due: retry,
              next_run_at: retry ? new Date(Date.now() + backoff).toISOString() : null,
              attempts,
              last_error: lastError,
              history: [...(o.fulfillment.history || []), { stage, at: now(), ok: false, message: err.message }].slice(-50),
            },
            alerts: retry ? o.alerts : [...(o.alerts || []), { type: "fulfillment_needs_attention", at: now(), stage, message: err.message, code: err.code }],
          }));
          if (retry) logger.warn(`[fulfillment] ${orderId} stage ${stage} failed (${err.code}); retry ${attempts}/${w.maxAttempts} in ${Math.round(backoff / 1000)}s`);
          else await alertAdmin(order, { type: `fulfillment_${stage}_failed`, message: `${err.code}: ${err.message}` });
          return order;
        }
      }

      order = await store.updateOrder(orderId, (o) => ({
        ...o,
        updated_at: now(),
        fulfillment: { ...o.fulfillment, status: "completed", stage: "done", due: false, next_run_at: null, completed_at: now() },
        tracking: { ...o.tracking, active: true, status: o.tracking.status || "pickup_scheduled" },
      }));
      logger.info(`[fulfillment] ${orderId} booked: SR order ${order.shipment.sr_order_id}, AWB ${order.shipment.awb_code}`);
      tracking.refreshFromProvider(order).catch(() => {});
      return order;
    });
  }

  async function retryStage(orderId, { stage, by } = {}) {
    if (stage && !STAGES.includes(stage)) {
      const e = new Error(`Unknown stage ${stage}`);
      e.status = 400;
      throw e;
    }
    const updated = await store.updateOrder(orderId, (o) => {
      if (!["paid", "partially_refunded"].includes(o.payment.status)) {
        const e = new Error("Order is not paid");
        e.status = 409;
        throw e;
      }
      if (o.fulfillment.status === "completed" || o.fulfillment.status === "cancelled") {
        const e = new Error(`Fulfillment already ${o.fulfillment.status}`);
        e.status = 409;
        throw e;
      }
      return {
        ...o,
        updated_at: now(),
        fulfillment: { ...o.fulfillment, status: "queued", stage: stage || o.fulfillment.stage || STAGES[0], due: true, next_run_at: now(), attempts: 0, history: [...(o.fulfillment.history || []), { stage: "retry", at: now(), ok: true, message: `Retry requested by ${by || "admin"}` }].slice(-50) },
      };
    });
    if (!updated) return null;
    return processOrder(orderId);
  }

  async function cancelShipment(orderId, { by, reason } = {}) {
    return withLock(`ful:${orderId}`, async () => {
      const order = await store.getOrder(orderId);
      if (!order) return null;
      if (order.fulfillment.status === "cancelled") return order;
      if (["picked_up", "in_transit", "out_for_delivery", "delivered"].includes(order.tracking.status)) {
        const e = new Error("Shipment already in courier network; cancel via Shiprocket panel/RTO");
        e.status = 409;
        throw e;
      }
      if (order.shipment.sr_order_id) await shiprocket.cancelOrders({ srOrderIds: [Number(order.shipment.sr_order_id) || order.shipment.sr_order_id] });
      return store.updateOrder(orderId, (o) => ({
        ...o,
        updated_at: now(),
        fulfillment: { ...o.fulfillment, status: "cancelled", due: false, next_run_at: null, cancelled_at: now(), cancelled_by: by || null, cancel_reason: reason || null, history: [...(o.fulfillment.history || []), { stage: "cancel", at: now(), ok: true, message: reason || "Shipment cancelled" }].slice(-50) },
        tracking: { ...o.tracking, active: false, status: "cancelled" },
      }));
    });
  }

  // ---- scheduler ----------------------------------------------------------
  let timers = [];
  let draining = false;
  async function runDueJobs() {
    if (draining) return;
    draining = true;
    try {
      const due = await store.listDueFulfillmentJobs();
      for (const o of due) {
        try {
          await processOrder(o.order_id);
        } catch (err) {
          logger.error("[fulfillment] job crashed", o.order_id, err.message);
        }
      }
    } finally {
      draining = false;
    }
  }

  function start() {
    if (timers.length) return;
    timers.push(setInterval(() => runDueJobs().catch(() => {}), w.pollIntervalMs));
    timers.push(setInterval(() => tracking.pollActiveShipments().catch(() => {}), w.trackingPollIntervalMs));
    timers.push(setInterval(() => payments.reconcilePendingPayments().catch(() => {}), w.paymentReconcileIntervalMs));
    timers.forEach((t) => t.unref?.());
    runDueJobs().catch(() => {});
    logger.info(`[fulfillment] worker started (poll ${w.pollIntervalMs}ms, shiprocket ${shiprocket.enabled ? (shiprocket.mock ? "mock" : "live") : "disabled"})`);
  }
  function stop() {
    timers.forEach(clearInterval);
    timers = [];
  }

  return { processOrder, retryStage, cancelShipment, runDueJobs, start, stop, STAGES, buildAdhocOrderPayload: (o) => buildAdhocOrderPayload(o, config) };
}

function safeData(data) {
  if (!data) return null;
  try {
    const str = JSON.stringify(data);
    return str.length > 2000 ? { truncated: str.slice(0, 2000) } : data;
  } catch {
    return null;
  }
}

module.exports = { createFulfillmentService, buildAdhocOrderPayload, STAGES, StageError };
