import api from './api';
import products from '../data/products.json';

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('./firebase', () => ({ auth: { currentUser: null } }));

const prepareRequest = api.interceptors.request.use.mock.calls[0][0];
const [handleResponse, handleError] = api.interceptors.response.use.mock.calls[0];

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('admin access and reports tolerate the host waking up without changing checkout timeouts', async () => {
  for (const url of ['/auth/me', '/admin/overview', '/admin/orders', '/admin/customers']) {
    expect((await prepareRequest({ url, timeout: 30000 })).timeout).toBe(90000);
  }
  for (const url of ['/orders', '/checkout/quote', '/products', '/administrator']) {
    expect((await prepareRequest({ url, timeout: 30000 })).timeout).toBe(30000);
  }
});

test.each([
  '<!doctype html><html><body>Storefront</body></html>',
  { detail: 'Service unavailable' },
  null,
  42,
  [null],
  [{ id: 'broken', name: 'Broken', price: '100', sizes: [] }],
])('malformed catalog responses return bundled products instead of crashing pages: %p', async (data) => {
  const response = await handleResponse({ data, config: { url: '/products', method: 'get' } });
  expect(response.data).toEqual(products);
});

test('valid and empty catalog arrays retain the server response', () => {
  for (const data of [[products[0]], []]) {
    const response = { data, config: { url: '/products' } };
    expect(handleResponse(response)).toBe(response);
  }
});

test.each([
  { url: '/products', params: { category: 'women' } },
  { url: '/products?category=women' },
])('catalog fallback preserves category filtering: %p', async (config) => {
  const response = await handleResponse({ data: '<html/>', config });
  expect(response.data).toEqual(products.filter(product => product.category === 'women'));
  expect(response.data.length).toBeGreaterThan(0);
});

test('product detail falls back for malformed responses, but preserves valid server data', async () => {
  const config = { url: `/products/${products[0].id}` };
  const response = await handleResponse({ data: '<html/>', config });
  expect(response.data).toEqual(products[0]);
  const valid = { data: products[0], config };
  expect(handleResponse(valid)).toBe(valid);
});

test('unknown bundled product IDs return 404', async () => {
  await expect(handleResponse({ data: '<html/>', config: { url: '/products/not-a-real-product' } }))
    .rejects.toMatchObject({ response: { status: 404 } });
});

test('network and server failures use the bundled catalog', async () => {
  for (const response of [undefined, { status: 503 }]) {
    const result = await handleError({ config: { url: '/products' }, response });
    expect(result.data).toEqual(products);
  }
});

test('catalog client errors are preserved', async () => {
  for (const status of [401, 403, 404]) {
    const error = { config: { url: '/products' }, response: { status } };
    await expect(handleError(error)).rejects.toBe(error);
  }
});

test.each([
  { url: '/orders' },
  { url: '/checkout/quote', method: 'post' },
  { url: '/auth/me' },
  { url: '/admin/products' },
  { url: '/products', method: 'post' },
])('non-catalog requests never receive fallback catalog data: %p', async (config) => {
  const response = { data: '<html/>', config };
  expect(handleResponse(response)).toBe(response);
  const error = { config, response: { status: 503 } };
  await expect(handleError(error)).rejects.toBe(error);
});
