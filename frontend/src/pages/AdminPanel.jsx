import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Boxes, ChevronLeft, ChevronRight, CircleHelp, Download, ExternalLink, LayoutDashboard, LogOut, Mail, Menu, Package, RefreshCw, Search, Settings, ShieldCheck, ShoppingBag, Truck, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api, { apiErrorMessage } from '../lib/api';
import { adminPath, filterCatalog } from '../lib/adminUi';
import { fmtDate, inr } from '../lib/orderUi';
import { PaymentBadge, FulfillmentBadge } from '../components/OrderBits';
import { toast } from 'sonner';
import './AdminPanel.css';

const STOREFRONT = 'https://crestuseccommerce.store';
const navigation = [
  ['', 'Overview', LayoutDashboard],
  ['/orders', 'Orders', ShoppingBag],
  ['/catalog', 'Catalog', Boxes],
  ['/customers', 'Users & customers', Users],
  ['/subscribers', 'Subscribers', Mail],
  ['/settings', 'Settings', Settings],
];

function StartupHint({ loading }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!loading) return undefined;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);
  return loading && slow ? <p role="status">The server is taking longer to respond. It may be waking up after inactivity; this can take about a minute.</p> : null;
}

export function useAdminResource(url, params = {}) {
  const [result, setResult] = useState({ data: null, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  const lastRevision = useRef(0);
  const query = JSON.stringify(params);
  useEffect(() => {
    let active = true;
    setResult({ data: null, error: '', loading: true });
    const params = JSON.parse(query);
    if (revision !== lastRevision.current) params.refresh = 1;
    lastRevision.current = revision;
    api.get(url, { params }).then(({ data }) => {
      if (active) setResult({ data, error: '', loading: false });
    }).catch(error => {
      if (active) setResult({ data: null, error: apiErrorMessage(error), loading: false });
    });
    return () => { active = false; };
  }, [url, query, revision]);
  return { ...result, refresh: () => setRevision(value => value + 1) };
}

export function AdminLayout() {
  const { user, loading, isAdmin, roleLoading, roleError, logout, refreshUser, sendVerification } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const oldTitle = document.title;
    document.title = 'Crestus Admin';
    return () => { document.title = oldTitle; };
  }, []);
  if (loading || roleLoading) return <div className="admin-gate"><ShieldCheck size={32} /><p>Checking administrator access…</p><StartupHint loading /></div>;
  if (!user) return <Navigate to={`/login?${new URLSearchParams({ redirect: location.pathname + location.search })}`} replace />;
  if (!isAdmin) return <div className="admin-gate"><ShieldCheck size={36} /><h1>{roleError ? 'Unable to check access' : 'Administrator access required'}</h1><p>{roleError ? 'The server could not verify your administrator role. Try again when the connection is available.' : `Signed in as ${user.email}. Use an authorized administrator account with a verified email.`}</p>{!user.emailVerified && <button className="admin-button" onClick={() => sendVerification().then(() => toast.success('Verification email requested. Check your inbox.')).catch(error => toast.error(apiErrorMessage(error)))}>Send verification email</button>}<button className="admin-button" onClick={() => refreshUser().catch(error => toast.error(apiErrorMessage(error)))}>Check access again</button><button className="admin-button secondary" onClick={logout}>Sign out</button></div>;
  const active = navigation.find(([path]) => path && location.pathname.startsWith(adminPath(path))) || navigation[0];
  return <div className="admin-app">
    {open && <button className="admin-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`admin-sidebar ${open ? 'is-open' : ''}`}>
      <Link to={adminPath()} className="admin-brand">CRESTUS<span>.</span><small>STORE ADMIN</small></Link>
      <button className="admin-mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={20} /></button>
      <p className="admin-nav-label">WORKSPACE</p>
      <nav aria-label="Admin navigation">{navigation.map(([path, label, Icon]) => <NavLink key={label} to={adminPath(path)} end={!path} className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}><Icon size={19} />{label}{label === 'Overview' && <span className="admin-nav-dot" />}</NavLink>)}</nav>
      <div className="admin-sidebar-bottom"><div className="admin-store-card"><div className="admin-store-icon"><ShoppingBag size={20} /></div><strong>Your storefront</strong><p>See what your customers see.</p><a href={STOREFRONT} target="_blank" rel="noreferrer">Visit store <ArrowUpRight size={15} /></a></div><div className="admin-account"><span className="admin-avatar">{(user.name || user.email || 'A').slice(0, 1).toUpperCase()}</span><div><strong>Administrator</strong><small title={user.email}>{user.email}</small></div><button aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={17} /></button></div></div>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar"><div><button className="admin-mobile-toggle" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={21} /></button><span className="admin-breadcrumb">Workspace <span>/</span> <strong>{active[1]}</strong></span></div><div className="admin-topbar-right"><span className="admin-secure"><ShieldCheck size={14} /> Secure workspace</span><a href={STOREFRONT} target="_blank" rel="noreferrer">View store <ExternalLink size={14} /></a></div></header><main className="admin-main"><Suspense fallback={<div className="admin-loading" role="status">Loading page…</div>}><Outlet /></Suspense></main><footer className="admin-footer"><span>© {new Date().getFullYear()} Crestus</span><span><ShieldCheck size={13} /> Administrator access only</span></footer></div>
  </div>;
}

