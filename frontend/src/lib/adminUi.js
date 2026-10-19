export const isAdminHost = (hostname = window.location.hostname) => process.env.REACT_APP_ADMIN_MODE === 'true' || hostname.toLowerCase() === 'admin.crestuseccommerce.store';
export const adminPath = (path = '') => `${isAdminHost() ? '' : '/admin'}${path}` || '/';

export const JOB_LABEL = {
  not_started: 'Not started', queued: 'Queued for shipment', processing: 'Preparing shipment',
  retry_wait: 'Retry scheduled', needs_attention: 'Needs attention', completed: 'Shipment booked',
  cancelled: 'Cancelled', not_applicable: 'Not applicable',
};

export function readableMessage(value, fallback = 'The provider could not complete this step. Review the details before retrying.') {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try { return readableMessage(JSON.parse(value), fallback); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(item => readableMessage(item, '')).filter(Boolean).join(' · ') || fallback;
  if (typeof value === 'object') {
    for (const key of ['message', 'detail', 'error_description', 'errors', 'error']) {
      if (value[key]) return readableMessage(value[key], fallback);
    }
    return Object.entries(value).map(([key, item]) => `${key.replace(/_/g, ' ')}: ${readableMessage(item, 'Unavailable')}`).join(' · ') || fallback;
  }
  return String(value);
}

export function filterCatalog(products, search, category) {
  const query = search.trim().toLowerCase();
  return products.filter(product => (category === 'all' || product.category === category) && (!query || `${product.name} ${product.id} ${product.category} ${product.subcategory}`.toLowerCase().includes(query)));
}
