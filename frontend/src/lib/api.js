import axios from "axios";
import productsData from "../data/products.json";
import { auth } from "./firebase";

const backendUrl = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
const isLocalDev = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

// Production: REACT_APP_BACKEND_URL (or same-origin /api). Local dev without the env var: the Node backend on :8000.
const baseURL = backendUrl ? `${backendUrl}/api` : isLocalDev ? "http://localhost:8000/api" : "/api";

const api = axios.create({ baseURL, timeout: 30000 });

// Every request carries the signed-in user's Firebase ID token; the backend verifies it and enforces ownership.
api.interceptors.request.use(async (config) => {
  // The API's free Render instance can take over 50 seconds to wake up.
  // Keep admin access checks and reports alive through that first request.
  if (config.url === '/auth/me' || /^\/?admin(?:\/|$)/.test(config.url || '')) {
    config.timeout = 90000;
  }
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    } catch {}
  }
  return config;
});

const catalogRequest = (config) => {
  if (!config || (config.method || "get").toLowerCase() !== "get") return null;
  const [pathname, query = ""] = (config.url || "").split("?");
  const match = pathname.match(/^\/?products(?:\/([^/]+))?\/?$/);
  return match ? { id: match[1], category: config.params?.category ?? new URLSearchParams(query).get("category") } : null;
};

const validProduct = (product) => product && typeof product.id === "string" &&
  typeof product.name === "string" && Number.isFinite(product.price) &&
  Array.isArray(product.sizes) && product.sizes.every((size) => typeof size === "string");

const localProducts = (config) => {
  const { id, category } = catalogRequest(config);
  if (id) {
    const found = productsData.find((p) => p.id === id);
    if (!found) return Promise.reject(Object.assign(new Error("Product not found"), { response: { status: 404, data: { detail: "Product not found" } } }));
    return Promise.resolve({ data: found, status: 200, statusText: "OK", headers: {}, config });
  }
  const list = category && category !== "all" ? productsData.filter((p) => (p.category || "").toLowerCase() === String(category).toLowerCase()) : productsData;
  return Promise.resolve({ data: list, status: 200, statusText: "OK", headers: {}, config });
};

// Static hosts can return index.html with HTTP 200 for /api/products. Validate
// successful catalogue responses too, before page components use array methods.
// Only public catalogue GETs may use bundled data; order/auth routes never fall back.
api.interceptors.response.use(
  (response) => {
    const request = catalogRequest(response.config);
    if (!request) return response;
    const valid = request.id
      ? validProduct(response.data)
      : Array.isArray(response.data) && response.data.every(validProduct);
    if (valid) return response;
    console.warn("[API] Invalid catalog response. Falling back to local catalog data.");
    return localProducts(response.config);
  },
  (error) => {
    const config = error.config;
    const isProducts = catalogRequest(config);
    const unreachable = !error.response || error.response.status >= 500;
    if (isProducts && unreachable) {
      console.warn("[API] Backend unavailable. Falling back to local catalog data.");
      return localProducts(config);
    }
    return Promise.reject(error);
  }
);

export const apiErrorMessage = (e, fallback = "Something went wrong. Please try again.") => e?.response?.data?.detail || e?.message || fallback;

export default api;
