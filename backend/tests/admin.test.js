const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, ADMIN, USER_A } = require('./helpers');
const { overview, orderPage } = require('../lib/admin');

const order = (id, extra = {}) => ({ order_id: id, user_id: 'customer-a', customer: { name: 'Alice', email: 'alice@example.com' }, created_at: '2026-10-18T00:00:00Z', totals: { total: 500 }, payment: { status: 'paid', amount_paid: 500 }, fulfillment: { status: 'completed' }, shipment: {}, tracking: { active: false, status: 'delivered' }, ...extra });

test('overview separates historical deposits and uses recorded paid amounts rather than order totals', () => {
  const result = overview([
    order('one', { payment: { status: 'partially_refunded', amount_paid: 400, refunds: [{ amount: 100, status: 'SUCCESS' }, { amount: 50, status: 'PENDING' }] } }),
    order('two', { created_at: '2026-10-17T18:45:00Z', payment: { status: 'pending', amount_paid: 0 }, fulfillment: { status: 'needs_attention' }, tracking: {} }),
    order('historical', { record_kind: 'historical_wallet_deposit', payment: { amount_paid: 90000 } }),
  ], [{ id: 'product' }], new Date('2026-10-18T08:00:00Z'));
  assert.equal(result.orders, 2);
  assert.equal(result.amount_paid, 400);
  assert.equal(result.successful_refunds, 100);
  assert.equal(result.historical_records, 1);
  assert.equal(result.customers, 1);
  assert.equal(result.needs_attention, 1);
  assert.equal(result.pending_payments, 1);
  assert.equal(result.daily_orders.at(-1).orders, 2, 'India midnight boundary');
});

test('order pagination reaches beyond 500 rows and clamps invalid page inputs', () => {
  const orders = Array.from({ length: 620 }, (_, index) => order(`id-${index}`));
  const page = orderPage(orders, { page: 25, page_size: 25 });
  assert.equal(page.total, 620);
  assert.equal(page.items.length, 20);
  assert.equal(page.items[0].order_id, 'id-600');
  assert.equal(orderPage(orders, { page: -1, page_size: -5 }).page_size, 1);
  assert.equal(orderPage(orders, { page: 999 }).page, 25);
});

test('admin reports, search, scopes and configuration require admin access', async () => {
  const server = await startTestServer();
  try {
    await server.services.store.putOrder(order('store-order'));
    await server.services.store.putOrder(order('wallet-record', { record_kind: 'historical_wallet_deposit' }));
    for (const endpoint of ['/overview', '/customers', '/catalog', '/settings', '/orders?page=1']) {
      assert.equal((await server.request('GET', `/api/admin${endpoint}`)).status, 401);
      assert.equal((await server.request('GET', `/api/admin${endpoint}`, { user: USER_A })).status, 403);
      assert.equal((await server.request('GET', `/api/admin${endpoint}`, { user: ADMIN })).status, 200);
    }
    const page = await server.request('GET', '/api/admin/orders?page=1&scope=historical&search=WALLET', { user: ADMIN });
    assert.equal(page.data.total, 1);
    assert.equal(page.data.items[0].order_id, 'wallet-record');
    const customers = await server.request('GET', '/api/admin/customers', { user: ADMIN });
    assert.equal(customers.data[0].orders, 1);
    const settings = await server.request('GET', '/api/admin/settings', { user: ADMIN });
    assert.equal(settings.data.admin_url, 'https://admin.crestuseccommerce.store');
    assert.ok(!JSON.stringify(settings.data).includes('test-webhook-secret'));
    assert.equal(settings.data.secretKey, undefined);
    const cors = await fetch(`${server.base}/api/admin/overview`, { method: 'OPTIONS', headers: { Origin: 'https://admin.crestuseccommerce.store', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(cors.headers.get('access-control-allow-origin'), 'https://admin.crestuseccommerce.store');
    const legacy = await server.request('GET', '/api/admin/orders', { user: ADMIN });
    assert.ok(Array.isArray(legacy.data), 'legacy response stays compatible');
  } finally { await server.close(); }
});
