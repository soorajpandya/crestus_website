import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminOrderDetail } from './AdminOrders';
import api from '../lib/api';

jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'admin' }, loading: false, roleLoading: false, isAdmin: true }) }));
jest.mock('../lib/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() }, apiErrorMessage: error => error.message }));
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
  useParams: () => ({ order_id: 'order-1' }),
  useNavigate: () => jest.fn(),
}), { virtual: true });

const sample = extra => ({
  order_id: 'order-1', customer: { name: 'Customer' }, totals: { total: 500 },
  payment: { gateway: 'razorpay', status: 'paid', amount_paid: 500, refunds: [] },
  fulfillment: { status: 'needs_attention', last_error: { stage: 'create_order', code: 'PROVIDER_ERROR', message: '{"message":"Pickup location is unavailable"}', data: { status_code: 422, message: 'Pickup location is unavailable' } } },
  shipment: {}, tracking: { events: [] }, items: [], customer_fulfillment_status: 'preparing', ...extra,
});
let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

test('order details show readable payment and shipment status with diagnostics in a closed disclosure', async () => {
  api.get.mockResolvedValue({ data: sample() });
  await act(async () => root.render(<AdminOrderDetail />));
  expect(api.get).toHaveBeenCalledWith('/admin/orders/order-1');
  const status = container.querySelector('[aria-label="Order status"]');
  expect(status.textContent).toContain('Paid');
  expect(status.textContent).toContain('Needs attention');
  expect(container.textContent).toContain('Pickup location is unavailable');
  expect(container.textContent).not.toContain('{"message":');
  expect(container.querySelector('details').open).toBe(false);
  expect(container.querySelector('pre').closest('details')).not.toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

test('historical paid records show no delivery and disable payment and shipping actions', async () => {
  api.get.mockResolvedValue({ data: sample({ record_kind: 'historical_wallet_deposit', fulfillment: { status: 'not_applicable' }, customer_fulfillment_status: null }) });
  await act(async () => root.render(<AdminOrderDetail />));
  expect(container.querySelector('[aria-label="Order status"]').textContent).toContain('Not applicable to a wallet deposit');
  const actions = [...container.querySelectorAll('button')].filter(button => /Re-verify|Refund|Cancel shipment/.test(button.textContent));
  expect(actions).toHaveLength(3);
  expect(actions.every(button => button.disabled)).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
});

test('a failed order detail request can be retried successfully', async () => {
  api.get.mockRejectedValueOnce(new Error('Connection unavailable')).mockResolvedValueOnce({ data: sample() });
  await act(async () => root.render(<AdminOrderDetail />));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Connection unavailable');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Try again').click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[aria-label="Order status"]')).not.toBeNull();
});

test('retired gateway records retain identifiers with all payment actions disabled', async () => {
  api.get.mockResolvedValue({ data: sample({ payment: { gateway: 'cashfree', status: 'paid', amount_paid: 500, cashfree_order_id: 'original-provider-order', cf_payment_id: 'original-payment', refunds: [] } }) });
  await act(async () => root.render(<AdminOrderDetail />));
  expect(container.textContent).toContain('original-provider-order');
  expect(container.textContent).toContain('original-payment');
  expect(container.textContent).toContain('gateway has been retired');
  const actions = [...container.querySelectorAll('button')].filter(button => /Re-verify|Refund/.test(button.textContent));
  expect(actions).toHaveLength(2);
  expect(actions.every(button => button.disabled)).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
});

test('fulfillment history renders nested provider JSON as readable text', async () => {
  api.get.mockResolvedValue({ data: sample({ fulfillment: {
    status: 'needs_attention', history: [{ at: '2026-10-18T10:00:00Z', stage: 'pickup', ok: false,
      message: JSON.stringify({ errors: { pickup_location: ['Choose an active pickup location'] } }) }],
  } }) });
  await act(async () => root.render(<AdminOrderDetail />));
  expect(container.textContent).toContain('Choose an active pickup location');
  expect(container.textContent).not.toContain('{"errors":');
  expect(api.post).not.toHaveBeenCalled();
});
