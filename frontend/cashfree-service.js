const { Cashfree, CFEnvironment } = require("cashfree-pg");

const APP_ID = process.env.CASHFREE_APP_ID || "14230288c95604eea0f624e274b8203241";
const SECRET_KEY =
  process.env.CASHFREE_SECRET_KEY || "cfsk_ma_prod_91c964533da99cb33e652d468b62d49d_8e9459ae";
const IS_SANDBOX = process.env.CASHFREE_ENV === "SANDBOX";
const ENV_MODE = IS_SANDBOX ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION;

// Initialize Cashfree SDK (v6, Version >= 5 format)
const cashfree = new Cashfree(ENV_MODE, APP_ID, SECRET_KEY);

/**
 * Create a Cashfree Payment Order
 */
async function createCashfreeOrder({
  orderId,
  orderAmount,
  customerId,
  customerPhone,
  customerName,
  customerEmail,
  returnUrl,
}) {
  const cleanPhone = (customerPhone || "9999999999").replace(/[^0-9]/g, "").slice(-10);
  const cleanCustomerId = (customerId || `cust_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");

  const request = {
    order_id: orderId || `ord_${Date.now()}`,
    order_amount: Number(orderAmount),
    order_currency: "INR",
    customer_details: {
      customer_id: cleanCustomerId,
      customer_phone: cleanPhone || "9999999999",
      customer_name: customerName || "Customer",
      customer_email: customerEmail || "customer@crestus.in",
    },
    order_meta: {
      return_url:
        returnUrl || "https://crestus.in/orders?order_id={order_id}",
    },
  };

  const response = await cashfree.PGCreateOrder(request);
  return {
    ...response.data,
    environment: IS_SANDBOX ? "sandbox" : "production",
  };
}

/**
 * Fetch Order Status from Cashfree
 */
async function getCashfreeOrder(orderId) {
  const response = await cashfree.PGFetchOrder(orderId);
  return response.data;
}

/**
 * Verify Webhook Signature
 */
function verifyCashfreeWebhook(signature, rawBody, timestamp) {
  return cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);
}

module.exports = {
  cashfree,
  createCashfreeOrder,
  getCashfreeOrder,
  verifyCashfreeWebhook,
  APP_ID,
  SECRET_KEY,
  ENV_MODE: IS_SANDBOX ? "sandbox" : "production",
};
