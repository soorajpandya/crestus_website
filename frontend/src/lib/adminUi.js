export const isAdminHost = (hostname = window.location.hostname) => process.env.REACT_APP_ADMIN_MODE === 'true' || hostname.toLowerCase() === 'admin.crestuseccommerce.store';
export const adminPath = (path = '') => `${isAdminHost() ? '' : '/admin'}${path}` || '/';

export function filterCatalog(products, search, category) {
  const query = search.trim().toLowerCase();
  return products.filter(product => (category === 'all' || product.category === category) && (!query || `${product.name} ${product.id} ${product.category} ${product.subcategory}`.toLowerCase().includes(query)));
}
