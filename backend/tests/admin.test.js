const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, ADMIN, USER_A } = require('./helpers');
const { overview, orderPage, directoryRecords, createAdminReports } = require('../lib/admin');
const { listDirectoryUsers } = require('../lib/auth');
const { createFirestoreStore } = require('../lib/store/firestoreStore');

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

test('refund reporting includes processed Razorpay refunds and preserves recorded legacy successes', () => {
  const result = overview([
    order('razorpay', { payment: { gateway: 'razorpay', status: 'partially_refunded', amount_paid: 500, refunds: [
      { amount: 12.34, status: 'PROCESSED' },
      { amount: 20, status: 'PENDING' },
      { amount: 30, status: 'UNKNOWN' },
      { amount: 40, status: 'FAILED' },
      { amount: 50, status: 'SUBMITTING' },
    ] } }),
    order('legacy', { payment: { status: 'partially_refunded', amount_paid: 500, refunds: [{ amount: 10, status: 'SUCCESS' }] } }),
  ], [], new Date('2026-10-21T08:00:00Z'));
  assert.equal(result.successful_refunds, 22.34);
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
    assert.equal(customers.data[0].orders, 2);
    assert.equal(customers.data[0].historical_orders, 1);
    const directory = await server.request('GET', '/api/admin/customers?page=1&search=alice', { user: ADMIN });
    assert.equal(directory.data.total, 1);
    assert.equal(directory.data.directory_available, false);
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

test('Firebase directory follows every page and never exposes credentials or claims', async () => {
  const calls = [];
  const users = await listDirectoryUsers({ async listUsers(size, token) {
    calls.push([size, token]);
    return { users: [{ uid: token || 'first', displayName: 'Account', passwordHash: 'sensitive', customClaims: { admin: true } }], pageToken: token ? undefined : 'second' };
  } });
  assert.deepEqual(calls, [[1000, undefined], [1000, 'second']]);
  assert.equal(users.length, 2);
  assert.ok(users.every(user => user.registered && !('passwordHash' in user) && !('customClaims' in user)));
});

test('directory includes zero-order accounts, historical and phone-only customers without duplicate identities', () => {
  const records = directoryRecords([
    order('storefront', { user_id: 'registered' }),
    order('historical', { user_id: null, record_kind: 'historical_wallet_deposit', created_at: null }),
    order('guest', { user_id: null, customer: { phone: '9876543210' } }),
  ], [{ id: 'registered', email: 'alice@example.com', registered: true }, { id: 'no-orders', email: 'new@example.com', registered: true }]);
  assert.equal(records.length, 3);
  assert.equal(records.find(user => user.id === 'registered').orders, 2);
  assert.equal(records.find(user => user.id === 'registered').historical_orders, 1);
  assert.equal(records.find(user => user.id === 'no-orders').orders, 0);
  assert.equal(records.find(user => user.phone === '9876543210').orders, 1);
});

test('report reads are shared, expire, refresh explicitly, invalidate after writes and recover from failure', async () => {
  let reads = 0, time = 0, fail = false;
  const store = { orderRevision: 0, async listOrderSummaries() { reads++; if (fail) throw new Error('offline'); return [order('one')]; } };
  const reports = createAdminReports({ store, auth: {}, ttlMs: 100, now: () => time });
  await Promise.all([reports.orders(), reports.orders(), reports.orders()]);
  assert.equal(reads, 1);
  await reports.orders(); assert.equal(reads, 1);
  await reports.orders(true); assert.equal(reads, 2);
  store.orderRevision++;
  await reports.orders(); assert.equal(reads, 3);
  time = 101;
  await reports.orders(); assert.equal(reads, 4);
  fail = true;
  await assert.rejects(reports.orders(true), /offline/);
  fail = false;
  await reports.orders(true); assert.equal(reads, 6);
});

test('Firestore reports project only summary fields and include every document, including null-date imports', async () => {
  let fields;
  const store = createFirestoreStore({ db: { collection: () => ({ select(...selected) {
    fields = selected;
    return { get: async () => ({ docs: Array.from({ length: 620 }, (_, index) => ({ id: `doc-${index}`, data: () => order(undefined, { created_at: null, record_kind: 'historical_wallet_deposit' }) })) }) };
  } }) } });
  const summaries = await store.listOrderSummaries();
  assert.equal(summaries.length, 620);
  assert.equal(summaries[619].order_id, 'doc-619');
  assert.ok(fields.includes('payment.status'));
  assert.ok(!fields.includes('import_metadata'));
  assert.ok(!fields.includes('payment.payment_session_id'));
});

test('admin API reaches orders beyond 500, shares report reads and lists registered users without orders', async () => {
  const server = await startTestServer();
  try {
    let reads = 0;
    server.services.store.listOrders = async ({ limit }) => {
      assert.equal(limit, Infinity);
      reads++;
      return Array.from({ length: 620 }, (_, index) => order(`id-${index}`));
    };
    server.services.auth.listUsers = async () => Array.from({ length: 40 }, (_, index) => ({ id: `account-${index}`, email: `new-${index}@example.com`, registered: true }));
    const page = await server.request('GET', '/api/admin/orders?page=25&scope=all', { user: ADMIN });
    assert.equal(page.data.total, 620);
    assert.equal(page.data.items.length, 20);
    assert.equal(page.data.items[0].order_id, 'id-600');
    await server.request('GET', '/api/admin/overview', { user: ADMIN });
    const users = await server.request('GET', '/api/admin/customers?page=2&search=new-', { user: ADMIN });
    assert.equal(users.data.total, 40);
    assert.equal(users.data.items.length, 15);
    assert.equal(users.data.directory_available, true);
    assert.ok(users.data.items.every(user => user.orders === 0));
    const legacy = await server.request('GET', '/api/admin/orders', { user: ADMIN });
    assert.equal(legacy.data.length, 620, 'older clients must also see every order');
    const limited = await server.request('GET', '/api/admin/orders?limit=10&search=id-61', { user: ADMIN });
    assert.equal(limited.data.length, 10);
    assert.ok(limited.data.every(item => item.order_id.includes('id-61')));
    assert.equal(reads, 1);
    await server.request('GET', '/api/admin/orders?page=1&refresh=1', { user: ADMIN });
    assert.equal(reads, 2);
  } finally { await server.close(); }
});
