# Crestus — storefront, Cashfree payments and Shiprocket fulfillment

## Layout

- `frontend/` — React (CRA + craco). Talks only to `REACT_APP_BACKEND_URL/api` with the user's Firebase ID token.
- `backend/` — Node/Express API, order store, payment confirmation, fulfillment worker and tracking.
  - `app.js` builds the app; `server.js` boots it and starts the worker.
  - `lib/payments.js` — single idempotent Cashfree confirmation path (webhook, return page, retry, reconciliation).
  - `lib/fulfillment.js` — durable Shiprocket worker (serviceability → order → AWB → pickup → manifest → label → invoice).
  - `lib/tracking.js` — Shiprocket webhook + polling, deduplicated events, customer-friendly statuses.
  - `lib/store/` — Firestore (`firebase-admin`) or JSON-file store with the same interface.
  - `config/packaging.json` — package weight/dimension rules (verify before go-live).

## Backend setup

```bash
cd backend && cp .env.example .env   # fill in the values
npm install
npm start                            # API + worker
npm test                             # mocked Cashfree + Shiprocket, no network
```

Required for production:

| Setting | Purpose |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` or `_FILE` | Verifies customer ID tokens and stores orders in Firestore (`orders/{order_id}`, `meta/*`). Without it, authenticated routes return 503. |
| `ADMIN_EMAILS` | Comma-separated admin accounts (or set custom claim `admin=true`). |
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` / `CASHFREE_ENV` | Payment gateway. |
| `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` | Shiprocket **API user** (Settings → API → Configure → Create API user). |
| `SHIPROCKET_PICKUP_LOCATION` / `SHIPROCKET_PICKUP_POSTCODE` | Must match a pickup address configured in Shiprocket. |
| `SHIPROCKET_WEBHOOK_TOKEN` | Shared secret for tracking webhooks. |
| `FRONTEND_URL` | `https://crestuseccommerce.store` — used for Cashfree `return_url` (`/pending?order_id={order_id}`). |

Firestore rules: the backend uses the Admin SDK, so lock the `orders` and `meta` collections to server-only access (`allow read, write: if false;`). The client SDK only touches `carts/{uid}`.

## Webhooks

- **Cashfree** → `POST https://<api-host>/api/webhooks/cashfree` (alias `/webhook`). Signature is verified against the raw body using the SDK; the order is then re-fetched from Cashfree before anything is marked paid. Enable `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK` in the Cashfree dashboard.
- **Shiprocket** → `POST https://<api-host>/api/webhooks/shipping-updates` configured in Shiprocket → Settings → API → Webhooks with the token from `SHIPROCKET_WEBHOOK_TOKEN` (sent back as `x-api-key`). Both the channel order id (our `order_id`) and the AWB are used to match the shipment.

## Order lifecycle

1. `POST /api/checkout/quote` and `POST /api/orders/create` price the cart from the catalogue, resolve the package from `packaging.json`, check courier serviceability and apply the shipping policy (`SHIPPING_CHARGE_MODE`). The order snapshot is saved **before** the Cashfree order exists.
2. Payment is confirmed only via `payments.confirmPayment` (amount + currency + collected sum checked against the snapshot). Confirmation and the fulfillment job are written in one update.
3. The worker resumes from the persisted stage; transient errors retry with backoff, validation/courier/account issues go to `needs_attention` and alert the admin (`ADMIN_ALERT_WEBHOOK_URL`). Uncertain (timed-out) stages reconcile with Shiprocket before re-sending.
4. Tracking events are deduplicated by content hash and ordered by provider timestamp; `delivered` is only ever set from a provider event. Active shipments are re-polled every `TRACKING_POLL_INTERVAL_MINUTES`.

## Frontend routes

`/checkout` → Cashfree modal → `/pending?order_id=…` (bounded verification polling) → `/success` or `/failed` (safe retry). Order history at `/orders`, details and timeline at `/orders/:id`, public lookup at `/track-order` (order id + email). Admin console at `/admin/orders` (retry stage, cancel shipment, refund, documents, tracking refresh).