export function AdminHeading({ eyebrow = 'STORE MANAGEMENT', title, description, children }) {
  return <div className="admin-heading"><div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="admin-heading-actions">{children}</div></div>;
}

function RefreshButton({ resource }) { return <button className="admin-button secondary" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={15} className={resource.loading ? 'animate-spin' : ''} /> Refresh</button>; }
function ResourceState({ resource }) {
  if (resource.error) return <div role="alert" className="admin-error"><strong>Couldn't load this information</strong><p>{resource.error}</p><button className="admin-button secondary" onClick={resource.refresh}>Try again</button></div>;
  if (resource.loading) return <div role="status" className="admin-loading"><RefreshCw className="animate-spin" size={19} /> Loading store data…<StartupHint loading /></div>;
  return null;
}

export function AdminOverview() {
  const resource = useAdminResource('/admin/overview');
  const recent = useAdminResource('/admin/orders', { page: 1, page_size: 5, scope: 'storefront' });
  const data = resource.data;
  return <><AdminHeading eyebrow="YOUR STORE AT A GLANCE" title="Store overview" description="A clear view of your orders, customers, and fulfillment."><RefreshButton resource={{ ...resource, loading: resource.loading || recent.loading, refresh: () => { resource.refresh(); recent.refresh(); } }} /></AdminHeading><ResourceState resource={resource} />{data && <>
    <div className="admin-stats">{[[ShoppingBag, 'Storefront orders', data.orders.toLocaleString('en-IN'), 'All storefront orders', 'purple'], [ArrowDownLeft, 'Payments collected', inr(data.amount_paid), 'Recorded amount paid · before refunds', 'green'], [Users, 'Ordering customers', data.customers.toLocaleString('en-IN'), 'Customers with storefront orders', 'blue'], [Truck, 'Active shipments', data.active_shipments.toLocaleString('en-IN'), `${data.delivered} delivered orders`, 'orange']].map(([Icon, label, value, detail, color]) => <article className="admin-stat" key={label}><div className="admin-stat-top"><span>{label}</span><span className={`admin-stat-icon ${color}`}><Icon size={18} /></span></div><strong>{value}</strong><p>{detail}</p></article>)}</div>
    <div className="admin-overview-grid"><section className="admin-card"><div className="admin-card-heading"><div><h2>Order activity</h2><p>Storefront orders created in the last 7 days</p></div><span className="admin-tag">IST</span></div><div className="admin-chart" role="img" aria-label={data.daily_orders.map(day => `${day.date}: ${day.orders} orders`).join(', ')}>{data.daily_orders.map(day => <div className="admin-chart-column" key={day.date}><span>{day.orders}</span><div className="admin-chart-track"><div style={{ height: `${day.orders ? Math.max(4, day.orders / Math.max(1, ...data.daily_orders.map(d => d.orders)) * 100) : 0}%` }} /></div><small>{new Date(`${day.date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}</small></div>)}</div></section><section className="admin-card"><div className="admin-card-heading"><div><h2>Store pulse</h2><p>What needs your attention</p></div><span className="admin-pulse-dot" /></div><div className="admin-pulse-list">{[['Needs attention', data.needs_attention, '/orders?filter=attention', 'orange'], ['Pending payments', data.pending_payments, '/orders?filter=pending', 'purple'], ['Catalog products', data.products, '/catalog', 'blue'], ['Newsletter subscribers', data.subscribers ?? 0, '/subscribers', 'green']].map(([label, count, path, color]) => <Link key={label} to={adminPath(path)}><span className={`admin-pulse-icon ${color}`}><Package size={18} /></span><span>{label}</span><strong>{count}</strong><ArrowUpRight size={16} /></Link>)}</div><div className="admin-note"><CircleHelp size={16} /><p>{data.historical_records.toLocaleString('en-IN')} historical records are excluded from storefront metrics. View them using the orders scope filter.</p></div></section></div>
    <section className="admin-card"><div className="admin-card-heading"><div><h2>Recent orders</h2><p>The latest activity from your storefront</p></div><Link className="admin-text-link" to={adminPath('/orders')}>View all orders <ArrowUpRight size={15} /></Link></div><ResourceState resource={recent} />{recent.data && <AdminOrderTable orders={recent.data.items} />}</section><p className="admin-updated">Updated {fmtDate(data.generated_at)} · All-time totals from the order store. Successful refunds recorded: {inr(data.successful_refunds)}.</p>
  </>}</>;
}

export function AdminOrderTable({ orders }) {
  if (!orders.length) return <div className="admin-empty"><ShoppingBag size={28} /><h3>No orders found</h3><p>Orders will appear here when customers check out.</p></div>;
  return <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th className="admin-align-right">Amount</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{orders.map(order => <tr key={order.order_id}><td><Link className="admin-order-id" to={adminPath(`/orders/${encodeURIComponent(order.order_id)}`)}>{order.order_id}</Link><small>{fmtDate(order.created_at) || 'Creation time unknown'}</small>{order.record_kind === 'historical_wallet_deposit' && <small>Historical wallet deposit</small>}</td><td><strong>{order.customer?.name || 'Name unavailable'}</strong><small>{order.customer?.email || 'Email unavailable'}</small></td><td><PaymentBadge status={order.payment?.status} /></td><td>{order.record_kind === 'historical_wallet_deposit' ? <span className="admin-tag">Not applicable</span> : <><FulfillmentBadge status={order.customer_fulfillment_status} />{order.fulfillment?.status === 'needs_attention' && <small className="admin-warning">Needs attention</small>}</>}</td><td className="admin-align-right"><strong>{inr(order.totals?.total)}</strong></td><td><Link aria-label={`View order ${order.order_id}`} to={adminPath(`/orders/${encodeURIComponent(order.order_id)}`)}><ArrowUpRight size={17} /></Link></td></tr>)}</tbody></table></div>;
}

export function AdminOrdersPage() {
  const location = useLocation();
  const initialFilter = new URLSearchParams(location.search).get('filter') || 'all';
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(1);
  const resource = useAdminResource('/admin/orders', { page, page_size: 25, scope, search: query, ...(filter === 'attention' ? { fulfillment_status: 'needs_attention' } : filter !== 'all' ? { payment_status: filter } : {}) });
  const changeFilter = value => { setFilter(value); setPage(1); };
  return <><AdminHeading title="Orders" description="Manage payments, shipments, and every order in between."><RefreshButton resource={resource} /></AdminHeading><section className="admin-card"><div className="admin-toolbar"><div className="admin-tabs">{[['all', 'All orders'], ['paid', 'Paid'], ['pending', 'Pending'], ['attention', 'Needs attention']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => changeFilter(key)}>{label}</button>)}</div></div><div className="admin-filters"><form className="admin-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}><Search size={17} /><input aria-label="Search orders" placeholder="Search order ID, customer, email, AWB…" value={search} onChange={event => setSearch(event.target.value)} /><button type="submit">Search</button></form><select aria-label="Order record scope" value={scope} onChange={event => { setScope(event.target.value); setPage(1); }}><option value="storefront">Storefront orders</option><option value="historical">Historical records</option><option value="all">All records</option></select></div><ResourceState resource={resource} />{resource.data && <><AdminOrderTable orders={resource.data.items} /><div className="admin-pagination"><span>{resource.data.total.toLocaleString('en-IN')} records · Page {resource.data.page} of {resource.data.pages}</span><div><button className="admin-button secondary" disabled={resource.data.page <= 1} onClick={() => setPage(resource.data.page - 1)}><ChevronLeft size={15} /> Previous</button><button className="admin-button secondary" disabled={resource.data.page >= resource.data.pages} onClick={() => setPage(resource.data.page + 1)}>Next <ChevronRight size={15} /></button></div></div></>}</section></>;
}

export function AdminCatalog() {
  const resource = useAdminResource('/admin/catalog');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const products = filterCatalog(resource.data || [], search, category);
  return <><AdminHeading title="Product catalog" description="Browse the current server catalog, prices, and product variants."><RefreshButton resource={resource} /></AdminHeading><section className="admin-card"><div className="admin-filters"><label className="admin-search"><Search size={17} /><input aria-label="Search products" placeholder="Search products…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Product category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{[...new Set((resource.data || []).map(product => product.category))].map(value => <option key={value} value={value}>{value}</option>)}</select></div><ResourceState resource={resource} />{resource.data && <><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Sizes</th><th className="admin-align-right">MRP</th><th className="admin-align-right">Selling price</th><th>Store</th></tr></thead><tbody>{products.map(product => <tr key={product.id}><td><div className="admin-product"><img src={product.image} alt="" loading="lazy" /><div><strong>{product.name}</strong><small>{product.id}</small></div></div></td><td className="capitalize">{product.category}<small>{product.subcategory}</small></td><td>{product.sizes?.join(', ') || '—'}</td><td className="admin-align-right">{inr(product.mrp)}</td><td className="admin-align-right"><strong>{inr(product.price)}</strong></td><td><a aria-label={`View ${product.name} in store`} href={`${STOREFRONT}/product/${encodeURIComponent(product.id)}`} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a></td></tr>)}</tbody></table></div>{!products.length && <div className="admin-empty">No products match your search.</div>}<div className="admin-pagination"><span>{products.length} products</span><span>Catalog changes are managed through the website source.</span></div></>}</section></>;
}

export function AdminCustomers() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const resource = useAdminResource('/admin/customers', { page, page_size: 25, search: query });
  const data = resource.data;
  return <>
    <AdminHeading title="Users & customers" description="All registered users and customers, including historical records and accounts with no orders."><RefreshButton resource={resource} /></AdminHeading>
    <section className="admin-card">
      <div className="admin-filters"><form className="admin-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}><Search size={17} /><input aria-label="Search customers" placeholder="Search name, email, phone, or user ID…" value={search} onChange={event => setSearch(event.target.value)} /><button type="submit">Search</button></form></div>
      <ResourceState resource={resource} />
      {data && <>
        {data.directory_available === false && <div className="admin-note" role="status"><CircleHelp size={16} /><p>The registered user directory is not configured on this server. Showing customers from orders only.</p></div>}
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>User / customer</th><th>Account</th><th>Phone</th><th>Orders</th><th className="admin-align-right">Amount paid</th><th>Latest order</th></tr></thead>
          <tbody>{data.items.map(customer => <tr key={customer.id}>
            <td><strong>{customer.name || 'Name unavailable'}</strong><small>{customer.email || 'Email unavailable'}</small></td>
            <td><span className="admin-tag">{customer.registered ? customer.disabled ? 'Disabled' : 'Registered' : 'Order customer'}</span></td>
            <td>{customer.phone || '—'}</td><td>{customer.orders}<small>{customer.storefront_orders} storefront · {customer.historical_orders} historical</small></td>
            <td className="admin-align-right"><strong>{inr(customer.amount_paid)}</strong></td><td>{fmtDate(customer.last_order_at) || 'No dated orders'}</td>
          </tr>)}</tbody></table></div>
        {!data.items.length && <div className="admin-empty"><Users size={28} /><h3>No users or customers found</h3><p>Try another name, email, phone, or user ID.</p></div>}
        <div className="admin-pagination"><span>{data.total.toLocaleString('en-IN')} users & customers · Page {data.page} of {data.pages}</span><div>
          <button className="admin-button secondary" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft size={15} /> Previous</button>
          <button className="admin-button secondary" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next <ChevronRight size={15} /></button>
        </div></div>
      </>}
    </section>
  </>;
}

export function AdminSubscribers() {
  const [search, setSearch] = useState('');
  const resource = useAdminResource('/admin/subscribers', { search });
  const list = Array.isArray(resource.data) ? resource.data : [];

  const filtered = list.filter((item) => {
    if (!search) return true;
    return (item.email || '').toLowerCase().includes(search.toLowerCase()) || (item.id || '').toLowerCase().includes(search.toLowerCase());
  });

  const exportCSV = () => {
    if (!filtered.length) {
      toast.error('No subscribers to export.');
      return;
    }
    const headers = 'ID,Email,Created At,Source,Status\n';
    const rows = filtered
      .map((s) => `"${s.id || ''}","${s.email || ''}","${s.created_at || ''}","${s.source || ''}","${s.status || ''}"`)
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `newsletter_subscribers_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Subscriber list exported as CSV.');
  };

  return (
    <>
      <AdminHeading
        title="Newsletter Subscribers"
        description="Audience subscribed to your marketing newsletter, private drops, and updates."
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="admin-button secondary" onClick={exportCSV} disabled={!filtered.length}>
            <Download size={15} /> Export CSV
          </button>
          <RefreshButton resource={resource} />
        </div>
      </AdminHeading>

      <section className="admin-card">
        <div className="admin-filters">
          <div className="admin-search">
            <Search size={17} />
            <input
              aria-label="Search subscribers"
              placeholder="Search subscriber by email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <ResourceState resource={resource} />

        {resource.data && (
          <>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Subscriber Email</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th className="admin-align-right">Subscribed Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sub) => (
                    <tr key={sub.id || sub.email}>
                      <td>
                        <strong>{sub.email}</strong>
                        <small>{sub.id}</small>
                      </td>
                      <td>
                        <span className="admin-tag">{sub.source || 'homepage_newsletter'}</span>
                      </td>
                      <td>
                        <span className="admin-tag" style={{ color: '#059669', borderColor: '#a7f3d0' }}>
                          ● {sub.status || 'active'}
                        </span>
                      </td>
                      <td className="admin-align-right">
                        {fmtDate(sub.created_at) || 'Unknown'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!filtered.length && (
              <div className="admin-empty">
                <Mail size={28} />
                <h3>No subscribers found</h3>
                <p>New subscribers from the homepage newsletter will automatically appear here.</p>
              </div>
            )}

            <div className="admin-pagination">
              <span>{filtered.length.toLocaleString('en-IN')} total subscribers</span>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export function AdminSettings() {
  const resource = useAdminResource('/admin/settings');
  const { user } = useAuth();
  const data = resource.data;
  return <><AdminHeading title="Workspace settings" description="Your connected storefront and service configuration."><RefreshButton resource={resource} /></AdminHeading><ResourceState resource={resource} />{data && <div className="admin-settings-grid"><section className="admin-card"><div className="admin-card-heading"><div><h2>Store details</h2><p>Your Crestus workspace</p></div><ShoppingBag size={20} /></div><dl className="admin-details">{[['Storefront', data.storefront_url], ['Admin URL', data.admin_url], ['Signed in as', user.email], ['Role', 'Administrator']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><section className="admin-card"><div className="admin-card-heading"><div><h2>Connected services</h2><p>Server configuration · connectivity not tested</p></div><ShieldCheck size={20} /></div><dl className="admin-details">{[['Firebase authentication', data.authentication], ['Order storage', data.order_store], ['Payment gateway', data.payment_gateway || 'razorpay'], ['Payments', data.payments], ['Shiprocket shipping', data.shipping]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><span className="admin-tag">{value.replaceAll('_', ' ')}</span></dd></div>)}</dl></section><div className="admin-note"><ShieldCheck size={19} /><p>Administrator access is verified by the server. Credentials and access settings are managed in the backend environment and Firebase. No secret keys are displayed here.</p></div></div>}</>;
}

export function AdminNotFound() { return <div className="admin-empty"><h1>Page not found</h1><Link className="admin-button" to={adminPath()}>Back to overview</Link></div>; }
