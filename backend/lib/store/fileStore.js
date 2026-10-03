const fs = require("fs");
const path = require("path");
const { withLock } = require("../lock");

// JSON-file backed store for local development and automated tests. Same interface as firestoreStore.
function createFileStore({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const ordersFile = path.join(dataDir, "orders.json");
  const metaFile = path.join(dataDir, "meta.json");

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
  const persist = () => writeJson(ordersFile, orders);
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

  const all = () => Object.values(orders);

  return {
    driver: "file",
    async getOrder(orderId) {
      return clone(orders[orderId] || null);
    },
    async putOrder(order) {
      orders[order.order_id] = clone(order);
      persist();
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
        return clone(next);
      });
    },
    async listOrdersForUser({ userId, email }) {
      const target = (email || "").toLowerCase();
      return all()
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
    async _reset() {
      orders = {};
      meta = {};
      persist();
      writeJson(metaFile, meta);
    },
  };
}

module.exports = { createFileStore };
