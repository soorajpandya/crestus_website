const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { loadConfig, loadPackagingRules } = require("./lib/config");
const { createStore } = require("./lib/store");
const { createAuth } = require("./lib/auth");
const { createShiprocketClient } = require("./lib/shiprocket");
const { createShippingService } = require("./lib/shipping");
const { createPaymentService } = require("./lib/payments");
const { createTrackingService } = require("./lib/tracking");
const { createFulfillmentService } = require("./lib/fulfillment");
const pricing = require("./lib/pricing");
const { createOrderDocument, toCustomerView, toPublicTrackingView, toAdminView } = require("./lib/orders");

function loadProducts() {
  const local = path.join(__dirname, "products.json");
  const frontend = path.join(__dirname, "../frontend/src/data/products.json");
  const file = fs.existsSync(local) ? local : frontend;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp(overrides = {}) {
  const config = overrides.config || loadConfig();
  const logger = overrides.logger || console;
  const products = overrides.products || loadProducts();
  const packagingRules = overrides.packagingRules || loadPackagingRules(config.shipping.packagingFile);
  const store = overrides.store || createStore(config);
  const auth = overrides.auth || createAuth(config);

  let cashfree = overrides.cashfree;
  if (!cashfree) {
    const { Cashfree, CFEnvironment } = require("cashfree-pg");
    cashfree = new Cashfree(config.cashfree.sandbox ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION, config.cashfree.appId, config.cashfree.secretKey);
  }

  const shiprocket = overrides.shiprocket || createShiprocketClient({ config, store, logger });
  const shipping = createShippingService({ config, shiprocket, logger });
  const tracking = createTrackingService({ config, store, shiprocket, logger });
  let fulfillment;
  const payments = createPaymentService({
    config,
    store,
    cashfree,
    logger,
    // Kick the worker immediately; the persisted job guarantees pickup even if this call is lost.
    onPaid: async (order) => {
      if (config.worker.enabled || overrides.processOnPaid) await fulfillment.processOrder(order.order_id);
    },
  });
  fulfillment = createFulfillmentService({ config, store, shiprocket, shipping, tracking, payments, logger });
  const services = { config, store, auth, cashfree, shiprocket, shipping, tracking, fulfillment, payments, products, packagingRules };

  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const ok = config.allowedOrigins.includes(origin) || /\.(onrender\.com|vercel\.app|netlify\.app)$/.test(origin) || (!config.isProduction && /^http:\/\/localhost(:\d+)?$/.test(origin));
        cb(null, ok);
      },
      credentials: true,
    })
  );
  // Shiprocket validates the URL with a bare ping; answer it, but require the token for any real shipment payload.
  // Registered before the global JSON parser with its own tolerant body handling so a malformed probe can never 4xx.
  const isShipmentPayload = (body) => body && typeof body === "object" && (body.awb || body.order_id || body.channel_order_id || body.sr_order_id || body.shipment_id);
  app.all(
    ["/api/webhooks/shipping-updates", "/api/webhooks/shipping-updates/"],
    express.raw({ type: () => true, limit: "1mb" }),
    asyncRoute(async (req, res) => {
      let body = {};
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8").trim() : "";
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = Object.fromEntries(new URLSearchParams(raw));
        }
      }
      logger.info(`[tracking] webhook ${req.method} ua="${req.headers["user-agent"] || ""}" ct="${req.headers["content-type"] || ""}" token=${req.headers["x-api-key"] ? "present" : "absent"} keys=${Object.keys(body || {}).slice(0, 12).join(",") || "-"}`);
      if (req.method !== "POST" || !isShipmentPayload(body)) return res.json({ status: "ok", handled: false, reason: "ping" });
      try {
        const result = await tracking.handleWebhook({ body, headers: req.headers });
        res.json({ status: "ok", ...result });
      } catch (err) {
        // Unauthenticated or unconfigured: ignore the payload (no state change) but don't fail provider validation.
        if (err.status === 401 || err.status === 503) {
          logger.warn(`[tracking] webhook ignored: ${err.message}`);
          return res.json({ status: "ok", handled: false, reason: err.status === 401 ? "unauthorized" : "not_configured" });
        }
        throw err;
      }
    })
  );

  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf ? buf.toString("utf8") : "";
      },
    })
  );

  const health = (_req, res) =>
    res.json({ status: "ok", service: "crestus-api", gateway: "cashfree", mode: config.cashfree.sandbox ? "sandbox" : "production", store: store.driver, shiprocket: shiprocket.enabled ? (shiprocket.mock ? "mock" : "live") : "disabled" });
  app.get(["/", "/health", "/api/health"], health);

  // ---- catalogue ----------------------------------------------------------
  app.get("/api/products", (req, res) => {
    const { category } = req.query;
    if (category && category !== "all") return res.json(products.filter((p) => (p.category || "").toLowerCase() === String(category).toLowerCase()));
    res.json(products);
  });
  app.get("/api/products/:id", (req, res) => {
    const found = products.find((p) => p.id === req.params.id);
    if (!found) return res.status(404).json({ detail: "Product not found" });
    res.json(found);
  });

  // ---- identity -----------------------------------------------------------
  app.get("/api/auth/me", auth.requireAuth, (req, res) => res.json({ uid: req.user.uid, email: req.user.email, is_admin: req.user.is_admin }));

  // ---- checkout -----------------------------------------------------------
  const priceCart = async (items, pincode) => {
    const lineItems = pricing.buildLineItems(items, products, packagingRules);
    const pkg = pricing.buildPackage(lineItems, packagingRules);
    const subtotal = pricing.round2(lineItems.reduce((s, li) => s + li.line_total, 0));
    const quote = await shipping.quote({ pincode, subtotal, weightKg: pkg.weight_kg });
    const totals = pricing.computeTotals(lineItems, quote.shipping_charge || 0, config.shipping.gstRatePercent);
    return { lineItems, pkg, quote, totals };
  };

  app.post(
    "/api/checkout/quote",
    auth.requireAuth,
    asyncRoute(async (req, res) => {
      const pincode = String(req.body?.pincode || "").replace(/\D/g, "");
      if (!/^\d{6}$/.test(pincode)) throw new pricing.ValidationError("Please provide a valid 6-digit postal pincode", "pincode");
      const { lineItems, pkg, quote, totals } = await priceCart(req.body?.items, pincode);
      res.json({
        serviceable: quote.serviceable,
        serviceability_checked: quote.serviceability_checked,
        totals,
        package: pkg,
        courier: quote.courier ? { courier_name: quote.courier.courier_name, etd: quote.courier.etd, estimated_delivery_days: quote.courier.estimated_delivery_days } : null,
        items: lineItems.map(({ unit_weight_kg, ...li }) => li),
      });
    })
  );

  app.post(
    "/api/orders/create",
    auth.requireAuth,
    asyncRoute(async (req, res) => {
      const address = pricing.validateAddress(req.body?.address);
      if (req.user.email && address.email !== req.user.email) {
        // Order email must match the signed-in account so ownership checks stay unambiguous.
        address.email = req.user.email;
      }
      const { lineItems, pkg, quote, totals } = await priceCart(req.body?.items, address.pincode);
      if (!quote.serviceable) return res.status(400).json({ detail: "Sorry, we can't deliver to this pincode yet.", field: "pincode" });
      if (!config.shiprocket.pickupPostcode && shiprocket.enabled) return res.status(503).json({ detail: "Shipping is not configured" });

      const order = createOrderDocument({
        userId: req.user.uid,
        customer: { name: address.name, email: address.email, phone: address.phone },
        address,
        items: lineItems,
        totals,
        pkg,
        pickupLocation: config.shiprocket.pickupLocation,
        shippingQuote: quote,
        cartKeys: Array.isArray(req.body?.cart_keys) ? req.body.cart_keys.map(String) : lineItems.map((i) => i.key),
      });
      await store.putOrder(order);

      let session;
      try {
        session = await payments.createPaymentSession(order);
      } catch (err) {
        logger.error("[Cashfree] create order failed:", err.response?.data || err.message);
        await store.updateOrder(order.order_id, (o) => ({ ...o, payment: { ...o.payment, last_failure_reason: "Could not initialise payment" } }));
        return res.status(502).json({ detail: err.response?.data?.message || "Could not start payment. Please try again.", order_id: order.order_id });
      }
      res.json({
        order_id: order.order_id,
        cashfree_order_id: session.cashfree_order_id,
        cf_order_id: session.cf_order_id,
        payment_session_id: session.payment_session_id,
        amount: totals.total,
        totals,
        environment: session.environment,
      });
    })
  );

  // ---- customer orders ----------------------------------------------------
  // Cashfree substitutes its own order id into return_url; retries carry a "-rN" suffix that maps back to one internal order.
  const normaliseOrderParam = (req, _res, next, value) => {
    req.params.order_id = payments.internalOrderIdFrom(value);
    next();
  };
  app.param("order_id", normaliseOrderParam);

  const loadOwnedOrder = async (req, res) => {
    const order = await store.getOrder(req.params.order_id);
    if (!order || (!auth.ownsOrder(req.user, order) && !req.user.is_admin)) {
      res.status(404).json({ detail: "Order not found" });
      return null;
    }
    return order;
  };

  app.get(
    "/api/orders",
    auth.requireAuth,
    asyncRoute(async (req, res) => {
      const list = await store.listOrdersForUser({ userId: req.user.uid, email: req.user.email });
      res.json(list.map(toCustomerView));
    })
  );

  app.get(
    "/api/orders/track/:order_id",
    asyncRoute(async (req, res) => {
      const email = String(req.query.email || "").trim().toLowerCase();
      const phone = String(req.query.phone || "").replace(/\D/g, "").slice(-10);
      const order = await store.getOrder(req.params.order_id);
      const matches = order && ((email && order.customer.email === email) || (phone && order.customer.phone === phone));
      if (!matches) return res.status(404).json({ detail: "Order not found. Check the order ID and the email/phone used at checkout." });
      res.json(toPublicTrackingView(order));
    })
  );

  app.get(
    "/api/orders/:order_id",
    auth.requireAuth,
    asyncRoute(async (req, res) => {
      const order = await loadOwnedOrder(req, res);
      if (order) res.json(toCustomerView(order));
    })
  );

  const verifyHandler = asyncRoute(async (req, res) => {
    const orderId = payments.internalOrderIdFrom(req.params.order_id || req.body?.order_id);
    const order = orderId ? await store.getOrder(orderId) : null;
    if (!order || (!auth.ownsOrder(req.user, order) && !req.user.is_admin)) return res.status(404).json({ detail: "Order not found" });
    const result = await payments.confirmPayment(orderId, { source: "return_page" });
    res.json({ order_id: orderId, paid: result.paid, payment_status: result.order.payment.status, order: toCustomerView(result.order) });
  });
  app.post("/api/orders/:order_id/verify", auth.requireAuth, verifyHandler);
  app.post("/api/orders/verify", auth.requireAuth, verifyHandler);

  app.post(
    "/api/orders/:order_id/retry-payment",
    auth.requireAuth,
    asyncRoute(async (req, res) => {
      const order = await loadOwnedOrder(req, res);
      if (!order) return;
      const result = await payments.retryPayment(order.order_id);
      if (result.paid) return res.json({ paid: true, order: toCustomerView(result.order) });
      res.json({ paid: false, order_id: order.order_id, payment_session_id: result.payment_session_id, cashfree_order_id: result.cashfree_order_id, environment: result.environment, amount: order.totals.total });
    })
  );

  // ---- webhooks -----------------------------------------------------------
  const cashfreeWebhook = asyncRoute(async (req, res) => {
    try {
      const result = await payments.handleWebhook({ rawBody: req.rawBody, headers: req.headers });
      res.json({ status: "ok", ...result });
    } catch (err) {
      if (err.status === 401 || err.status === 400) {
        logger.warn("[Cashfree Webhook] rejected:", err.message);
        return res.status(err.status).json({ detail: err.message });
      }
      throw err;
    }
  });
  app.post(["/webhook", "/api/webhooks/cashfree"], cashfreeWebhook);

  // ---- admin --------------------------------------------------------------
  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.param("order_id", normaliseOrderParam);
  admin.get(
    "/orders",
    asyncRoute(async (req, res) => {
      const list = await store.listOrders({ limit: Math.min(Number(req.query.limit) || 100, 500), paymentStatus: req.query.payment_status || undefined, fulfillmentStatus: req.query.fulfillment_status || undefined });
      res.json(list.map(toAdminView));
    })
  );
  const adminOrder = async (req, res) => {
    const order = await store.getOrder(req.params.order_id);
    if (!order) res.status(404).json({ detail: "Order not found" });
    return order;
  };
  admin.get("/orders/:order_id", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (order) res.json(toAdminView(order));
  }));
  admin.post("/orders/:order_id/payment/verify", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (!order) return;
    const result = await payments.confirmPayment(order.order_id, { source: "admin" });
    res.json(toAdminView(result.order));
  }));
  admin.post("/orders/:order_id/fulfillment/retry", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (!order) return;
    const updated = await fulfillment.retryStage(order.order_id, { stage: req.body?.stage, by: req.user.email });
    res.json(toAdminView(updated));
  }));
  admin.post("/orders/:order_id/fulfillment/cancel", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (!order) return;
    const updated = await fulfillment.cancelShipment(order.order_id, { by: req.user.email, reason: req.body?.reason });
    res.json(toAdminView(updated));
  }));
  admin.post("/orders/:order_id/refund", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (!order) return;
    const updated = await payments.createRefund(order.order_id, { amount: req.body?.amount, reason: req.body?.reason, by: req.user.email });
    res.json(toAdminView(updated));
  }));
  admin.post("/orders/:order_id/tracking/refresh", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (!order) return;
    const result = await tracking.refreshFromProvider(order);
    res.json(toAdminView(result.order || order));
  }));
  admin.get("/orders/:order_id/documents", asyncRoute(async (req, res) => {
    const order = await adminOrder(req, res);
    if (order) res.json({ label_url: order.shipment.label_url, manifest_url: order.shipment.manifest_url, invoice_url: order.shipment.invoice_url });
  }));
  admin.post("/fulfillment/run", asyncRoute(async (_req, res) => {
    await fulfillment.runDueJobs();
    res.json({ status: "ok" });
  }));
  admin.post("/tracking/poll", asyncRoute(async (_req, res) => res.json(await tracking.pollActiveShipments())));
  app.use("/api/admin", admin);

  // ---- errors -------------------------------------------------------------
  app.use((err, req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ detail: err.message, field: err.field });
    if (err.type === "entity.parse.failed") return res.status(400).json({ detail: "Invalid JSON body" });
    logger.error(`[api] ${req.method} ${req.path} failed:`, err.response?.data || err.message);
    if (err.code === "NOT_CONFIGURED") return res.status(503).json({ detail: "Shipping is temporarily unavailable. Please try again later." });
    res.status(err.status || 500).json({ detail: "Something went wrong. Please try again." });
  });

  return { app, services };
}

module.exports = { createApp };
