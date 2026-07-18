import { useState } from "react";
import { Search, PackageCheck, PackageX, Clock } from "lucide-react";
import { PageShell } from "../components/PageShell";
import api from "../lib/api";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

const STATUS = {
  paid: { icon: PackageCheck, text: "Payment confirmed — being prepared for dispatch", cls: "bg-emerald-100 text-emerald-700" },
  pending: { icon: Clock, text: "Payment pending", cls: "bg-amber-100 text-amber-700" },
  failed: { icon: PackageX, text: "Payment failed", cls: "bg-red-100 text-red-700" },
};

export default function TrackOrder() {
  const [orderId, setOrderId] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const track = async (e) => {
    e.preventDefault();
    if (!orderId.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const { data } = await api.get(`/orders/track/${orderId.trim()}`);
      setResult(data);
    } catch {
      setError("We couldn't find an order with that ID. Please check and try again.");
    } finally {
      setLoading(false);
    }
  };

  const st = result && (STATUS[result.status] || STATUS.pending);

  return (
    <PageShell title="Track Order" eyebrow="Help" testId="track-order-page">
      <p>Enter your order ID (it starts with <span className="font-mono text-ink">ord_</span> and is shown on your My Orders page and confirmation email).</p>
      <form onSubmit={track} className="flex gap-3 mt-6">
        <input
          data-testid="track-order-input"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="e.g. ord_a1b2c3d4e5f6"
          className="flex-1 border border-zinc-200 rounded-full px-5 py-3 text-sm focus:outline-none focus:border-brand-magenta transition-colors"
        />
        <button
          data-testid="track-order-submit"
          disabled={loading}
          className="inline-flex items-center gap-2 bg-ink text-white px-7 py-3 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors disabled:opacity-60"
        >
          <Search size={15} /> {loading ? "…" : "Track"}
        </button>
      </form>
      {error && <p data-testid="track-order-error" className="text-red-600 text-sm mt-4">{error}</p>}
      {result && (
        <div data-testid="track-order-result" className="border border-zinc-200 rounded-2xl p-6 mt-8">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-400">Order</p>
              <p className="font-semibold text-ink">{result.order_id}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full ${st.cls}`}>
              <st.icon size={13} /> {result.status}
            </span>
          </div>
          <p className="text-sm text-zinc-600 mt-3">{st.text}</p>
          <div className="border-t border-zinc-100 mt-5 pt-5 space-y-2">
            {result.items.map((it, i) => (
              <p key={i} className="text-sm text-zinc-600">{it.name} · Size {it.size} × {it.qty}</p>
            ))}
            <p className="font-semibold text-ink pt-2">Total: {inr(result.amount)}</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
