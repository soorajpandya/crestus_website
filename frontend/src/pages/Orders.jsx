import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { inr, fmtDate } from "../lib/orderUi";
import { OrderItems, PaymentBadge, FulfillmentBadge } from "../components/OrderBits";

export default function Orders() {
  const { user, loading, login } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return undefined;
    let isMounted = true;
    // Orders are persisted server-side and scoped to the signed-in user's token.
    api
      .get("/orders")
      .then(({ data }) => {
        if (isMounted) setOrders(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (isMounted) {
          setOrders([]);
          setError("We couldn't load your orders right now. Please try again shortly.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [user]);

  if (loading) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;

  if (!user) {
    return (
      <div data-testid="orders-login-required" className="pt-40 pb-24 text-center min-h-screen px-6">
        <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">Sign in to view orders</h1>
        <p className="text-zinc-500 mt-3 text-sm max-w-md mx-auto">
          Please sign in with your Google account to view your past and active orders.
        </p>
        <button
          data-testid="orders-login-button"
          onClick={login}
          className="mt-8 inline-flex items-center gap-3 bg-ink text-white px-8 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div data-testid="orders-page" className="max-w-4xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-10">
        <div>
          <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">My Orders</h1>
          <p className="text-xs text-zinc-500 mt-1">Viewing orders for {user.email || user.displayName}</p>
        </div>
      </div>
      {orders === null ? (
        <p className="text-zinc-400">Loading your orders…</p>
      ) : orders.length === 0 ? (
        <div data-testid="orders-empty" className="text-center py-20">
          <p className="text-zinc-500">{error || "You haven't placed any orders yet."}</p>
          <button
            data-testid="orders-go-shop"
            onClick={() => navigate("/shop")}
            className="mt-6 bg-ink text-white px-10 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
          >
            Start shopping
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => (
            <div key={order.order_id} data-testid={`order-${order.order_id}`} className="border border-zinc-100 rounded-2xl p-6 hover:border-zinc-200 transition-colors">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-zinc-400">Order</p>
                  <p className="font-semibold text-sm mt-0.5">{order.order_id}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{fmtDate(order.created_at)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <PaymentBadge status={order.payment?.status} />
                  <FulfillmentBadge status={order.fulfillment?.status} />
                  <span className="font-display text-lg font-semibold">{inr(order.totals?.total)}</span>
                </div>
              </div>
              <OrderItems items={order.items} />
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-zinc-500">
                  {order.shipment?.awb_code
                    ? `${order.shipment.courier_name || "Courier"} · AWB ${order.shipment.awb_code}`
                    : order.payment?.status === "paid"
                      ? "Tracking details will be available once your shipment is booked."
                      : order.payment?.status === "pending"
                        ? "Payment not completed yet."
                        : ""}
                </span>
                <div className="flex gap-2">
                  {["pending", "failed", "expired"].includes(order.payment?.status) && (
                    <Link to={`/failed?order_id=${encodeURIComponent(order.order_id)}`} className="border border-zinc-300 px-4 py-2 rounded-full font-bold uppercase tracking-widest hover:border-ink transition-colors">
                      Complete payment
                    </Link>
                  )}
                  <Link to={`/orders/${order.order_id}`} data-testid={`order-detail-${order.order_id}`} className="inline-flex items-center gap-1 bg-ink text-white px-4 py-2 rounded-full font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
                    {order.shipment?.awb_code ? "Track order" : "View details"} <ChevronRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
