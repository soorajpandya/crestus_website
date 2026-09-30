const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { Cashfree, CFEnvironment } = require("cashfree-pg");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 8000;

// Configuration
const APP_ID = process.env.CASHFREE_APP_ID || "14230288c95604eea0f624e274b8203241";
const SECRET_KEY =
  process.env.CASHFREE_SECRET_KEY || "cfsk_ma_prod_91c964533da99cb33e652d468b62d49d_8e9459ae";
const IS_SANDBOX = process.env.CASHFREE_ENV === "SANDBOX";
const ENV_MODE = IS_SANDBOX ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION;

// Initialize Cashfree SDK (v6, Version >= 5)
const cashfree = new Cashfree(ENV_MODE, APP_ID, SECRET_KEY);

// Middleware — allow production site, Render preview, and local dev origins
const ALLOWED_ORIGINS = [
  "https://crestus.in",
  "https://www.crestus.in",
  "http://localhost:3000",
  "http://localhost:5173",
];
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return cb(null, true);
      if (
        ALLOWED_ORIGINS.includes(origin) ||
        origin.endsWith(".onrender.com") ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith(".netlify.app")
      ) {
        return cb(null, true);
      }
      return cb(null, true); // Keep permissive for now; tighten later
    },
    credentials: true,
  })
);
// Preserve rawBody for webhook signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf ? buf.toString() : "";
    },
  })
);

// In-memory or file-based orders store
const ordersFile = path.join(__dirname, "orders.json");
let orders = [];
if (fs.existsSync(ordersFile)) {
  try {
    orders = JSON.parse(fs.readFileSync(ordersFile, "utf-8"));
  } catch {}
}
const saveOrders = () => {
  try {
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
  } catch {}
};

// Load products
let products = [];
const productsFile = path.join(__dirname, "../frontend/src/data/products.json");
if (fs.existsSync(productsFile)) {
  try {
    products = JSON.parse(fs.readFileSync(productsFile, "utf-8"));
  } catch {}
}

// Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    gateway: "cashfree",
    mode: IS_SANDBOX ? "sandbox" : "production",
  });
});

app.get("/api/products", (req, res) => {
  const { category } = req.query;
  if (category && category !== "all") {
    return res.json(
      products.filter((p) => p.category && p.category.toLowerCase() === category.toLowerCase())
    );
  }
  res.json(products);
});

app.get("/api/products/:id", (req, res) => {
  const found = products.find((p) => p.id === req.params.id);
  if (!found) return res.status(404).json({ detail: "Product not found" });
  res.json(found);
});

// Create Cashfree Order
app.post("/api/orders/create", async (req, res) => {
  try {
    const { items, address, amount } = req.body;
    const total =
      amount ||
      (items || []).reduce((sum, it) => sum + (it.price || 0) * (it.qty || 1), 0);
    const orderId = `ord_${Date.now()}`;
    const cleanPhone = (address?.phone || "9999999999").replace(/[^0-9]/g, "").slice(-10);

    const request = {
      order_id: orderId,
      order_amount: Number(total),
      order_currency: "INR",
      customer_details: {
        customer_id: cleanPhone || `cust_${Date.now()}`,
        customer_phone: cleanPhone || "9999999999",
        customer_name: address?.name || "Customer",
        customer_email: address?.email || "customer@crestus.in",
      },
      order_meta: {
        return_url: "https://crestus.in/orders?order_id={order_id}",
      },
    };

    const response = await cashfree.PGCreateOrder(request);
    const orderData = response.data;

    // Record order locally
    orders.unshift({
      order_id: orderId,
      cf_order_id: orderData.cf_order_id,
      amount: total,
      status: "pending",
      items: items || [],
      address: address || {},
      created_at: new Date().toISOString(),
    });
    saveOrders();

    res.json({
      order_id: orderId,
      cf_order_id: orderData.cf_order_id,
      payment_session_id: orderData.payment_session_id,
      amount: total,
      environment: IS_SANDBOX ? "sandbox" : "production",
    });
  } catch (err) {
    console.error("[Cashfree] Error creating order:", err.response?.data || err.message);
    res.status(500).json({ detail: err.response?.data?.message || err.message });
  }
});

// Verify Cashfree Order
app.post("/api/orders/verify", async (req, res) => {
  try {
    const { order_id } = req.body;
    const response = await cashfree.PGFetchOrder(order_id);
    const cfOrder = response.data;

    const existing = orders.find((o) => o.order_id === order_id);
    if (existing) {
      existing.status = cfOrder.order_status === "PAID" ? "paid" : cfOrder.order_status.toLowerCase();
      saveOrders();
    }

    res.json({
      order_id,
      status: cfOrder.order_status,
      paid: cfOrder.order_status === "PAID",
      data: cfOrder,
    });
  } catch (err) {
    console.error("[Cashfree] Error verifying order:", err.response?.data || err.message);
    res.status(500).json({ detail: err.response?.data?.message || err.message });
  }
});

// Cashfree Webhook
app.post("/webhook", (req, res) => {
  try {
    const sig = req.headers["x-webhook-signature"];
    const ts = req.headers["x-webhook-timestamp"];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const verified = cashfree.PGVerifyWebhookSignature(sig, rawBody, ts);
    console.log("[Cashfree Webhook] Verified:", verified, "Type:", req.body?.type);

    if (req.body?.data?.order) {
      const orderId = req.body.data.order.order_id;
      const status = req.body.data.order.order_status;
      const existing = orders.find((o) => o.order_id === orderId);
      if (existing) {
        existing.status = status === "PAID" ? "paid" : status.toLowerCase();
        saveOrders();
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Cashfree Webhook] Error:", err.message);
    res.status(400).send("Webhook verification failed");
  }
});

app.get("/api/orders", (req, res) => {
  res.json(orders);
});

app.get("/api/orders/track/:order_id", (req, res) => {
  const found = orders.find((o) => o.order_id === req.params.order_id);
  if (!found) return res.status(404).json({ detail: "Order not found" });
  res.json(found);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Crestus Backend with Cashfree listening on 0.0.0.0:${PORT}`);
});
