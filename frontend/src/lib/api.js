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

const localProducts = (config) => {
  const url = (config.url || "").replace(/^\/+/, "");
  const id = url.startsWith("products/") ? url.slice("products/".length).split("?")[0] : null;
  if (id) {
    const found = productsData.find((p) => p.id === id);
    if (!found) return Promise.reject(Object.assign(new Error("Product not found"), { response: { status: 404, data: { detail: "Product not found" } } }));
    return Promise.resolve({ data: found, status: 200, statusText: "OK", headers: {}, config });
  }
  const category = config.params?.category;
  const list = category && category !== "all" ? productsData.filter((p) => (p.category || "").toLowerCase() === String(category).toLowerCase()) : productsData;
  return Promise.resolve({ data: list, status: 200, statusText: "OK", headers: {}, config });
};

// The catalogue is bundled, so product pages keep working if the API is unreachable. Order routes never fall back.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const config = error.config;
    const isProducts = config && /(^|\/)products(\/|$|\?)/.test(config.url || "");
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
