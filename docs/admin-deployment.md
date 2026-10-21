# Crestus admin deployment

Target: `https://admin.crestuseccommerce.store`

## Backend

Deploy the Node backend with the new `lib/admin.js`, reporting routes in `app.js`, the admin CORS origin in `lib/config.js`, and the existing verified-email authorization in `lib/auth.js`. Preserve all existing payment, shipping and Firebase secrets. Set `ADMIN_EMAILS=admin@crestuseccommerce.store` (retain any other explicitly authorized administrators). The account must exist in Firebase project `crestus-6f962` and have a verified email, or an explicit server-managed `admin=true` custom claim.

The new `/api/admin/overview`, `/customers`, `/catalog`, `/settings` and paginated `/orders?page=1` APIs require an administrator token. Reporting performs no financial or shipping writes. Historical deposits are excluded from storefront overview/customer totals and have a separate order scope. Collected payments use persisted `payment.amount_paid`; this is an order-store report, not a gateway settlement/balance report. Successful refund totals include Razorpay status `PROCESSED` and legacy status `SUCCESS` recorded on orders; pending, failed and unknown refunds are excluded.

The order API supports `page`, `page_size` (maximum 100), `scope=storefront|historical|all`, `search`, `payment_status` and `fulfillment_status`. It retains the array response when `page` is omitted and returns all matching summaries unless an explicit positive `limit` is supplied; the former implicit 100/500-order cap is removed. Both response formats use the shared summary cache. The Orders page defaults to **all records**, including historical deposits; overview financial metrics remain storefront-only.

Reports share a 15-second, single-flight summary cache. Firestore reads select only reporting fields instead of entire order documents, and order lists return summaries; opening an order loads its full detail separately. Writes through this backend invalidate cached order summaries. Manual Refresh sends `refresh=1` to bypass the cache; changes made by other server instances or imports appear after cache expiry or manual refresh. The first uncached report still reads a projection of the whole order collection, so much larger datasets should move to indexed pagination and persisted aggregates. Storefront pages and their visual components are loaded in separate JavaScript chunks so the admin does not download them at startup. Hosting cold starts remain a separate latency factor.

`/api/admin/customers?page=1&page_size=25&search=...` includes **all Firebase Authentication accounts**, even users with no orders, plus customers found in storefront and historical orders. The backend follows Firebase's 1,000-user page tokens until exhausted and returns only safe directory fields. UID/email matching merges order statistics into registered accounts; order counts show separate storefront and historical totals. This directory requires Firebase Admin permission to list users. A provider error fails the request instead of silently showing an incomplete directory; servers without Firebase credentials explicitly return `directory_available=false` and show only order customers. The legacy no-page endpoint retains an array response.

## Hostinger + Firebase

1. Run `npm run build:admin` from the repository root. It uses the frontend environment (currently `REACT_APP_BACKEND_URL=https://crestus-api.onrender.com`) and produces `dist/admin/` plus `output/crestus-admin-hostinger.zip`.
2. In Hostinger, select **crestuseccommerce.store → Domains → Subdomains**. Create **admin** with a dedicated document root such as `public_html/admin`. Keep the existing storefront root intact.
3. Upload the archive **into that document root** and extract its contents there. `index.html`, `.htaccess`, `robots.txt`, `static/`, and `images/` must be directly inside the root. `DirectoryIndex index.html` takes precedence over Hostinger's generated `default.php` placeholder. The SPA rewrite enables direct links such as `/orders/:id`.
4. Ensure the subdomain's DNS points to the hosting account, activate its SSL certificate and use HTTPS.
5. Add **admin.crestuseccommerce.store** under Firebase Authentication → Settings → Authorized domains. Email/password and Google sign-in use the existing Firebase project.

The same frontend source supports the admin subdomain at `/` and local/storefront previews at `/admin`. Admin routes do not display the customer header, cart drawer or footer. The admin package discourages indexing with robots metadata and headers; backend authorization protects the data.

## Verification

The current free Render instance reports that waking after inactivity can delay a request by 50 seconds or more. Administrator API requests and `/auth/me` allow 90 seconds for this startup, and the loading UI explains a slow response after 8 seconds. Query and bundle improvements reduce application work, but eliminating the hosting wake-up delay requires an always-on hosting instance.

Run `cd backend && npm test` and `cd frontend && CI=true npm test -- --watchAll=false --runInBand`, then build the final package. Deploy both the backend and the admin archive together because the new directory screen uses the paginated customer response. Verify HTTPS, a direct `/orders` reload, email/Google login, the authorized administrator session, API CORS, manual Refresh, filters/search/pagination, zero-order registered users, historical customers, and order details in Safari. Order details show payment, fulfillment and delivery statuses, with raw provider errors inside a closed Technical details disclosure. Confirm that signed-out requests return 401 and ordinary customer requests return 403. Catalog is a read-only server catalog; edits remain source-managed.

Never enter production refunds or cancel shipments merely to verify the admin interface.
