import axios from "axios";
import productsData from "../data/products.json";

const backendUrl = process.env.REACT_APP_BACKEND_URL;

// Mock adapter for standalone / local development when backend is not configured
const mockAdapter = async (config) => {
  let rawUrl = (config.url || "").replace(/^(\/api)?/, "");
  if (!rawUrl.startsWith("/")) {
    rawUrl = "/" + rawUrl;
  }
  const [path, queryString] = rawUrl.split("?");
  const searchParams = new URLSearchParams(queryString || "");
  const category = config.params?.category || searchParams.get("category");

  // GET /products
  if (path === "/products" || path === "") {
    let result = productsData;
    if (category && category !== "all") {
      result = productsData.filter(
        (p) => p.category && p.category.toLowerCase() === category.toLowerCase()
      );
    }
    return {
      data: result,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }

  // GET /products/:id
  if (path.startsWith("/products/")) {
    const id = path.replace("/products/", "");
    const found = productsData.find((p) => p.id === id);
    if (found) {
      return {
        data: found,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    }
    const err = new Error("Product not found");
    err.response = { status: 404, data: { detail: "Product not found" } };
    throw err;
  }

  // GET /auth/me - check localStorage for simulated session or return 401 unauthenticated
  if (path === "/auth/me") {
    try {
      const stored = localStorage.getItem("crestus_user");
      if (stored) {
        return {
          data: JSON.parse(stored),
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      }
    } catch {}
    const err = new Error("Not authenticated");
    err.response = { status: 401, data: { detail: "Not authenticated" } };
    throw err;
  }

  // POST /auth/logout
  if (path === "/auth/logout") {
    try {
      localStorage.removeItem("crestus_user");
    } catch {}
    return {
      data: { ok: true },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }

  // GET /orders
  if (path === "/orders") {
    let orders = [];
    try {
      orders = JSON.parse(localStorage.getItem("crestus_orders") || "[]");
    } catch {}
    return {
      data: orders,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  }

  // GET /orders/track/:orderId
  if (path.startsWith("/orders/track/")) {
    const orderId = path.replace("/orders/track/", "");
    let orders = [];
    try {
      orders = JSON.parse(localStorage.getItem("crestus_orders") || "[]");
    } catch {}
    const found = orders.find((o) => o.order_id === orderId);
    if (found) {
      return {
        data: found,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    }
    const err = new Error("Order not found");
    err.response = { status: 404, data: { detail: "Order not found" } };
    throw err;
  }

  // POST /orders/create or /orders/verify -> send to Cashfree backend
  if (path === "/orders/create" || path === "/orders/verify") {
    const urls = [];
    if (process.env.REACT_APP_BACKEND_URL) {
      urls.push(`${process.env.REACT_APP_BACKEND_URL.replace(/\/+$/, "")}/api${path}`);
    }
    // Try local backend on port 8000
    urls.push(`http://localhost:8000/api${path}`);
    // Try proxied /api route
    urls.push(`/api${path}`);

    let lastErr = null;

    for (const endpoint of urls) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: typeof config.data === "string" ? config.data : JSON.stringify(config.data),
        });

        // Safely check content-type before parsing JSON to prevent
        // "Unexpected token doctype" / Safari pattern-mismatch errors
        const contentType = response.headers.get("content-type") || "";

        // If the server returned HTML (e.g. CRA fallback, proxy error page),
        // skip this endpoint and try the next one
        if (contentType.includes("text/html")) {
          lastErr = new Error("Received HTML instead of JSON — backend may not be running");
          lastErr.response = {
            status: response.status,
            data: { detail: "Backend server is not reachable. Please ensure it is running." },
          };
          continue;
        }

        let data;
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();
          // Guard against accidentally parsing HTML as text
          if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html")) {
            lastErr = new Error("Received HTML instead of JSON — backend may not be running");
            lastErr.response = {
              status: response.status,
              data: { detail: "Backend server is not reachable. Please ensure it is running." },
            };
            continue;
          }
          data = { detail: text || `HTTP ${response.status} ${response.statusText}` };
        }

        if (response.ok) {
          return {
            data,
            status: response.status,
            statusText: "OK",
            headers: {},
            config,
          };
        }
        lastErr = new Error(data.detail || data.message || "Order request failed");
        lastErr.response = { status: response.status, data };
      } catch (e) {
        lastErr = e;
      }
    }

    if (lastErr) {
      if (lastErr.response) throw lastErr;
      const err = new Error(
        "Could not reach payment server. Please ensure the backend is running on port 8000."
      );
      err.response = {
        status: 503,
        data: { detail: "Backend server is not reachable. Start it with: node server.js" },
      };
      throw err;
    }
  }

  // Fallback for unhandled mock routes
  return {
    data: {},
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  };
};

const isCrossOrigin = backendUrl && !backendUrl.startsWith(window.location.origin);

const api = axios.create({
  baseURL: backendUrl ? `${backendUrl.replace(/\/+$/, "")}/api` : "/api",
  // withCredentials causes CORS preflight failures when the backend uses
  // Access-Control-Allow-Origin: * (which Render does by default).
  // Only enable for same-origin or when the backend explicitly supports it.
  withCredentials: !isCrossOrigin,
  ...(backendUrl ? {} : { adapter: mockAdapter }),
});

// If backendUrl is set, also add a fallback interceptor in case the backend is unreachable
if (backendUrl) {
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const isNetworkOr404 =
        !error.response || error.response.status === 404 || error.code === "ERR_NETWORK";
      const config = error.config;
      if (isNetworkOr404 && config && config.url) {
        // Fallback to mock adapter for product routes
        if (config.url.includes("/products")) {
          console.warn("[API] Backend unavailable. Falling back to local catalog data.");
          return mockAdapter(config);
        }
        // Fallback to mock adapter for order routes (tries localhost:8000 then proxy)
        if (config.url.includes("/orders")) {
          console.warn("[API] Backend unavailable for orders. Trying direct fallback.");
          return mockAdapter(config);
        }
      }
      return Promise.reject(error);
    }
  );
}

export default api;
