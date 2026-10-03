// Shipment tracking: Shiprocket status mapping, idempotent event ingestion, webhook handling and polling.
const crypto = require("crypto");
const { now } = require("./orders");

// Shiprocket shipment status ids → customer-friendly status. Raw values are always preserved alongside.
const STATUS_BY_ID = {
  1: "preparing", 2: "preparing", 5: "preparing", 11: "preparing", 52: "preparing", 59: "preparing", 60: "preparing", 61: "preparing", 62: "preparing", 63: "preparing", 67: "preparing", 68: "preparing",
  3: "pickup_scheduled", 4: "pickup_scheduled", 15: "pickup_scheduled", 19: "pickup_scheduled",
  6: "picked_up", 42: "picked_up", 51: "picked_up",
  18: "in_transit", 22: "in_transit", 38: "in_transit", 39: "in_transit", 48: "in_transit", 49: "in_transit", 50: "in_transit", 54: "in_transit", 55: "in_transit", 56: "in_transit", 57: "in_transit",
  17: "out_for_delivery",
  7: "delivered",
  12: "delivery_exception", 13: "delivery_exception", 20: "delivery_exception", 21: "delivery_exception", 23: "delivery_exception", 24: "delivery_exception", 25: "delivery_exception", 71: "delivery_exception", 72: "delivery_exception", 76: "delivery_exception", 77: "delivery_exception",
  9: "returned", 10: "returned", 14: "returned", 40: "returned", 41: "returned", 46: "returned", 75: "returned", 78: "returned",
  8: "cancelled", 16: "cancelled", 45: "cancelled",
};

const LABEL_RULES = [
  [/rto|return/i, "returned"],
  [/cancel/i, "cancelled"],
  [/out for delivery/i, "out_for_delivery"],
  [/delivered/i, "delivered"],
  [/undelivered|exception|lost|damaged|destroyed|untraceable|failed/i, "delivery_exception"],
  [/in transit|reached|hub|in flight|misrouted|delayed/i, "in_transit"],
  [/picked ?up|shipped|handover/i, "picked_up"],
  [/pickup|out for pickup/i, "pickup_scheduled"],
  [/awb|label|manifest|pending|booked|packed/i, "preparing"],
];

function mapStatus(rawId, rawLabel) {
  const byId = STATUS_BY_ID[Number(rawId)];
  if (byId) return byId;
  const label = String(rawLabel || "");
  for (const [re, status] of LABEL_RULES) if (re.test(label)) return status;
  return null;
}

const TERMINAL = new Set(["delivered", "returned", "cancelled"]);

