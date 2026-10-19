# Historical Cashfree import

This migration reconstructs the supplied CSV in Firebase project `crestus-6f962`, database `(default)`, collection `orders`. It does not represent the account's complete history. Dry-run is the default. No payment, split, refund, payout, wallet, inventory, email or Shiprocket API is called by the migration.

## Spark-compatible execution

`compact.cjs` executes a create-only reviewed plan with the same order IDs, original order fields, source ledger paths, attempt subcollections and atomic global transaction identity claims. It embeds each durable group checkpoint in the new order's `import_metadata.checkpoint` and keeps the rollback manifest in private local storage. The group checkpoint also identifies its merchant/source-order mapping through the unchanged import metadata. Since this preview changes no existing documents, no existing-document backup writes are needed. The four original orders are separately snapshotted before execution.

This reduces the reviewed import from 27,379 to **16,867 document writes**: 3,504 orders, 4,454 source ledgers, 4,454 attempts, 4,454 transaction identity claims, and one run manifest. It fits below the Spark plan's 20,000 daily document-write limit, subject to prior usage. The implementation does not enable billing or change the plan.

The compact path requires the reviewed plan SHA-256, verified live project/database identity, private client rules and fresh evidence excluding automatic effects. For this snapshot, all source groups have `payment.status != pending`, `fulfillment.due:false`, `tracking.active:false`, distinct imported application IDs, and no inferred user ownership. The inspected automatic workers consequently select none of the imported orders. Provider, wallet, shipping, inventory, email and payout calls are absent from the importer. Cloud Functions/Eventarc inventory remains unavailable because the management APIs are disabled; that limitation is recorded rather than represented as a completed inventory. Additional local application guards are tested but are not claimed deployed.

```sh
node scripts/firebase_history/compact.cjs --plan ".data/firebase-history/preview/plan.json"
node --test scripts/firebase_history/test_compact.cjs
```

After explicit approval, execute with `--apply --reviewed-sha256 <approved-hash> --backend <backend-directory> --credential <private-credential-file> --safety <private-evidence-file>`. Use the same arguments for a resumable rerun. A completed rerun checks order checkpoints and writes nothing. A full readback compares every created order, ledger, attempt and identity with the exact reviewed source. The second no-op run reuses that full verification only if it created no documents and its review hash matches.

Outputs are private `compact-outcomes.json`, `compact-rollback-manifest.json`, `compact-apply-summary.json`, `compact-readback-verification.json` and `compact-rerun-summary.json`. The rollback manifest records the exact created paths and hashes. `--rollback` previews rollback without writes. Adding `--apply` performs an explicitly authorized rollback only after comparing all current documents with their original imported values; source ledgers are retained as immutable audit evidence. A rollback closes the run against reimport.

**Current status: the approved import created all 3,504 orders and 4,454 attempts. Full live readback passed for all 16,866 per-order documents. The separately approved billing-address assignment passed readback for all 3,504 imported orders. The four original orders and their update timestamps are unchanged. See `output/firebase-history/completion-report.md` for final evidence.**

The companion application changes prevent imported records from running payment/shipping actions, exclude them from email-based customer ownership, render unknown fields safely, and label them as historical wallet deposits. Existing website orders keep their business data and provenance. Existing matches receive per-import audit metadata and missing verified payment leaves only. Any conflicting non-empty value stops that group for review.

## Source contract and mapping

| CSV field | Destination / interpretation |
| --- | --- |
| All 110 columns | Immutable `cashfree_import_transactions/{file_sha256}_{row}` documents, ordered `source_columns` entries `{header,value}`. Blanks and `N/A` remain exact strings. |
| Order Id | `payment.cashfree_order_id`, source group and merchant-scoped order identity. It is not `cf_order_id`. |
| Reference Id | `normalized.source_transaction_reference`, `cf_payment_id`, merchant-scoped transaction identity. Eight exact API samples verified this mapping. IDs remain strings. |
| Customer Name / Phone / Email | Corresponding `customer` fields; no Firebase user ownership is inferred. Original strings also remain in each attempt. |
| Currency | `payment.currency`, `totals.currency`, normalized attempt currency. |
| Amount | Attempt amount as decimal text plus integer paise. Only source SUCCESS amounts contribute to paid totals. |
| Order Amount | Order value and `amount_due`, matching the application's existing meaning of that field. Eight provider order lookups verified semantics; every source row's order amount equals its attempted amount. |
| Transaction Status | Preserved verbatim per attempt. SUCCESS → paid; FAILED → failed; USER_DROPPED → abandoned; INCOMPLETE → incomplete. Any success takes precedence over later failures. Partial, multiple-success and overpaid groups are explicit. |
| Transaction Time | Original string and UTC timestamp under `normalized.transaction_time`. Asia/Kolkata is inferred for the report from eight exact API `payment_time` matches with `+05:30`. This is transaction time, not proven order creation or payment-completion time. `created_at` and `paid_at` remain null. |
| Payment Mode / Payment Mode SubType | Separate normalized method fields. No invented hosted payment-link ID. |
| Order Note | Exact wallet-deposit description. No merchandise is created. |
| Bank Reference No. | Bank payment reference, kept separately from payment IDs and settlement UTR. Leading zeros remain. |
| Settlement / UTR No. / Settled On | Separate attempt settlement details. Source settlement dates remain original strings. A successful unsettled payment remains paid. |
| Charges / GST / EasySplit / vendor amounts | Original columns plus separately named decimal/paise values. Unknown money stays null; nothing is silently converted to zero. No commission is calculated or executed. |
| Refunds and remaining columns | Original columns retained. `Refunded` is preserved; no refund records, identifiers or amounts are invented. |

