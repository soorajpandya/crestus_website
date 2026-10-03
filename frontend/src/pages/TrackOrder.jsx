import { useState } from "react";
import { Search } from "lucide-react";
import { PageShell } from "../components/PageShell";
import api from "../lib/api";
import { inr, fmtDay, PAYMENT_LABEL } from "../lib/orderUi";
import { FulfillmentBadge, PaymentBadge, ShipmentTimeline } from "../components/OrderBits";

export default function TrackOrder() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const track = async (e) => {
    e.preventDefault();
    if (!orderId.trim() || !email.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      // Public lookup requires the order id plus the checkout e-mail; the response omits address and payment detail.
      const { data } = await api.get(`/orders/track/${encodeURIComponent(orderId.trim())}`, { params: { email: email.trim() } });
      setResult(data);
    } catch {
      setError("We couldn't find an order with that ID and email. Please check and try again.");
    } finally {
      setLoading(false);
    }
  };

  const paid = result && ["paid", "refunded", "partially_refunded"].includes(result.payment_status);

  return (
    <PageShell title="Track Order" eyebrow="Help" testId="track-order-page">
      <p>
        Enter your order ID (it starts with <span className="font-mono text-ink">ord_</span> and is shown on your My Orders page and confirmation email) along with the email you used at checkout.
      </p>
      <form onSubmit={track} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-6">
        <input
          data-testid="track-order-input"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="e.g. ord_1790761644444abc"
          className="border border-zinc-200 rounded-full px-5 py-3 text-sm focus:outline-none focus:border-brand-magenta transition-colors"
        />
        <input
          data-testid="track-order-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email used at checkout"
          className="border border-zinc-200 rounded-full px-5 py-3 text-sm focus:outline-none focus:border-brand-magenta transition-colors"
        />
        <button
          data-testid="track-order-submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 bg-ink text-white px-7 py-3 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors disabled:opacity-60"
        >
          <Search size={15} /> {loading ? "…" : "Track"}
        </button>
      </form>
      {error && <p data-testid="track-order-error" className="text-red-600 text-sm mt-4">{error}</p>}
      {result && (
        <div data-testid="track-order-result" className="border border-zinc-200 rounded-2xl p-6 mt-8 not-prose">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-400">Order</p>
              <p className="font-semibold text-ink">{result.order_id}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PaymentBadge status={result.payment_status} />
              <FulfillmentBadge status={result.fulfillment?.status} />
            </div>
          </div>
          <p className="text-sm text-zinc-600 mt-3">
            {paid
              ? result.shipment?.awb_code
                ? `${result.shipment.courier_name || "Courier"} · AWB ${result.shipment.awb_code}${result.shipment.etd ? ` · Estimated delivery ${fmtDay(result.shipment.etd)}` : ""}`
                : "Payment confirmed — preparing your shipment. Tracking details will be available once your shipment is booked."
              : PAYMENT_LABEL[result.payment_status] || result.payment_status}
          </p>
          {paid && (
            <div className="mt-6">
              <ShipmentTimeline tracking={result.tracking} fulfillmentStatus={result.fulfillment?.status} />
              {result.shipment?.track_url && (
                <a href={result.shipment.track_url} target="_blank" rel="noreferrer" className="inline-block mt-4 text-xs font-bold uppercase tracking-widest text-brand-magenta hover:underline">
                  Open courier tracking →
                </a>
              )}
            </div>
          )}
          <div className="border-t border-zinc-100 mt-5 pt-5 space-y-2">
            {result.items.map((it, i) => (
              <p key={i} className="text-sm text-zinc-600">{it.name} · Size {it.size} × {it.qty}</p>
            ))}
            <p className="font-semibold text-ink pt-2">Total: {inr(result.total)}</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
