const { isHistoricalImport } = require('./historicalImport');

const money = (value) => Math.round(value * 100) / 100;
const amount = (order) => Number(order.payment?.amount_paid) || 0;
const refunded = (order) => (order.payment?.refunds || []).filter(r => r.status === 'SUCCESS').reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

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
  });
  const pageSize = Math.max(1, Math.min(Math.floor(Number(query.page_size)) || 25, 100));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.max(1, Math.min(Math.floor(Number(query.page)) || 1, pages));
  return { items: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, page_size: pageSize, pages };
}

module.exports = { overview, customerRecords, orderPage };
