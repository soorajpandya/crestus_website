// Backend-only Razorpay REST client. Credentials never enter browser payloads or errors.
function createRazorpayClient({ config, fetchImpl = fetch }) {
  const { keyId, keySecret, timeoutMs } = config.razorpay;
  async function request(method, resource, body) {
    if (!keyId || !keySecret) {
      const error = new Error("Razorpay is not configured");
      error.status = 503;
      throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://api.razorpay.com/v1/${resource}`, {
        method,
        headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(`Razorpay request failed (${response.status})`);
        error.status = 502;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      const safe = new Error("Could not reach Razorpay. Please try again.");
      safe.status = 502;
      throw safe;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    createOrder: body => request("POST", "orders", body),
    fetchOrder: id => request("GET", `orders/${encodeURIComponent(id)}`),
    fetchOrderPayments: id => request("GET", `orders/${encodeURIComponent(id)}/payments`),
    createRefund: (id, body) => request("POST", `payments/${encodeURIComponent(id)}/refund`, body),
  };
}

module.exports = { createRazorpayClient };