// Shiprocket timestamps are IST without an offset; webhooks use "DD MM YYYY HH:mm:ss", tracking API uses "YYYY-MM-DD HH:mm:ss".
function toIso(value) {
  if (!value) return now();
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return new Date(`${s.replace(" ", "T")}+05:30`).toISOString();
  const dmy = s.match(/^(\d{2})[ \/-](\d{2})[ \/-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = dmy;
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:30`).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? now() : d.toISOString();
}

function eventId(e) {
  return crypto.createHash("sha1").update(`${e.at}|${e.raw_status_id || ""}|${e.raw_status || ""}|${e.activity || ""}|${e.location || ""}`).digest("hex").slice(0, 20);
}

function normaliseActivity(a) {
  const rawId = a["sr-status"] ?? a.sr_status ?? a.status_id ?? null;
  const rawLabel = a["sr-status-label"] ?? a.sr_status_label ?? a.status ?? a.activity ?? "";
  const numericId = Number(rawId);
  const ev = { at: toIso(a.date), raw_status_id: rawId !== null && rawId !== "" && Number.isFinite(numericId) ? numericId : null, raw_status: String(rawLabel), activity: a.activity || null, location: a.location || null };
  ev.status = mapStatus(ev.raw_status_id, `${ev.raw_status} ${ev.activity || ""}`);
  ev.label = ev.raw_status || ev.activity;
  ev.id = eventId(ev);
  return ev;
}

function createTrackingService({ config, store, shiprocket, logger = console, onStatusChange = async () => {} }) {
  // Merges events idempotently; the current status comes from the latest-timestamped event, so out-of-order arrival is safe.
  async function ingest(orderId, { events = [], etd, track_url, courier_name, source }) {
    let changed = false;
    let previousStatus = null;
    const updated = await store.updateOrder(orderId, (o) => {
      changed = false;
      previousStatus = o.tracking.status;
      const byId = new Map((o.tracking.events || []).map((e) => [e.id, e]));
      let added = 0;
      for (const e of events) {
        if (!byId.has(e.id)) {
          byId.set(e.id, { ...e, source, received_at: now() });
          added += 1;
        }
      }
      const all = Array.from(byId.values()).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const latest = [...all].reverse().find((e) => e.status) || null;
      const status = latest?.status || o.tracking.status || (o.shipment.awb_code ? "pickup_scheduled" : "preparing");
      const nextEtd = etd ? toIso(etd) : o.tracking.etd;
      const nextTrackUrl = track_url || o.tracking.track_url;
      const nextCourier = courier_name || o.shipment.courier_name;
      if (added === 0 && status === o.tracking.status && nextEtd === o.tracking.etd && nextTrackUrl === o.tracking.track_url && nextCourier === o.shipment.courier_name) return null;
      changed = true;
      return {
        ...o,
        updated_at: now(),
        shipment: { ...o.shipment, courier_name: nextCourier },
        tracking: {
          ...o.tracking,
          active: !TERMINAL.has(status),
          status,
          raw_status: latest?.raw_status ?? o.tracking.raw_status,
          raw_status_id: latest?.raw_status_id ?? o.tracking.raw_status_id,
          etd: nextEtd,
          track_url: nextTrackUrl,
          last_event_at: latest?.at || o.tracking.last_event_at,
          delivered_at: status === "delivered" ? o.tracking.delivered_at || latest?.at || now() : o.tracking.delivered_at,
          events: all.slice(-200),
        },
      };
    });
    if (changed && updated && updated.tracking.status !== previousStatus) {
      onStatusChange(updated, previousStatus).catch((err) => logger.error("[tracking] onStatusChange failed:", err.message));
    }
    return { changed, order: updated };
  }

  async function findOrderForWebhook(body) {
    const channelId = body.order_id || body.channel_order_id;
    if (channelId) {
      const o = await store.getOrder(String(channelId));
      if (o) return o;
    }
    if (body.awb) {
      const o = await store.findOrderByAwb(String(body.awb));
      if (o) return o;
    }
    if (body.sr_order_id) return store.findOrderByShiprocketOrderId(body.sr_order_id);
    return null;
  }

  // Shiprocket sends the configured token as a raw Authorization header (no scheme); x-api-key is accepted too.
  async function handleWebhook({ body, headers }) {
    const token = config.shiprocket.webhookToken;
    if (!token) {
      const e = new Error("Shipping webhook token not configured");
      e.status = 503;
      throw e;
    }
    const presented = String(headers["x-api-key"] || headers["x-webhook-token"] || headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const a = Buffer.from(String(presented));
    const b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const e = new Error("Invalid webhook token");
      e.status = 401;
      throw e;
    }
    if (!body || typeof body !== "object") return { handled: false };
    const order = await findOrderForWebhook(body);
    if (!order) return { handled: false, reason: "order_not_found" };
    if (order.shipment.awb_code && body.awb && String(body.awb) !== String(order.shipment.awb_code)) {
      return { handled: false, reason: "awb_mismatch", order_id: order.order_id };
    }
    const scans = Array.isArray(body.scans) ? body.scans.map(normaliseActivity) : [];
    const currentId = body.shipment_status_id ?? body.current_status_id ?? null;
    const currentLabel = body.shipment_status || body.current_status || "";
    if (currentId !== null || currentLabel) {
      const synthetic = normaliseActivity({ date: body.current_timestamp || body.updated_at || null, "sr-status": currentId, "sr-status-label": currentLabel, activity: body.current_status || currentLabel, location: body.location || null });
      scans.push(synthetic);
    }
    const res = await ingest(order.order_id, { events: scans.filter((e) => e.status || e.activity), etd: body.etd || null, courier_name: body.courier_name || null, source: "webhook" });
    return { handled: true, order_id: order.order_id, changed: res.changed };
  }

  async function refreshFromProvider(order) {
    if (!order.shipment.awb_code || !shiprocket.enabled) return { changed: false };
    const data = await shiprocket.trackAwb(order.shipment.awb_code);
    const td = data?.tracking_data || {};
    const activities = Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities.map(normaliseActivity) : [];
    const head = Array.isArray(td.shipment_track) ? td.shipment_track[0] : null;
    if (activities.length === 0 && td.shipment_status) {
      activities.push(normaliseActivity({ date: null, "sr-status": td.shipment_status, "sr-status-label": head?.current_status || "" }));
    }
    return ingest(order.order_id, { events: activities, etd: td.etd || head?.edd || null, track_url: td.track_url || null, courier_name: head?.courier_name || null, source: "poll" });
  }

  // Scheduled reconciliation for shipments whose webhooks may have been missed.
  async function pollActiveShipments() {
    const active = await store.listActiveShipments();
    let updated = 0;
    for (const order of active) {
      try {
        const res = await refreshFromProvider(order);
        if (res.changed) updated += 1;
      } catch (err) {
        logger.warn("[tracking] poll failed for", order.order_id, err.message);
      }
    }
    return { polled: active.length, updated };
  }

  return { ingest, handleWebhook, refreshFromProvider, pollActiveShipments, mapStatus, normaliseActivity };
}

module.exports = { createTrackingService, mapStatus, normaliseActivity, toIso, STATUS_BY_ID };
