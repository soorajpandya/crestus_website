// craco.config.js
const path = require("path");
require("dotenv").config();

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

function makeDevServerV5Compatible(devServerConfig) {
  const {
    https,
    onAfterSetupMiddleware,
    onBeforeSetupMiddleware,
    onListening,
    setupMiddlewares,
    ...compatibleConfig
  } = devServerConfig;

  compatibleConfig.server =
    typeof https === "object"
      ? { type: "https", options: https }
      : https
        ? "https"
        : "http";
  compatibleConfig.headers = {
    ...compatibleConfig.headers,
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (onBeforeSetupMiddleware || setupMiddlewares) {
    compatibleConfig.setupMiddlewares = (middlewares, devServer) => {
      if (onBeforeSetupMiddleware) {
        onBeforeSetupMiddleware(devServer);
      }

      return setupMiddlewares
        ? setupMiddlewares(middlewares, devServer)
        : middlewares;
    };
  }

  compatibleConfig.onListening = (devServer) => {
    devServer.close ??= (callback) => devServer.stopCallback(callback);

    if (onListening) {
      onListening(devServer);
    }
    if (onAfterSetupMiddleware) {
      onAfterSetupMiddleware(devServer);
    }
  };

  return compatibleConfig;
}

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

  devServerConfig.setupMiddlewares = (middlewares, devServer) => {
    if (originalSetupMiddlewares) {
      middlewares = originalSetupMiddlewares(middlewares, devServer);
    }

    try {
      const express = require("express");
      const {
        createCashfreeOrder,
        getCashfreeOrder,
        verifyCashfreeWebhook,
      } = require("./cashfree-service");

      devServer.app.use(express.json());

      // Cashfree Create Order
      devServer.app.post("/api/orders/create", async (req, res) => {
        try {
          const { items, address, amount } = req.body;
          const total =
            amount ||
            (items || []).reduce(
              (sum, it) => sum + (it.price || 0) * (it.qty || 1),
              0
            );
          const orderId = `ord_${Date.now()}`;

          const cfOrder = await createCashfreeOrder({
            orderId,
            orderAmount: total,
            customerId: address?.phone || `cust_${Date.now()}`,
            customerPhone: address?.phone || "9999999999",
            customerName: address?.name || "Customer",
            customerEmail: address?.email || "customer@crestus.in",
            returnUrl: "https://crestus.in/orders?order_id={order_id}",
          });

          res.json({
            order_id: orderId,
            cf_order_id: cfOrder.cf_order_id,
            payment_session_id: cfOrder.payment_session_id,
            amount: total,
            environment: cfOrder.environment,
          });
        } catch (err) {
          console.error(
            "[Cashfree] Create order error:",
            err.response?.data || err.message
          );
          res
            .status(500)
            .json({ detail: err.response?.data?.message || err.message });
        }
      });

      // Cashfree Verify Order
      devServer.app.post("/api/orders/verify", async (req, res) => {
        try {
          const { order_id } = req.body;
          const cfOrder = await getCashfreeOrder(order_id);
          res.json({
            order_id,
            status: cfOrder.order_status,
            paid: cfOrder.order_status === "PAID",
            data: cfOrder,
          });
        } catch (err) {
          console.error(
            "[Cashfree] Verify error:",
            err.response?.data || err.message
          );
          res
            .status(500)
            .json({ detail: err.response?.data?.message || err.message });
        }
      });

      // Cashfree Webhook
      devServer.app.post("/api/webhook", (req, res) => {
        try {
          const sig = req.headers["x-webhook-signature"];
          const ts = req.headers["x-webhook-timestamp"];
          const verified = verifyCashfreeWebhook(
            sig,
            JSON.stringify(req.body),
            ts
          );
          console.log("[Cashfree Webhook] Verified signature:", verified);
          res.json({ status: "ok" });
        } catch (err) {
          console.error("[Cashfree Webhook] Error:", err.message);
          res.status(400).send("Webhook verification failed");
        }
      });
    } catch (err) {
      console.warn("[Cashfree] Setup middleware skipped:", err.message);
    }

    // Add health check endpoints if enabled
    if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
      setupHealthEndpoints(devServer, healthPluginInstance);
    }

    return middlewares;
  };

  return devServerConfig;
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }
}

const configureDevServer = webpackConfig.devServer;
webpackConfig.devServer = (devServerConfig) =>
  makeDevServerV5Compatible(configureDevServer(devServerConfig));

module.exports = webpackConfig;
