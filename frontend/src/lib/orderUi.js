import { useCallback, useEffect, useRef, useState } from "react";
import api from "./api";

export const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export const PAYMENT_STYLE = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  expired: "bg-zinc-100 text-zinc-600",
  refunded: "bg-sky-100 text-sky-700",
  partially_refunded: "bg-sky-100 text-sky-700",
};

export const PAYMENT_LABEL = {
  paid: "Paid",
  pending: "Payment pending",
  failed: "Payment failed",
  expired: "Payment expired",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

export const FULFILLMENT_STYLE = {
  preparing: "bg-amber-50 text-amber-700 border-amber-200",
  pickup_scheduled: "bg-sky-50 text-sky-700 border-sky-200",
  picked_up: "bg-indigo-50 text-indigo-700 border-indigo-200",
  in_transit: "bg-indigo-50 text-indigo-700 border-indigo-200",
  out_for_delivery: "bg-violet-50 text-violet-700 border-violet-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  delivery_exception: "bg-rose-50 text-rose-700 border-rose-200",
  returned: "bg-zinc-100 text-zinc-700 border-zinc-200",
  cancelled: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export const FULFILLMENT_LABEL = {
  preparing: "Preparing",
  pickup_scheduled: "Pickup scheduled",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_exception: "Delivery exception",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const fmtDate = (iso, opts = {}) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...opts });
};
export const fmtDay = (iso) => fmtDate(iso, { hour: undefined, minute: undefined });

// Fetches an order the signed-in user owns and optionally polls (bounded) while `shouldPoll(order)` is true.
export function useOrder(orderId, { enabled = true, pollMs = 0, maxPolls = 0, shouldPoll = () => false } = {}) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const polls = useRef(0);

  const refresh = useCallback(async () => {
    if (!orderId) return null;
    try {
      const { data } = await api.get(`/orders/${orderId}`);
      setOrder(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e.response?.status === 404 ? "We couldn't find this order on your account." : "Could not load the order right now.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!enabled) return undefined;
    polls.current = 0;
    let timer;
    let active = true;
    const tick = async () => {
      const data = await refresh();
      if (!active || !pollMs) return;
      if (data && shouldPoll(data) && polls.current < maxPolls) {
        polls.current += 1;
        timer = setTimeout(tick, pollMs);
      }
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, enabled, refresh]);

  return { order, error, loading, refresh };
}
