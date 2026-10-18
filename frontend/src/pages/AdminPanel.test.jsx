import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminLayout, AdminOrdersPage, AdminCatalog } from './AdminPanel';
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

test('orders filters request server pagination and preserve storefront scope', async () => {
  api.get.mockResolvedValue({ data: { items: [], page: 1, pages: 1, total: 0 } });
  await render(<AdminOrdersPage />);
  expect(api.get).toHaveBeenLastCalledWith('/admin/orders', { params: { page: 1, page_size: 25, scope: 'storefront', search: '' } });
  await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Needs attention'));
  expect(api.get).toHaveBeenLastCalledWith('/admin/orders', { params: expect.objectContaining({ page: 1, fulfillment_status: 'needs_attention' }) });
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