Each row has a SHA-256 of the UTF-8 canonical JSON of its ordered header/value entries (sorted map keys, compact separators, no ASCII escaping). The byte-exact original CSV has its own SHA-256 and a private archive. Logical record position, CSV record number and physical line span are recorded separately.

New order IDs are `ord_cf_` plus the first 24 hex characters of SHA-256 over the merchant scope and source order ID. This uses the application's `ord_` namespace without fabricating an order-creation timestamp. All 3,504 source groups map to stable document paths. Every attempt lives under `orders/{id}/cashfree_payment_attempts/{merchant_scoped_payment_hash}`. Existing exact `payment.cashfree_order_id`, session-attempt provider IDs or `cf_payment_id` matches take precedence in preview matching. Names, phone numbers, emails and amounts do not establish an order match.

At initial import, new documents have empty item/cart arrays, null addresses/package/shipping/tax/discounts and no user ID. Billing addresses were subsequently populated by the separately approved cyclic assignment described below. Fulfillment is `not_applicable`, `due:false`; tracking is inactive. `import_metadata` records known missing fields, source, source rows, run ID, actual import time, `ownership_verified:false`, `recognize_revenue:false` and disabled side effects. Actual import timestamps are assigned inside the committing transaction.

## Commands

Use private paths outside version control for credentials, source data, snapshots, plans, manifests and reports. The reviewed working preview lives in the payment workspace's ignored `.data/firebase-history/preview` directory. Node uses the Firebase application's installed `firebase-admin` and `google-auth-library`. Source preparation and reconciliation use Python's standard library. The optional read-only provider verification additionally uses `python-dotenv`.

From the payment workspace:

```sh
node scripts/firebase_history/inspect.cjs "/path/to/crestus_website/backend" ".data/firebase-history" "<reference-order-id>"
.venv/bin/python scripts/firebase_history/verify_provider.py --source "/private/source/report.csv" --env ".env" --out ".data/firebase-history/provider-evidence.json"
python3 scripts/firebase_history/prepare.py --source "/private/source/report.csv" --existing ".data/firebase-history/existing-orders.json" --evidence ".data/firebase-history/provider-evidence.json" --out ".data/firebase-history/preview"
python3 scripts/firebase_history/reconcile_preview.py --source "/private/source/report.csv" --plan ".data/firebase-history/preview/plan.json"
node scripts/firebase_history/migrate.cjs --plan ".data/firebase-history/preview/plan.json"
```

Inspect the exact `plan.json`, `representative-documents.json`, `exceptions.json`, `source-mapping.jsonl` and `reconciliation-preview.json`. Approve the concrete preview before applying. The apply command requires its exact SHA-256, a matching credential project, a live database metadata check and current deployment/privacy/trigger evidence. Never turn the example safety flags on without collecting that evidence. The evidence must be less than one hour old. Disabled management APIs are not proof that no deployed trigger exists.

```sh
node scripts/firebase_history/migrate.cjs --apply \
  --plan ".data/firebase-history/preview/plan.json" \
  --reviewed-sha256 "<approved-plan-sha256>" \
  --backend "/path/to/crestus_website/backend" \
  --credential ".data/firebase-history/service-account.json" \
  --safety "/private/verified-safety.json"
```

After each atomic order-group transaction, a Firestore checkpoint, immutable original document backup, field before/after changes and rollback entries are committed with its orders, attempts and source ledgers. All reads occur before writes. Exact provider matching queries and merchant-scoped identity claims are read within the same transaction; concurrent changes abort or retry. The inspected application's webhook updates existing orders and does not create business orders. If that contract changes, the new creator must also use the same order identity claim.

Existing matches discovered after preview, changed existing documents, identity collisions and non-empty conflicts stop the affected group. Private `outcomes.json` records every group's result and failed source positions. Resume with the same approved plan. Completed groups perform zero writes, and all source ledgers use create-only operations. After apply, every affected ledger, identity, attempt and order is read back. `readback-verification.json` checks row preservation, order coverage, exactly-once success linkage and paid totals. No live rerun or live readback is claimed by pre-approval tests.

