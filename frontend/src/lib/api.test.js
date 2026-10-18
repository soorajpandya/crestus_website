import api from './api';

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('./firebase', () => ({ auth: { currentUser: null } }));

const prepareRequest = api.interceptors.request.use.mock.calls[0][0];

test('admin access and reports tolerate the host waking up without changing checkout timeouts', async () => {
  for (const url of ['/auth/me', '/admin/overview', '/admin/orders', '/admin/customers']) {
    expect((await prepareRequest({ url, timeout: 30000 })).timeout).toBe(90000);
  }
  for (const url of ['/orders', '/checkout/quote', '/products', '/administrator']) {
    expect((await prepareRequest({ url, timeout: 30000 })).timeout).toBe(30000);
  }
});
