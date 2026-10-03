import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Clock, XCircle, RefreshCw } from "lucide-react";
import api, { apiErrorMessage } from "../lib/api";
import { track } from "../lib/firebase";
import { openCashfreeCheckout } from "../lib/cashfree";
import { inr, useOrder } from "../lib/orderUi";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { OrderItems, PriceBreakdown, AddressBlock, ShipmentCard, PaymentBadge } from "../components/OrderBits";

const PENDING_POLL_MS = 3000;
const PENDING_MAX_POLLS = 40; // ~2 minutes
const SUCCESS_POLL_MS = 8000;
const SUCCESS_MAX_POLLS = 22; // ~3 minutes waiting for the AWB

function Shell({ testId, icon: Icon, tone, title, subtitle, children }) {
  return (
    <div data-testid={testId} className="max-w-3xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <div className="text-center mb-10">
        <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${tone}`}>
          <Icon size={28} />
        </div>
        <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl mt-5">{title}</h1>
        {subtitle && <p className="text-zinc-500 mt-3 text-sm max-w-md mx-auto">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// Redirects to login (preserving the result URL) when signed out; returns the order id from the query string.
function useResultGate() {
  const [params] = useSearchParams();
  const orderId = params.get("order_id") || "";
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) {
      const target = `${window.location.pathname}${window.location.search}`;
      navigate(`/login?redirect=${encodeURIComponent(target)}`, { replace: true });
    }
  }, [user, loading, navigate]);
  return { orderId, user, loading };
}

function MissingOrder() {
  return (
    <div className="text-center">
      <p className="text-zinc-600 text-sm">We couldn't find that order on your account.</p>
      <Link to="/orders" className="inline-block mt-6 bg-ink text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
        Go to my orders
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PaymentPending() {
  const { orderId, user, loading } = useResultGate();
  const navigate = useNavigate();
  const [status, setStatus] = useState("verifying"); // verifying | timeout | missing
  const attempts = useRef(0);

  useEffect(() => {
    if (loading || !user || !orderId) return undefined;
    let active = true;
    let timer;
    const check = async () => {
      try {
        const { data } = await api.post(`/orders/${orderId}/verify`);
        if (!active) return;
        if (data.paid) return navigate(`/success?order_id=${encodeURIComponent(orderId)}`, { replace: true });
        // A stale "failed" from an earlier attempt can precede Cashfree flipping to PAID; give it a few polls.
        if (data.payment_status === "expired" || (data.payment_status === "failed" && attempts.current >= 3)) {
          return navigate(`/failed?order_id=${encodeURIComponent(orderId)}`, { replace: true });
        }
      } catch (e) {
        if (!active) return;
        if (e.response?.status === 404) return setStatus("missing");
      }
      attempts.current += 1;
      if (attempts.current >= PENDING_MAX_POLLS) return setStatus("timeout");
      timer = setTimeout(check, PENDING_POLL_MS);
    };
    check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [orderId, user, loading, navigate]);

  if (loading || !user) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  if (!orderId || status === "missing") {
    return (
      <Shell testId="payment-pending-page" icon={Clock} tone="bg-amber-100 text-amber-700" title="Order not found">
        <MissingOrder />
      </Shell>
    );
  }
  return (
    <Shell
      testId="payment-pending-page"
      icon={Clock}
      tone="bg-amber-100 text-amber-700"
      title={status === "timeout" ? "Still verifying" : "Your payment is being verified"}
      subtitle={
        status === "timeout"
          ? "Your bank is taking longer than usual to confirm. You can safely close this page — we'll keep checking and your order will appear in order history as soon as it's confirmed."
          : "Please don't refresh or press back. This usually takes a few seconds."
      }
    >
      <div className="text-center space-y-4">
        <p className="text-xs uppercase tracking-widest text-zinc-400">Order</p>
        <p className="font-mono text-sm">{orderId}</p>
        {status === "verifying" && <RefreshCw className="mx-auto animate-spin text-zinc-400" size={20} />}
        {status === "timeout" && (
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button onClick={() => { attempts.current = 0; setStatus("verifying"); }} className="bg-ink text-white px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
              Check again
            </button>
            <Link to={`/orders/${orderId}`} className="border border-zinc-300 px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors">
              View order
            </Link>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
export function PaymentSuccess() {
  const { orderId, user, loading } = useResultGate();
  const navigate = useNavigate();
  const { removeItems } = useCart();
  const { order, error, loading: orderLoading } = useOrder(orderId, {
    enabled: Boolean(user && orderId),
    pollMs: SUCCESS_POLL_MS,
    maxPolls: SUCCESS_MAX_POLLS,
    shouldPoll: (o) => o.payment.status === "paid" && !o.shipment?.awb_code && o.fulfillment.status !== "cancelled",
  });

  // Payment truth comes from the backend: unpaid orders are sent to the right page.
  useEffect(() => {
    if (!order) return;
    if (order.payment.status === "pending") navigate(`/pending?order_id=${encodeURIComponent(orderId)}`, { replace: true });
    else if (["failed", "expired"].includes(order.payment.status)) navigate(`/failed?order_id=${encodeURIComponent(orderId)}`, { replace: true });
  }, [order, orderId, navigate]);

  // Clear only the purchased lines, once, after verified payment.
  useEffect(() => {
    if (!order || order.payment.status !== "paid") return;
    const flag = `crestus_order_done_${order.order_id}`;
    if (localStorage.getItem(flag)) return;
    removeItems(order.items.map((i) => i.key));
    track("purchase", {
      transaction_id: order.order_id,
      currency: order.totals.currency,
      value: order.totals.total,
      shipping: order.totals.shipping,
      items: order.items.map((i) => ({ item_id: i.product_id, item_name: i.name, item_variant: i.size, price: i.unit_price, quantity: i.qty })),
    });
    localStorage.setItem(flag, "1");
  }, [order, removeItems]);

  if (loading || !user || (orderLoading && !order && !error)) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  if (!orderId || error || !order) {
    return (
      <Shell testId="payment-success-page" icon={CheckCircle2} tone="bg-zinc-100 text-zinc-500" title="Order not found">
        <MissingOrder />
      </Shell>
    );
  }
  if (order.payment.status !== "paid" && order.payment.status !== "refunded" && order.payment.status !== "partially_refunded") return null;

  return (
    <Shell testId="payment-success-page" icon={CheckCircle2} tone="bg-emerald-100 text-emerald-700" title="Payment successful" subtitle={order.shipment?.awb_code ? "Your shipment has been booked." : "Payment successful — preparing your shipment."}>
      <div className="space-y-6">
        <div className="rounded-2xl border border-zinc-200 p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-400">Order number</p>
            <p data-testid="success-order-id" className="font-mono text-sm mt-0.5">{order.order_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <PaymentBadge status={order.payment.status} />
            <span className="font-display text-xl font-semibold">{inr(order.payment.amount_paid ?? order.totals.total)}</span>
          </div>
        </div>

        <ShipmentCard order={order} />

        <div className="grid sm:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Items</p>
            <OrderItems items={order.items} />
          </div>
          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Amount paid</p>
              <PriceBreakdown totals={order.totals} />
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Shipping to</p>
              <AddressBlock address={order.shipping_address} name={order.customer?.name} phone={order.customer?.phone} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <Link to="/orders" className="border border-zinc-300 px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors">
            My orders
          </Link>
          <Link to="/shop" className="bg-ink text-white px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
            Continue shopping
          </Link>
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
export function PaymentFailed() {
  const { orderId, user, loading } = useResultGate();
  const navigate = useNavigate();
  const { order, error, loading: orderLoading, refresh } = useOrder(orderId, { enabled: Boolean(user && orderId) });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (order && ["paid", "refunded", "partially_refunded"].includes(order.payment.status)) {
      navigate(`/success?order_id=${encodeURIComponent(orderId)}`, { replace: true });
    }
  }, [order, orderId, navigate]);

  const retry = async () => {
    setRetrying(true);
    try {
      // Backend re-checks Cashfree first; an already-paid order is never charged again.
      const { data } = await api.post(`/orders/${orderId}/retry-payment`);
      if (data.paid) return navigate(`/success?order_id=${encodeURIComponent(orderId)}`, { replace: true });
      const result = await openCashfreeCheckout({ paymentSessionId: data.payment_session_id, environment: data.environment });
      if (result?.error && !result?.redirect && !result?.paymentDetails) {
        toast.error(result.error.message || "Payment was not completed");
        await refresh();
        return;
      }
      navigate(`/pending?order_id=${encodeURIComponent(orderId)}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not restart payment. Please try again."));
    } finally {
      setRetrying(false);
    }
  };

  if (loading || !user || (orderLoading && !order && !error)) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  if (!orderId || error || !order) {
    return (
      <Shell testId="payment-failed-page" icon={XCircle} tone="bg-zinc-100 text-zinc-500" title="Order not found">
        <MissingOrder />
      </Shell>
    );
  }
  const isPending = order.payment.status === "pending";
  return (
    <Shell
      testId="payment-failed-page"
      icon={isPending ? Clock : XCircle}
      tone={isPending ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}
      title={isPending ? "Payment not completed" : order.payment.status === "expired" ? "Payment expired" : "Payment failed"}
      subtitle={order.payment.last_failure_reason || "No money was captured for this order. You can retry the payment — your bag and address are saved."}
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-zinc-200 p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-400">Order number</p>
            <p className="font-mono text-sm mt-0.5">{order.order_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <PaymentBadge status={order.payment.status} />
            <span className="font-display text-xl font-semibold">{inr(order.totals.total)}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Items</p>
          <OrderItems items={order.items} />
        </div>
        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <button data-testid="retry-payment" onClick={retry} disabled={retrying} className="inline-flex items-center gap-2 bg-brand-magenta text-white px-8 py-3.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-darkorange transition-colors disabled:opacity-60">
            <RefreshCw size={14} className={retrying ? "animate-spin" : ""} /> {retrying ? "Starting…" : `Retry payment · ${inr(order.totals.total)}`}
          </button>
          <Link to="/orders" className="border border-zinc-300 px-6 py-3.5 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors">
            My orders
          </Link>
        </div>
      </div>
    </Shell>
  );
}
