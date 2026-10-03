// Order document factory and view serialisers (customer / public tracking / admin).
const crypto = require("crypto");

const newOrderId = () => `ord_${Date.now()}${crypto.randomBytes(3).toString("hex")}`;
const now = () => new Date().toISOString();

function createOrderDocument({ orderId, userId, customer, address, items, totals, pkg, pickupLocation, shippingQuote, cartKeys }) {
  const ts = now();
  return {
    order_id: orderId || newOrderId(),
    created_at: ts,
    updated_at: ts,
    user_id: userId || null,
    customer: { name: customer.name, email: customer.email, phone: customer.phone },
    shipping_address: address,
    billing_address: address,
    billing_same_as_shipping: true,
    items,
    totals,
    package: pkg,
    pickup_location: pickupLocation,
    shipping_quote: shippingQuote,
    cart_keys: cartKeys || items.map((i) => i.key),
    payment: {
      status: "pending",
      gateway: "cashfree",
      currency: totals.currency,
      amount_due: totals.total,
      cashfree_order_id: null,
      cf_order_id: null,
      payment_session_id: null,
      attempts: [],
      cf_payment_id: null,
      payment_method: null,
      amount_paid: null,
      paid_at: null,
      confirmed_via: null,
      last_failure_reason: null,
      refunds: [],
    },
    fulfillment: { status: "not_started", stage: null, due: false, next_run_at: null, attempts: 0, last_error: null, history: [], completed_at: null },
    shipment: { sr_order_id: null, sr_shipment_id: null, courier_company_id: null, courier_name: null, awb_code: null, pickup: null, manifest_url: null, label_url: null, invoice_url: null, selected_courier_rate: null, shipping_cost_variance: null },
    tracking: { active: false, status: null, raw_status: null, raw_status_id: null, etd: null, last_event_at: null, events: [], track_url: null, delivered_at: null },
    alerts: [],
  };
}

// Customer-facing fulfillment status, derived from payment + fulfillment + tracking.
function customerFulfillmentStatus(order) {
  if (order.payment.status !== "paid" && !["refunded", "partially_refunded"].includes(order.payment.status)) return null;
  if (order.fulfillment.status === "cancelled") return "cancelled";
  if (order.tracking?.status && order.tracking.status !== "preparing") return order.tracking.status;
  if (order.shipment?.awb_code) return "pickup_scheduled";
  return "preparing";
}

const FRIENDLY = {
  preparing: "Preparing your shipment",
  pickup_scheduled: "Pickup scheduled",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_exception: "Delivery exception",
  returned: "Returned to seller",
  cancelled: "Cancelled",
};

function toCustomerView(order) {
  const fulfillmentStatus = customerFulfillmentStatus(order);
  return {
    order_id: order.order_id,
    created_at: order.created_at,
    updated_at: order.updated_at,
    customer: order.customer,
    shipping_address: order.shipping_address,
    items: order.items.map(({ unit_weight_kg, ...i }) => i),
    totals: order.totals,
    payment: {
      status: order.payment.status,
      amount_due: order.payment.amount_due,
      amount_paid: order.payment.amount_paid,
      currency: order.payment.currency,
      paid_at: order.payment.paid_at,
      payment_method: order.payment.payment_method,
      last_failure_reason: order.payment.last_failure_reason,
      refunds: (order.payment.refunds || []).map((r) => ({ refund_id: r.refund_id, amount: r.amount, status: r.status, created_at: r.created_at })),
    },
    fulfillment: {
      status: fulfillmentStatus,
      label: FRIENDLY[fulfillmentStatus] || null,
      // Only a coarse signal: internal errors are never exposed to customers.
      delayed: order.fulfillment.status === "needs_attention",
    },
    shipment: {
      courier_name: order.shipment.courier_name,
      awb_code: order.shipment.awb_code,
      track_url: order.tracking.track_url,
      etd: order.tracking.etd || order.shipping_quote?.courier?.etd || null,
      invoice_url: order.shipment.invoice_url,
      pickup_scheduled_date: order.shipment.pickup?.scheduled_date || null,
    },
    tracking: {
      status: order.tracking.status,
      events: [...(order.tracking.events || [])].sort((a, b) => (a.at < b.at ? 1 : -1)).map((e) => ({ at: e.at, status: e.status, label: e.label, activity: e.activity, location: e.location })),
      delivered_at: order.tracking.delivered_at,
    },
  };
}

// Public tracking (order id + email): no address, no payment detail.
function toPublicTrackingView(order) {
  const v = toCustomerView(order);
  return {
    order_id: v.order_id,
    created_at: v.created_at,
    payment_status: v.payment.status,
    total: v.totals.total,
    items: v.items.map((i) => ({ name: i.name, size: i.size, qty: i.qty })),
    fulfillment: v.fulfillment,
    shipment: { courier_name: v.shipment.courier_name, awb_code: v.shipment.awb_code, track_url: v.shipment.track_url, etd: v.shipment.etd },
    tracking: v.tracking,
  };
}

function toAdminView(order) {
  const { payment, ...rest } = order;
  const { payment_session_id, ...safePayment } = payment; // session id is only useful to the payer
  return { ...rest, payment: safePayment, customer_fulfillment_status: customerFulfillmentStatus(order) };
}

module.exports = { createOrderDocument, toCustomerView, toPublicTrackingView, toAdminView, customerFulfillmentStatus, newOrderId, now, FRIENDLY };
