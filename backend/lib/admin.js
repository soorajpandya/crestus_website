const { isHistoricalImport } = require('./historicalImport');

const money = (value) => Math.round(value * 100) / 100;
const amount = (order) => Number(order.payment?.amount_paid) || 0;
const refunded = (order) => (order.payment?.refunds || []).filter(r => r.status === 'SUCCESS').reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

// A small projection keeps import provenance, payment attempts and provider responses out of reports.
const ORDER_SUMMARY_FIELDS = ['order_id', 'user_id', 'customer', 'created_at', 'imported_at', 'record_kind',
  'import_metadata.side_effects_disabled', 'totals.total', 'payment.status', 'payment.amount_paid',
  'payment.refunds', 'payment.cashfree_order_id', 'payment.observed_success_transaction_time',
  'fulfillment.status', 'tracking.active', 'tracking.status', 'shipment.awb_code'];

function orderTime(order) {
  return order.created_at || order.payment?.observed_success_transaction_time || order.imported_at || '';
}

function directoryRecords(orders, users = []) {
  const records = new Map();
  const emails = new Map();
  const phones = new Map();
  const phoneKey = value => String(value || '').replace(/\D/g, '');
  for (const user of users || []) {
    records.set(user.id, { ...user, orders: 0, storefront_orders: 0, historical_orders: 0, amount_paid: 0, last_order_at: null });
    if (user.email) emails.set(user.email.toLowerCase(), user.id);
    if (user.phone) phones.set(phoneKey(user.phone), user.id);
  }
  for (const order of orders) {
    const email = (order.customer?.email || '').toLowerCase();
    const phone = phoneKey(order.customer?.phone);
    const key = (records.has(order.user_id) && order.user_id) || emails.get(email) ||
      (!email && !order.user_id && phones.get(phone)) || order.user_id || (email && `email:${email}`) || (phone && `phone:${phone}`);
    if (!key) continue;
    const customer = records.get(key) || { id: key, registered: false, name: '', email: '', phone: '', orders: 0, storefront_orders: 0, historical_orders: 0, amount_paid: 0, last_order_at: null };
    customer.name ||= order.customer?.name || '';
    customer.email ||= order.customer?.email || '';
    customer.phone ||= order.customer?.phone || '';
    customer.orders++;
    customer[isHistoricalImport(order) ? 'historical_orders' : 'storefront_orders']++;
    customer.amount_paid = money(customer.amount_paid + amount(order));
    const time = orderTime(order);
    if (time && (!customer.last_order_at || time > customer.last_order_at)) customer.last_order_at = time;
    records.set(key, customer);
    if (email) emails.set(email, key);
    if (phone) phones.set(phone, key);
  }
  return [...records.values()].sort((a, b) => (b.last_order_at || b.created_at || '').localeCompare(a.last_order_at || a.created_at || '') || a.id.localeCompare(b.id));
}

function paginate(items, query) {
  const pageSize = Math.max(1, Math.min(Math.floor(Number(query.page_size)) || 25, 100));
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(1, Math.min(Math.floor(Number(query.page)) || 1, pages));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize, pages };
}

// Concurrent reports share one read; manual Refresh bypasses the short cache.
function createAdminReports({ store, auth, ttlMs = 15000, now = Date.now }) {
  const cached = loader => {
    let value, expires = 0, pending, revision;
    return async (refresh = false) => {
      if (pending) return pending;
      if (!refresh && value !== undefined && expires > now() && revision === store.orderRevision) return value;
      const readRevision = store.orderRevision;
      pending = Promise.resolve().then(loader).then(result => {
        value = result; expires = now() + ttlMs; revision = readRevision;
        return result;
      }).finally(() => { pending = null; });
      return pending;
    };
  };
  return {
    orders: cached(() => store.listOrderSummaries ? store.listOrderSummaries() : store.listOrders({ limit: Infinity })),
    users: cached(() => auth.listUsers ? auth.listUsers() : null),
  };
}

function customerRecords(orders) {
  const customers = new Map();
  for (const order of orders.filter(o => !isHistoricalImport(o))) {
    const key = order.user_id || order.customer?.email?.toLowerCase();
    if (!key) continue;
    const customer = customers.get(key) || { id: key, name: order.customer?.name || '', email: order.customer?.email || '', phone: order.customer?.phone || '', orders: 0, amount_paid: 0, last_order_at: null };
    customer.orders++;
    customer.amount_paid = money(customer.amount_paid + amount(order));
    if (order.created_at && (!customer.last_order_at || order.created_at > customer.last_order_at)) customer.last_order_at = order.created_at;
    customers.set(key, customer);
  }
  return [...customers.values()].sort((a, b) => (b.last_order_at || '').localeCompare(a.last_order_at || ''));
}

function overview(orders, products, now = new Date()) {
  const storefront = orders.filter(o => !isHistoricalImport(o));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - (6 - index) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return { date, orders: 0 };
  });
  for (const order of storefront) {
    const time = Date.parse(order.created_at);
    if (!Number.isFinite(time)) continue;
    const day = days.find(d => d.date === new Date(time).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
    if (day) day.orders++;
  }
  return {
    generated_at: now.toISOString(),
    orders: storefront.length,
    amount_paid: money(storefront.reduce((sum, o) => sum + amount(o), 0)),
    successful_refunds: money(storefront.reduce((sum, o) => sum + refunded(o), 0)),
    pending_payments: storefront.filter(o => o.payment?.status === 'pending').length,
    needs_attention: storefront.filter(o => o.fulfillment?.status === 'needs_attention').length,
    active_shipments: storefront.filter(o => o.tracking?.active === true).length,
    delivered: storefront.filter(o => o.tracking?.status === 'delivered').length,
    customers: customerRecords(storefront).length,
    products: products.length,
    historical_records: orders.length - storefront.length,
    daily_orders: days,
  };
}

function orderPage(orders, query) {
  const search = String(query.search || '').trim().toLowerCase();
  const matches = orders.filter(o => {
    if (query.scope === 'storefront' && isHistoricalImport(o)) return false;
    if (query.scope === 'historical' && !isHistoricalImport(o)) return false;
    if (query.payment_status && o.payment?.status !== query.payment_status) return false;
    if (query.fulfillment_status && o.fulfillment?.status !== query.fulfillment_status) return false;
    return !search || [o.order_id, o.customer?.name, o.customer?.email, o.customer?.phone, o.shipment?.awb_code, o.payment?.cashfree_order_id].some(value => String(value || '').toLowerCase().includes(search));
  }).sort((a, b) => orderTime(b).localeCompare(orderTime(a)));
  return paginate(matches, query);
}

module.exports = { overview, customerRecords, orderPage, directoryRecords, paginate, createAdminReports, ORDER_SUMMARY_FIELDS };
