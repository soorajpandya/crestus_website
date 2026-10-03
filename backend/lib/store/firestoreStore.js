// Firestore-backed store (firebase-admin). Orders live in `orders/{order_id}`; small key/value state in `meta/{key}`.
function createFirestoreStore({ db }) {
  const orders = db.collection("orders");
  const metaCol = db.collection("meta");
  const snapToList = (snap) => snap.docs.map((d) => d.data());

  return {
    driver: "firestore",
    async getOrder(orderId) {
      const doc = await orders.doc(orderId).get();
      return doc.exists ? doc.data() : null;
    },
    async putOrder(order) {
      await orders.doc(order.order_id).set(order);
      return order;
    },
    async updateOrder(orderId, mutator) {
      const ref = orders.doc(orderId);
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return null;
        const current = doc.data();
        const next = await mutator(current);
        if (!next) return current;
        tx.set(ref, next);
        return next;
      });
    },
    async listOrdersForUser({ userId, email }) {
      const results = new Map();
      if (userId) {
        snapToList(await orders.where("user_id", "==", userId).get()).forEach((o) => results.set(o.order_id, o));
      }
      if (email) {
        snapToList(await orders.where("customer.email", "==", email.toLowerCase()).get()).forEach((o) => results.set(o.order_id, o));
      }
      return Array.from(results.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    async listOrders({ limit = 100, paymentStatus, fulfillmentStatus } = {}) {
      let q = orders;
      if (paymentStatus) q = q.where("payment.status", "==", paymentStatus);
      if (fulfillmentStatus) q = q.where("fulfillment.status", "==", fulfillmentStatus);
      const list = snapToList(await q.get());
      return list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
    },
    async findOrderByAwb(awb) {
      const snap = await orders.where("shipment.awb_code", "==", awb).limit(1).get();
      return snap.empty ? null : snap.docs[0].data();
    },
    async findOrderByShiprocketOrderId(srOrderId) {
      const snap = await orders.where("shipment.sr_order_id", "==", String(srOrderId)).limit(1).get();
      return snap.empty ? null : snap.docs[0].data();
    },
    async listDueFulfillmentJobs(now = Date.now()) {
      const list = snapToList(await orders.where("fulfillment.due", "==", true).get());
      return list.filter((o) => !o.fulfillment.next_run_at || Date.parse(o.fulfillment.next_run_at) <= now);
    },
    async listActiveShipments() {
      return snapToList(await orders.where("tracking.active", "==", true).get());
    },
    async listPendingPayments() {
      return snapToList(await orders.where("payment.status", "==", "pending").get());
    },
    async getMeta(key) {
      const doc = await metaCol.doc(key).get();
      return doc.exists ? doc.data().value ?? null : null;
    },
    async setMeta(key, value) {
      await metaCol.doc(key).set({ value, updated_at: new Date().toISOString() });
    },
  };
}

module.exports = { createFirestoreStore };