Readback without applying:

```sh
node scripts/firebase_history/migrate.cjs --verify --plan "/private/preview/plan.json" --backend "/path/to/backend" --credential "/private/service-account.json"
```

Rollback is dry-run by default. Use `--rollback` with the same plan to inspect it; applying a rollback additionally requires `--apply`, the reviewed hash and safety evidence. Rollback restores only unchanged imported fields and deletes only unchanged documents created by this run. It refuses concurrent changes. Immutable CSV ledgers, backups and checkpoints remain; an append-only rollback event records the affected paths. A rolled-back run is closed audit history: use a newly reviewed migration for any later reimport.

## Verification and limits

```sh
python3 -m unittest discover -s scripts/firebase_history -p 'test_*.py'
node --test scripts/firebase_history/test_migrate.cjs
node scripts/firebase_history/test_admin_render.cjs "/path/to/crestus_website"
```

The migration tests use a synthetic optimistic transactional model, not a Firestore emulator. Application tests exercise the actual backend routes with file storage and fake payment/shipping providers. The DOM check renders the actual admin list/detail components with synthetic data. Run the complete backend suite and frontend production build as well. Live affected-record verification has now passed. The additional application guards remain local and are not claimed deployed.

Firestore client rules must deny access to the import ledgers, transaction/order identity collections and run backup/checkpoint collections. Server Admin SDK calls bypass client rules. The inspected live rules deny all client reads and writes; retain that privacy boundary. Append-only behavior is enforced by this migration's create-only writes, not by an assertion that privileged administrators cannot modify data.

API references: [Cashfree Get Payments for an Order](https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Cloud Functions inventory](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/list). Report identifier/timezone mappings are supported by the private live sample evidence; API reference definitions alone do not prove a particular CSV column's meaning.


## Approved billing-address assignment

`prepare_addresses.py` prepares the exact reviewed mapping from `delivery_addresses.xlsx`. The workbook has 761 address labels and no customer/order identifiers. The user explicitly authorized chronological sequential allocation with repetition: 3,504 imported orders, four complete cycles plus the first 460 addresses. The four original orders are excluded. Each assignment records `customer_address_relationship_verified:false`; it does not claim that the address belongs to that customer.

`apply_addresses.cjs` changes only `billing_address` and `billing_address_assignment`, using a transaction that checks scope and refuses conflicting pre-existing billing values. Before values and a canonical hash of every non-address field are committed atomically in provenance. The updater defaults to dry-run; apply requires the exact reviewed address-plan hash. `--source-plan` is required to check the unchanged successful payment total against the reviewed source. Readback verifies every address and the non-address hash. Private rollback manifests contain actual before/after values. Rollback refuses later address edits and is never automatic.

```sh
node --dns-result-order=ipv4first scripts/firebase_history/apply_addresses.cjs \
  --verify --plan .data/firebase-addresses/preview/plan.json \
  --source-plan .data/firebase-history/preview/plan.json \
  --backend /path/to/crestus_website/backend \
  --credential /private/service-account.json
```

To apply, replace `--verify` with `--apply --reviewed-sha256 <approved-address-plan-hash>`. Add `--resume-failed` after an interrupted/failed apply to retry only failed or unattempted outcomes from the same reviewed plan; completed outcomes and before images remain in the cumulative rollback manifest. A normal rerun checks every order and performs no writes when the assignment already matches. The first pass had two connection resets; resuming those outcomes completed both without duplicating an assignment.

After address assignment, the original source verifier must explicitly allow that reviewed later change. It restores only the recorded prior billing fields in its in-memory comparison; all source ledgers, attempts, identities, payment and other order fields remain exact comparisons.

```sh
node --dns-result-order=ipv4first scripts/firebase_history/compact.cjs \
  --verify --plan .data/firebase-history/preview/plan.json \
  --approved-address-plan .data/firebase-addresses/preview/plan.json \
  --backend /path/to/crestus_website/backend \
  --credential /private/service-account.json
```

`final_audit.cjs <backend> <private-history-directory>` is read-only. It verifies total/imported counts, exact original-order data and update times, automatic-worker exclusion, live client privacy rules and serialization by the local actual admin-view code. It does not deploy anything or change billing. The user upgraded to Blaze; the scripts never modify the billing plan.

Additional checks:

```sh
node --test scripts/firebase_history/test_compact.cjs
node --test scripts/firebase_history/test_addresses.cjs
```

The compact test file passes 14 tests and the address test file passes 12 tests (each includes the seven shared transaction tests). These model tests supplement, rather than replace, the successful live readbacks.
