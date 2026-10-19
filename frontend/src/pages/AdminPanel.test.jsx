import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminLayout, AdminOrdersPage, AdminCatalog, AdminCustomers } from './AdminPanel';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { isAdminHost } from '../lib/adminUi';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../lib/api', () => ({ __esModule: true, default: { get: jest.fn() }, apiErrorMessage: error => error.message }));
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
  NavLink: ({ to, children }) => <a href={to}>{children}</a>,
  Navigate: ({ to }) => <div data-redirect={to} />,
  Outlet: () => <div data-testid="protected-content" />,
  useLocation: () => ({ pathname: '/admin/orders', search: '' }),
}), { virtual: true });

let container, root, identity;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  identity = { user: { email: 'admin@crestuseccommerce.store', emailVerified: true }, isAdmin: true, loading: false, roleLoading: false };
  useAuth.mockImplementation(() => identity);
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async element => act(async () => root.render(element));
const click = async element => act(async () => element.click());

test('admin host matching is exact', () => {
  expect(isAdminHost('admin.crestuseccommerce.store')).toBe(true);
  expect(isAdminHost('crestuseccommerce.store')).toBe(false);
  expect(isAdminHost('admin.crestuseccommerce.store.example.com')).toBe(false);
});

test('admin role check completes before protected content is rendered', async () => {
  identity.roleLoading = true;
  await render(<AdminLayout />);
  expect(container.textContent).toContain('Checking administrator access');
  expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
  identity.roleLoading = false;
  await render(<AdminLayout />);
  expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();
});

test('signed out user is redirected and a customer is denied access', async () => {
  identity.user = null;
  await render(<AdminLayout />);
  expect(container.querySelector('[data-redirect]').getAttribute('data-redirect')).toBe('/login?redirect=%2Fadmin%2Forders');
  identity.user = { email: 'customer@example.com' }; identity.isAdmin = false;
  await render(<AdminLayout />);
  expect(container.textContent).toContain('Administrator access required');
  expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
});

test('orders default to all records and filters request server pagination', async () => {
  api.get.mockResolvedValue({ data: { items: [], page: 1, pages: 1, total: 0 } });
  await render(<AdminOrdersPage />);
  expect(api.get).toHaveBeenLastCalledWith('/admin/orders', { params: { page: 1, page_size: 25, scope: 'all', search: '' } });
  await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Needs attention'));
  expect(api.get).toHaveBeenLastCalledWith('/admin/orders', { params: expect.objectContaining({ page: 1, fulfillment_status: 'needs_attention' }) });
});

test('orders can reach later pages and manual refresh bypasses the report cache', async () => {
  api.get.mockResolvedValue({ data: { items: [], page: 1, pages: 141, total: 3508 } });
  await render(<AdminOrdersPage />);
  api.get.mockResolvedValue({ data: { items: [], page: 2, pages: 141, total: 3508 } });
  await click([...container.querySelectorAll('button')].find(button => button.textContent.includes('Next')));
  expect(api.get).toHaveBeenLastCalledWith('/admin/orders', { params: expect.objectContaining({ page: 2, scope: 'all' }) });
  await click([...container.querySelectorAll('button')].find(button => button.textContent.includes('Refresh')));
  expect(api.get).toHaveBeenLastCalledWith('/admin/orders', { params: expect.objectContaining({ page: 2, refresh: 1 }) });
  await click([...container.querySelectorAll('button')].find(button => button.textContent.includes('Previous')));
  expect(api.get.mock.calls.at(-1)[1].params.refresh).toBeUndefined();
});

test('user directory renders registered accounts with no orders and paginates on the server', async () => {
  api.get.mockResolvedValue({ data: { items: [{ id: 'new-user', name: 'New account', registered: true, orders: 0, storefront_orders: 0, historical_orders: 0, amount_paid: 0 }], page: 1, pages: 2, total: 26, directory_available: true } });
  await render(<AdminCustomers />);
  expect(api.get).toHaveBeenLastCalledWith('/admin/customers', { params: { page: 1, page_size: 25, search: '' } });
  expect(container.textContent).toContain('New account');
  expect(container.textContent).toContain('Registered');
  expect(container.textContent).toContain('26 users & customers');
  await click([...container.querySelectorAll('button')].find(button => button.textContent.includes('Next')));
  expect(api.get).toHaveBeenLastCalledWith('/admin/customers', { params: { page: 2, page_size: 25, search: '' } });
});

test('failed requests show a retry action and never render a misleading empty state', async () => {
  api.get.mockRejectedValue(new Error('Connection unavailable'));
  await render(<AdminOrdersPage />);
  expect(container.querySelector('[role="alert"]').textContent).toContain('Connection unavailable');
  expect(container.textContent).not.toContain('No orders found');
  api.get.mockResolvedValue({ data: { items: [], page: 1, pages: 1, total: 0 } });
  await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Try again'));
  expect(container.textContent).toContain('No orders found');
});

test('catalog uses protected API rather than the storefront offline fallback', async () => {
  api.get.mockRejectedValue(new Error('Catalog unavailable'));
  await render(<AdminCatalog />);
  expect(api.get).toHaveBeenCalledWith('/admin/catalog', { params: {} });
  expect(container.querySelector('[role="alert"]').textContent).toContain('Catalog unavailable');
});
