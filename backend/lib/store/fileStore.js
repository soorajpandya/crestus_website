const fs = require("fs");
const path = require("path");
const { withLock } = require("../lock");
const { isHistoricalImport } = require('../historicalImport');

// JSON-file backed store for local development and automated tests. Same interface as firestoreStore.
function createFileStore({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const ordersFile = path.join(dataDir, "orders.json");
  const metaFile = path.join(dataDir, "meta.json");
  const subscribersFile = path.join(dataDir, "subscribers.json");

  const readJson = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return fallback;
    }
  };
  const writeJson = (file, value) => {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  };

  let orders = readJson(ordersFile, {});
  let meta = readJson(metaFile, {});
  let subscribers = readJson(subscribersFile, {});
  let orderRevision = 0;
  const persist = () => writeJson(ordersFile, orders);
  const persistSubscribers = () => writeJson(subscribersFile, subscribers);
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

  const all = () => Object.values(orders);

  return {
    driver: "file",
    get orderRevision() { return orderRevision; },
    async getOrder(orderId) {
      return clone(orders[orderId] || null);
    },
    async putOrder(order) {
      orders[order.order_id] = clone(order);
      persist();
      orderRevision++;
      return clone(order);
    },
    // Atomic read-modify-write. mutator(order) returns the new order, or null to leave it untouched.
    async updateOrder(orderId, mutator) {
      return withLock(`file:${orderId}`, async () => {
        const current = clone(orders[orderId] || null);
        if (!current) return null;
        const next = await mutator(current);
        if (!next) return current;
        orders[orderId] = clone(next);
        persist();
        orderRevision++;
        return clone(next);
      });
    },
    async listOrdersForUser({ userId, email }) {
      const target = (email || "").toLowerCase();
      return all()
        .filter((o) => !isHistoricalImport(o))
        .filter((o) => (userId && o.user_id === userId) || (target && (o.customer?.email || "").toLowerCase() === target))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map(clone);
    },
    async listOrders({ limit = 100, paymentStatus, fulfillmentStatus } = {}) {
      return all()
        .filter((o) => !paymentStatus || o.payment?.status === paymentStatus)
        .filter((o) => !fulfillmentStatus || o.fulfillment?.status === fulfillmentStatus)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limit)
        .map(clone);
    },
    async findOrderByAwb(awb) {
      return clone(all().find((o) => o.shipment?.awb_code === awb) || null);
    },
    async findOrderByShiprocketOrderId(srOrderId) {
      return clone(all().find((o) => String(o.shipment?.sr_order_id || "") === String(srOrderId)) || null);
    },
    async listDueFulfillmentJobs(now = Date.now()) {
      return all()
        .filter((o) => o.fulfillment?.due === true && (!o.fulfillment.next_run_at || Date.parse(o.fulfillment.next_run_at) <= now))
        .map(clone);
    },
    async listActiveShipments() {
      return all().filter((o) => o.tracking?.active === true).map(clone);
    },
    async listPendingPayments() {
      return all().filter((o) => o.payment?.status === "pending").map(clone);
    },
    async getMeta(key) {
      return meta[key] ?? null;
    },
    async setMeta(key, value) {
      meta[key] = value;
      writeJson(metaFile, meta);
    },
    async findSubscriberByEmail(email) {
      const target = (email || "").toLowerCase().trim();
      const list = Object.values(subscribers);
      return clone(list.find((s) => (s.email || "").toLowerCase().trim() === target) || null);
    },
    async addSubscriber(sub) {
      const id = sub.id || `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const record = {
        id,
        email: sub.email.toLowerCase().trim(),
        created_at: sub.created_at || new Date().toISOString(),
        source: sub.source || "homepage_newsletter",
        status: sub.status || "active",
      };
      subscribers[id] = clone(record);
      persistSubscribers();
      return clone(record);
    },
    async listSubscribers() {
      return Object.values(subscribers).map(clone).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    async _reset() {
      orders = {};
      orderRevision++;
      meta = {};
      subscribers = {};
      persist();
      persistSubscribers();
      writeJson(metaFile, meta);
    },
  };
}

module.exports = { createFileStore };
