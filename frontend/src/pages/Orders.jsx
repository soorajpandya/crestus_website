import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

const STATUS_STYLE = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

export default function Orders() {
  const { user, loading, login } = useAuth();
  const [orders, setOrders] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      api.get("/orders").then(({ data }) => setOrders(data)).catch(() => setOrders([]));
    }
  }, [user]);

  if (loading) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;

  if (!user) {
    return (
      <div data-testid="orders-login-required" className="pt-40 pb-24 text-center min-h-screen px-6">
        <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">Sign in to view orders</h1>
        <button
          data-testid="orders-login-button"
          onClick={login}
          className="mt-8 bg-ink text-white px-10 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div data-testid="orders-page" className="max-w-4xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl mb-12">My Orders</h1>
      {orders === null ? (
        <p className="text-zinc-400">Loading orders…</p>
      ) : orders.length === 0 ? (
        <div data-testid="orders-empty" className="text-center py-20">
          <p className="text-zinc-500">You haven't placed any orders yet.</p>
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
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${STATUS_STYLE[order.status] || "bg-zinc-100 text-zinc-600"}`}>
                    {order.status}
                  </span>
                  <span className="font-display text-lg font-semibold">{inr(order.amount)}</span>
                </div>
              </div>
              <div className="space-y-3">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <img src={item.image} alt={item.name} className="w-12 h-16 object-cover rounded-lg bg-zinc-100" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.name}</p>
                      <p className="text-xs text-zinc-500">Size {item.size} · Qty {item.qty}</p>
                    </div>
                    <p className="text-sm font-semibold">{inr(item.price * item.qty)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
