const path = require("path");
const fs = require("fs");

const bool = (v, def = false) => {
  if (v === undefined || v === null || v === "") return def;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function loadPackagingRules(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function loadConfig(env = process.env) {
  const isTest = env.NODE_ENV === "test";
  const frontendUrl = (env.FRONTEND_URL || "https://crestuseccommerce.store").replace(/\/+$/, "");
  return {
    isTest,
    isProduction: env.NODE_ENV === "production",
    port: num(env.PORT, 8000),
    frontendUrl,
    allowedOrigins: [
      frontendUrl,
      "https://crestuseccommerce.store",
      "https://www.crestuseccommerce.store",
      "https://crestus.in",
      "https://www.crestus.in",
      "http://localhost:3000",
      "http://localhost:5173",
      ...list(env.EXTRA_ALLOWED_ORIGINS),
    ],
    adminEmails: list(env.ADMIN_EMAILS),
    adminAlertWebhookUrl: env.ADMIN_ALERT_WEBHOOK_URL || "",
    // Dev-only escape hatch: trust x-dev-uid / x-dev-email headers when Firebase Admin is not configured.
    allowInsecureDevAuth: bool(env.ALLOW_INSECURE_DEV_AUTH) && env.NODE_ENV !== "production",

    cashfree: {
      appId: env.CASHFREE_APP_ID || "",
      secretKey: env.CASHFREE_SECRET_KEY || "",
      sandbox: env.CASHFREE_ENV === "SANDBOX",
    },

    firebase: {
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
      serviceAccountFile: env.FIREBASE_SERVICE_ACCOUNT_FILE || "",
      projectId: env.FIREBASE_PROJECT_ID || "crestus-6f962",
      useApplicationDefault: bool(env.FIREBASE_USE_APPLICATION_DEFAULT),
    },

    store: {
      // "firestore" | "file"
      driver: env.ORDER_STORE || (env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_FILE || bool(env.FIREBASE_USE_APPLICATION_DEFAULT) ? "firestore" : "file"),
      dataDir: env.DATA_DIR || path.join(__dirname, "..", "data"),
    },

    shiprocket: {
      enabled: bool(env.SHIPROCKET_ENABLED, Boolean(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD)),
      mock: bool(env.SHIPROCKET_MOCK),
      baseUrl: (env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in/v1/external").replace(/\/+$/, ""),
      email: env.SHIPROCKET_EMAIL || "",
      password: env.SHIPROCKET_PASSWORD || "",
      pickupLocation: env.SHIPROCKET_PICKUP_LOCATION || "Primary",
      pickupPostcode: String(env.SHIPROCKET_PICKUP_POSTCODE || "").replace(/\D/g, ""),
      channelId: env.SHIPROCKET_CHANNEL_ID || "",
      webhookToken: env.SHIPROCKET_WEBHOOK_TOKEN || "",
      requestTimeoutMs: num(env.SHIPROCKET_TIMEOUT_MS, 20000),
      // Token is valid for 240h; refresh ahead of expiry.
      tokenTtlMs: num(env.SHIPROCKET_TOKEN_TTL_HOURS, 230) * 3600 * 1000,
      // "recommended" | "cheapest" | "fastest" | "balanced"
      courierPolicy: (env.COURIER_SELECTION_POLICY || "recommended").toLowerCase(),
      courierBalancedEtdWeight: num(env.COURIER_BALANCED_ETD_WEIGHT, 15),
    },

    shipping: {
      // "flat" (policy page: free above threshold, flat fee below) | "courier" (pass courier rate through) | "free"
      mode: (env.SHIPPING_CHARGE_MODE || "flat").toLowerCase(),
      flatRate: num(env.SHIPPING_FLAT_RATE, 79),
      freeAbove: num(env.SHIPPING_FREE_ABOVE, 1999),
      declaredValueCap: num(env.SHIPPING_DECLARED_VALUE_CAP, 50000),
      // Prices on the site are tax-inclusive; GST rate recorded on the snapshot for reporting.
      gstRatePercent: num(env.GST_RATE_PERCENT, 0),
      hsnCode: env.APPAREL_HSN_CODE || "",
      packagingFile: env.PACKAGING_RULES_FILE || path.join(__dirname, "..", "config", "packaging.json"),
    },

    worker: {
      enabled: bool(env.FULFILLMENT_WORKER_ENABLED, !isTest),
      pollIntervalMs: num(env.FULFILLMENT_POLL_INTERVAL_MS, 5000),
      maxAttempts: num(env.FULFILLMENT_MAX_ATTEMPTS, 6),
      baseBackoffMs: num(env.FULFILLMENT_BASE_BACKOFF_MS, 30000),
      maxBackoffMs: num(env.FULFILLMENT_MAX_BACKOFF_MS, 30 * 60 * 1000),
      trackingPollIntervalMs: num(env.TRACKING_POLL_INTERVAL_MINUTES, 60) * 60 * 1000,
      paymentReconcileIntervalMs: num(env.PAYMENT_RECONCILE_INTERVAL_MINUTES, 10) * 60 * 1000,
      paymentPendingTtlMs: num(env.PAYMENT_PENDING_TTL_HOURS, 48) * 3600 * 1000,
    },
  };
}

module.exports = { loadConfig, loadPackagingRules };
