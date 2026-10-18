# Crestus admin deployment

Target: `https://admin.crestuseccommerce.store`

## Backend

Deploy the Node backend with the new `lib/admin.js`, reporting routes in `app.js`, the admin CORS origin in `lib/config.js`, and the existing verified-email authorization in `lib/auth.js`. Preserve all existing payment, shipping and Firebase secrets. Set `ADMIN_EMAILS=admin@crestuseccommerce.store` (retain any other explicitly authorized administrators). The account must exist in Firebase project `crestus-6f962` and have a verified email, or an explicit server-managed `admin=true` custom claim.

The new `/api/admin/overview`, `/customers`, `/catalog`, `/settings` and paginated `/orders?page=1` APIs require an administrator token. Reporting performs no financial or shipping writes. Historical deposits are excluded from storefront overview/customer totals and have a separate order scope. Collected payments use persisted `payment.amount_paid`; this is an order-store report, not a Cashfree settlement/balance report. Successful refund totals include only provider status `SUCCESS` recorded on orders.

The order API supports `page`, `page_size` (maximum 100), `scope=storefront|historical|all`, `search`, `payment_status` and `fulfillment_status`. It retains the array response when `page` is omitted. Reporting currently reads the full order collection, matching the existing store implementation; larger catalogs should move reports and pagination to indexed queries/aggregates.

## Hostinger + Firebase

1. Run `npm run build:admin` from the repository root. It uses the frontend environment (currently `REACT_APP_BACKEND_URL=https://crestus-api.onrender.com`) and produces `dist/admin/` plus `output/crestus-admin-hostinger.zip`.
2. In Hostinger, select **crestuseccommerce.store → Domains → Subdomains**. Create **admin** with a dedicated document root such as `public_html/admin`. Keep the existing storefront root intact.
3. Upload the archive **into that document root** and extract its contents there. `index.html`, `.htaccess`, `robots.txt`, `static/`, and `images/` must be directly inside the root. `DirectoryIndex index.html` takes precedence over Hostinger's generated `default.php` placeholder. The SPA rewrite enables direct links such as `/orders/:id`.
4. Ensure the subdomain's DNS points to the hosting account, activate its SSL certificate and use HTTPS.
5. Add **admin.crestuseccommerce.store** under Firebase Authentication → Settings → Authorized domains. Email/password and Google sign-in use the existing Firebase project.

The same frontend source supports the admin subdomain at `/` and local/storefront previews at `/admin`. Admin routes do not display the customer header, cart drawer or footer. The admin package discourages indexing with robots metadata and headers; backend authorization protects the data.

## Verification

Run `cd backend && npm test` and `cd frontend && CI=true npm test -- --watchAll=false --runInBand`, then build the final package. Verify HTTPS, a direct `/orders` reload, email/Google login, the authorized administrator session, API CORS, manual Refresh, filters/search/pagination, and order details in Safari. Confirm that signed-out requests return 401 and ordinary customer requests return 403. Catalog is a read-only server catalog; edits remain source-managed. Customer records represent ordering customers, not the Firebase user directory.

Never enter production refunds or cancel shipments merely to verify the admin interface.
