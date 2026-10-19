import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { inr, fmtDate, useOrder } from "../lib/orderUi";
import { OrderItems, PriceBreakdown, AddressBlock, ShipmentCard, ShipmentTimeline, PaymentBadge } from "../components/OrderBits";

export default function OrderDetail() {
  const { order_id: orderId } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { order, error, loading: orderLoading, refresh } = useOrder(orderId, {
    enabled: Boolean(user && orderId),
    pollMs: 15000,
    maxPolls: 8,
    shouldPoll: (o) => o.payment.status === "paid" && !o.shipment?.awb_code && o.fulfillment.status !== "cancelled",
  });

  useEffect(() => {
    if (!loading && !user) navigate(`/login?redirect=${encodeURIComponent(`/orders/${orderId}`)}`, { replace: true });
  }, [user, loading, navigate, orderId]);

  if (loading || !user || (orderLoading && !order && !error)) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;

  if (error || !order) {
    return (
      <div data-testid="order-detail-missing" className="pt-40 pb-24 text-center min-h-screen px-6">
        <h1 className="font-display font-semibold tracking-tighter text-4xl">Order not found</h1>
        <p className="text-zinc-500 mt-3 text-sm">{error || "We couldn't find this order on your account."}</p>
        <Link to="/orders" className="inline-block mt-8 bg-ink text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
          Back to my orders
        </Link>
      </div>
    );
  }

  const paid = ["paid", "refunded", "partially_refunded"].includes(order.payment.status);

  return (
    <div data-testid="order-detail-page" className="max-w-4xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <Link to="/orders" className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-ink transition-colors">
        <ArrowLeft size={14} /> My orders
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4 mt-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-400">Order</p>
          <h1 className="font-display font-semibold tracking-tighter text-3xl sm:text-4xl mt-1 break-all">{order.order_id}</h1>
          <p className="text-xs text-zinc-500 mt-1">Placed {fmtDate(order.created_at)}</p>
        </div>
        <div className="flex items-center gap-3">
          <PaymentBadge status={order.payment.status} />
          <span className="font-display text-2xl font-semibold">{inr(order.totals.total)}</span>
          <button onClick={refresh} aria-label="Refresh" className="p-2 rounded-full border border-zinc-200 hover:border-ink transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {order.payment.status === "pending" && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-3">
          <span>This order hasn't been paid yet.</span>
          <Link to={`/failed?order_id=${encodeURIComponent(order.order_id)}`} className="bg-ink text-white px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
            Complete payment
          </Link>
        </div>
      )}
      {["failed", "expired"].includes(order.payment.status) && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 flex flex-wrap items-center justify-between gap-3">
          <span>{order.payment.last_failure_reason || "Payment was not completed."}</span>
          <Link to={`/failed?order_id=${encodeURIComponent(order.order_id)}`} className="bg-ink text-white px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
            Retry payment
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-8">
        <div className="md:col-span-3 space-y-6">
          {paid && <ShipmentCard order={order} compact />}
          {paid && (
            <div className="rounded-2xl border border-zinc-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Shipment timeline</p>
              <ShipmentTimeline tracking={order.tracking} fulfillmentStatus={order.fulfillment.status} />
              {order.shipment?.track_url && (
                <a href={order.shipment.track_url} target="_blank" rel="noreferrer" className="inline-block mt-5 text-xs font-bold uppercase tracking-widest text-brand-magenta hover:underline">
                  Open courier tracking →
                </a>
              )}
            </div>
          )}
          <div className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Items</p>
            <OrderItems items={order.items} />
          </div>
        </div>
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Price breakdown</p>
            <PriceBreakdown totals={order.totals} />
            {order.payment.paid_at && <p className="text-[11px] text-zinc-400 mt-3">Paid {fmtDate(order.payment.paid_at)}{order.payment.payment_method ? ` via ${order.payment.payment_method}` : ""}</p>}
            {order.payment.refunds?.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-sky-700">
                {order.payment.refunds.map((r) => (
                  <li key={r.refund_id}>Refund {inr(r.amount)} · {r.status}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Shipping address</p>
            <AddressBlock address={order.shipping_address} name={order.customer?.name} phone={order.customer?.phone} />
          </div>
          {order.shipment?.invoice_url && (
            <a href={order.shipment.invoice_url} target="_blank" rel="noreferrer" data-testid="invoice-link" className="block text-center border border-zinc-300 px-5 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors">
              Download invoice
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
