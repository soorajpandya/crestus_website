import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { authErrorMessage } from "../lib/authUi";
import { ChevronRight } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { inr, fmtDate } from "../lib/orderUi";
import { OrderItems, PaymentBadge, FulfillmentBadge } from "../components/OrderBits";

export default function Orders() {
  const { user, loading, sendVerification, refreshUser } = useAuth();
  const [verificationAction, setVerificationAction] = useState("");
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

  const handleVerification = async (action) => {
    setVerificationAction(action);
    try {
      if (action === "send") {
        await sendVerification();
        toast.success("Verification email sent. Check your inbox and spam folder.");
      } else {
        await refreshUser();
      }
    } catch (error) {
      toast.error(authErrorMessage(error));
    } finally {
      setVerificationAction("");
    }
  };

  if (loading) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;

  if (!user) {
    return (
      <div data-testid="orders-login-required" className="pt-40 pb-24 text-center min-h-screen px-6">
        <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">Sign in to view orders</h1>
        <p className="text-zinc-500 mt-3 text-sm max-w-md mx-auto">
          Sign in with your email and password or Google to view your past and active orders.
        </p>
        <button
          data-testid="orders-login-button"
          onClick={() => navigate("/login?redirect=/orders")}
          className="mt-8 inline-flex items-center gap-3 bg-ink text-white px-8 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors shadow-sm"
        >
          Sign in
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
      {!user.emailVerified && <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p>Verify your email to find earlier orders placed with this address. New orders are already linked to your account.</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <button disabled={Boolean(verificationAction)} onClick={() => handleVerification("send")} className="font-semibold underline disabled:opacity-50">Resend verification email</button>
          <button disabled={Boolean(verificationAction)} onClick={() => handleVerification("refresh")} className="font-semibold underline disabled:opacity-50">I've verified my email</button>
        </div>
      </div>}
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
