// Shiprocket external API client. Credentials and tokens never leave the server.
class ShiprocketError extends Error {
  constructor(message, { status, code, transient = false, uncertain = false, data } = {}) {
    super(message);
    this.name = "ShiprocketError";
    this.status = status;
    this.code = code || (transient ? "TRANSIENT" : "PROVIDER_ERROR");
    this.transient = transient;
    this.uncertain = uncertain; // request may have been applied (timeout after send)
    this.data = data;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN_META_KEY = "shiprocket_token";

function createShiprocketClient({ config, store, fetchImpl = globalThis.fetch, logger = console }) {
  const sr = config.shiprocket;
  if (sr.mock) return createMockShiprocketClient({ config });

  let cached = null; // { token, expires_at }

  async function login() {
    if (!sr.email || !sr.password) {
      throw new ShiprocketError("Shiprocket credentials are not configured", { code: "NOT_CONFIGURED" });
    }
    const res = await doFetch(`${sr.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: sr.email, password: sr.password }),
    });
    const data = await parseJson(res);
    if (!res.ok || !data?.token) {
      throw new ShiprocketError("Shiprocket authentication failed", { status: res.status, code: "AUTH_FAILED", data: redact(data) });
    }
    cached = { token: data.token, expires_at: new Date(Date.now() + sr.tokenTtlMs).toISOString() };
    await store.setMeta(TOKEN_META_KEY, cached).catch(() => {});
    return cached.token;
  }

  async function getToken(force = false) {
    if (!force) {
      if (!cached) cached = (await store.getMeta(TOKEN_META_KEY).catch(() => null)) || null;
      if (cached?.token && Date.parse(cached.expires_at) - Date.now() > 60_000) return cached.token;
    }
    return login();
  }

  async function doFetch(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), sr.requestTimeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      const isTimeout = err?.name === "AbortError";
      throw new ShiprocketError(isTimeout ? "Shiprocket request timed out" : `Shiprocket network error: ${err.message}`, {
        transient: true,
        uncertain: init.method && init.method !== "GET",
        code: isTimeout ? "TIMEOUT" : "NETWORK",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, path, { body, query, attempt = 0, refreshed = false } = {}) {
    const url = new URL(`${sr.baseUrl}${path}`);
    if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, String(v)));
    const token = await getToken();
    const res = await doFetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJson(res);

    if (res.status === 401 && !refreshed) {
      cached = null;
      await getToken(true);
      return request(method, path, { body, query, attempt, refreshed: true });
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      return request(method, path, { body, query, attempt: attempt + 1, refreshed });
    }
    if (res.status === 429 || res.status >= 500) {
      throw new ShiprocketError(`Shiprocket unavailable (${res.status})`, { status: res.status, transient: true, code: "RATE_LIMITED_OR_5XX", data: redact(data) });
    }
    if (!res.ok) {
      throw new ShiprocketError(data?.message || `Shiprocket request failed (${res.status})`, { status: res.status, code: "BAD_REQUEST", data: redact(data) });
    }
    return data;
  }

  return {
    enabled: sr.enabled,
    mock: false,
    serviceability: ({ pickupPostcode, deliveryPostcode, weightKg, declaredValue, cod = 0 }) =>
      request("GET", "/courier/serviceability/", {
        query: { pickup_postcode: pickupPostcode, delivery_postcode: deliveryPostcode, weight: weightKg, cod, declared_value: declaredValue },
      }),
    createAdhocOrder: (payload) => request("POST", "/orders/create/adhoc", { body: payload }),
    assignAwb: ({ shipmentId, courierId }) =>
      request("POST", "/courier/assign/awb", { body: courierId ? { shipment_id: shipmentId, courier_id: courierId } : { shipment_id: shipmentId } }),
    generatePickup: ({ shipmentId }) => request("POST", "/courier/generate/pickup", { body: { shipment_id: [shipmentId] } }),
    generateManifest: ({ shipmentId }) => request("POST", "/manifests/generate", { body: { shipment_id: [shipmentId] } }),
    printManifest: ({ srOrderId }) => request("POST", "/manifests/print", { body: { order_ids: [srOrderId] } }),
    generateLabel: ({ shipmentId }) => request("POST", "/courier/generate/label", { body: { shipment_id: [shipmentId] } }),
    printInvoice: ({ srOrderId }) => request("POST", "/orders/print/invoice", { body: { ids: [srOrderId] } }),
    trackAwb: (awb) => request("GET", `/courier/track/awb/${encodeURIComponent(awb)}`),
    trackShipment: (shipmentId) => request("GET", `/courier/track/shipment/${encodeURIComponent(shipmentId)}`),
    findOrderByChannelOrderId: async (orderId) => {
      const data = await request("GET", "/orders", { query: { search: orderId, per_page: 5 } });
      const rows = Array.isArray(data?.data) ? data.data : [];
      return rows.find((r) => String(r.channel_order_id) === String(orderId)) || null;
    },
    getOrder: (srOrderId) => request("GET", `/orders/show/${encodeURIComponent(srOrderId)}`),
    cancelOrders: ({ srOrderIds }) => request("POST", "/orders/cancel", { body: { ids: srOrderIds } }),
    cancelShipmentsByAwb: ({ awbs }) => request("POST", "/orders/cancel/shipment/awbs", { body: { awbs } }),
  };
}

async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function redact(data) {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };
  delete clone.token;
  return clone;
}

// ---------------------------------------------------------------------------
// Mock client for automated tests and controlled environments. Never calls the network.
function createMockShiprocketClient({ config }) {
  const behaviour = { failStage: null, failMode: null, courierUnavailable: false, calls: [] };
  const state = { nextOrderId: 500001, nextShipmentId: 900001, created: new Map() };
  const record = (name, payload) => behaviour.calls.push({ name, payload });

  const maybeFail = (stage) => {
    if (behaviour.failStage !== stage) return;
    const mode = behaviour.failMode;
    if (mode === "timeout") throw new ShiprocketError("Shiprocket request timed out", { transient: true, uncertain: true, code: "TIMEOUT" });
    if (mode === "transient") throw new ShiprocketError("Shiprocket unavailable (503)", { status: 503, transient: true });
    throw new ShiprocketError(`Mock validation failure at ${stage}`, { status: 400, code: "BAD_REQUEST", data: { message: "mock failure" } });
  };

  return {
    enabled: true,
    mock: true,
    behaviour,
    state,
    async serviceability(q) {
      record("serviceability", q);
      maybeFail("serviceability");
      if (behaviour.courierUnavailable) return { status: 200, data: { available_courier_companies: [] } };
      return {
        status: 200,
        data: {
          recommended_courier_company_id: 10,
          available_courier_companies: [
            { courier_company_id: 10, courier_name: "Mock Express", rate: 65, freight_charge: 65, etd: "2026-10-09", estimated_delivery_days: "5", cod: 0 },
            { courier_company_id: 11, courier_name: "Mock Surface", rate: 55, freight_charge: 55, etd: "2026-10-12", estimated_delivery_days: "8", cod: 0 },
            { courier_company_id: 12, courier_name: "Mock Air", rate: 120, freight_charge: 120, etd: "2026-10-06", estimated_delivery_days: "2", cod: 0 },
          ],
        },
      };
    },
    async createAdhocOrder(payload) {
      record("createAdhocOrder", payload);
      maybeFail("create_order");
      const existing = state.created.get(payload.order_id);
      if (existing) throw new ShiprocketError("Order with this id already exists", { status: 400, code: "BAD_REQUEST" });
      const rec = { order_id: state.nextOrderId++, shipment_id: state.nextShipmentId++, channel_order_id: payload.order_id, status: "NEW", status_code: 1 };
      state.created.set(payload.order_id, rec);
      return { ...rec, onboarding_completed_now: 0, awb_code: "", courier_company_id: "", courier_name: "" };
    },
    async assignAwb({ shipmentId, courierId }) {
      record("assignAwb", { shipmentId, courierId });
      maybeFail("assign_awb");
      return {
        awb_assign_status: 1,
        response: { data: { awb_code: `MOCK${shipmentId}`, courier_company_id: courierId || 10, courier_name: courierId === 12 ? "Mock Air" : courierId === 11 ? "Mock Surface" : "Mock Express", shipment_id: shipmentId } },
      };
    },
    async generatePickup({ shipmentId }) {
      record("generatePickup", { shipmentId });
      maybeFail("pickup");
      return { pickup_status: 1, response: { pickup_scheduled_date: "2026-10-04 09:00:00", pickup_token_number: `PT${shipmentId}`, status: 1, pickup_generated_date: { date: "2026-10-03" } } };
    },
    async generateManifest({ shipmentId }) {
      record("generateManifest", { shipmentId });
      maybeFail("manifest");
      return { status: 1, manifest_url: `https://mock.shiprocket.local/manifest/${shipmentId}.pdf` };
    },
    async printManifest({ srOrderId }) {
      record("printManifest", { srOrderId });
      return { manifest_url: `https://mock.shiprocket.local/manifest/order-${srOrderId}.pdf` };
    },
    async generateLabel({ shipmentId }) {
      record("generateLabel", { shipmentId });
      maybeFail("label");
      return { label_created: 1, label_url: `https://mock.shiprocket.local/label/${shipmentId}.pdf` };
    },
    async printInvoice({ srOrderId }) {
      record("printInvoice", { srOrderId });
      maybeFail("invoice");
      return { is_invoice_created: true, invoice_url: `https://mock.shiprocket.local/invoice/${srOrderId}.pdf` };
    },
    async trackAwb(awb) {
      record("trackAwb", { awb });
      return {
        tracking_data: {
          track_status: 1,
          shipment_status: 3,
          shipment_track: [{ awb_code: awb, current_status: "Pickup Scheduled", edd: "2026-10-09", courier_name: "Mock Express" }],
          shipment_track_activities: [
            { date: "2026-10-03 12:00:00", status: "PUS", activity: "Pickup scheduled", location: "Ahmedabad", "sr-status": "3", "sr-status-label": "PICKUP SCHEDULED" },
          ],
          track_url: `https://mock.shiprocket.local/track/${awb}`,
          etd: "2026-10-09",
        },
      };
    },
    async trackShipment() {
      return {};
    },
    async findOrderByChannelOrderId(orderId) {
      record("findOrderByChannelOrderId", { orderId });
      return state.created.get(orderId) || null;
    },
    async getOrder() {
      return {};
    },
    async cancelOrders({ srOrderIds }) {
      record("cancelOrders", { srOrderIds });
      return { message: "Order cancelled successfully." };
    },
    async cancelShipmentsByAwb({ awbs }) {
      record("cancelShipmentsByAwb", { awbs });
      return { message: "Shipment cancelled" };
    },
  };
}

module.exports = { createShiprocketClient, ShiprocketError };
