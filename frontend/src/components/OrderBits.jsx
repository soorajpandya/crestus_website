import { Link } from "react-router-dom";
import { Truck, FileText, ExternalLink, CheckCircle2, Circle } from "lucide-react";
import { inr, fmtDate, fmtDay, PAYMENT_STYLE, PAYMENT_LABEL, FULFILLMENT_STYLE, FULFILLMENT_LABEL } from "../lib/orderUi";

export function PaymentBadge({ status }) {
  return (
    <span data-testid="payment-badge" className={`text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${PAYMENT_STYLE[status] || "bg-zinc-100 text-zinc-600"}`}>
      {PAYMENT_LABEL[status] || status}
    </span>
  );
}

export function FulfillmentBadge({ status }) {
  if (!status) return null;
  return (
    <span data-testid="fulfillment-badge" className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${FULFILLMENT_STYLE[status] || "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
      <Truck size={12} /> {FULFILLMENT_LABEL[status] || status}
    </span>
  );
}

export function OrderItems({ items = [] }) {
  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={item.key || idx} className="flex items-center gap-4">
          {item.image && <img src={item.image} alt={item.name} className="w-12 h-16 object-cover rounded-lg bg-zinc-100" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{item.name}</p>
            <p className="text-xs text-zinc-500">
              {item.size ? `Size ${item.size}` : null}
              {item.variant?.color ? ` · ${item.variant.color}` : null}
              {` · Qty ${item.qty}`}
            </p>
          </div>
          <p className="text-sm font-semibold">{inr((item.unit_price ?? item.price) * item.qty)}</p>
        </div>
      ))}
    </div>
  );
}

export function PriceBreakdown({ totals }) {
  if (!totals) return null;
  const row = (label, value, strong) => (
    <div className={`flex justify-between text-sm ${strong ? "font-semibold text-ink pt-3 border-t border-zinc-200 mt-1" : "text-zinc-600"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div className="space-y-2">
      {row("Subtotal", inr(totals.subtotal))}
      {totals.discount > 0 && row("You saved", `− ${inr(totals.discount)}`)}
      {row("Shipping", totals.shipping > 0 ? inr(totals.shipping) : "Free")}
      {totals.tax_included > 0 && row(`Includes GST (${totals.tax_rate_percent}%)`, inr(totals.tax_included))}
      {row("Total", inr(totals.total), true)}
    </div>
  );
}

export function AddressBlock({ address, name, phone }) {
  if (!address) return null;
  return (
    <address className="not-italic text-sm text-zinc-600 leading-relaxed">
      <p className="font-semibold text-ink">{name || address.name}</p>
      <p>{address.line1}</p>
      {address.line2 && <p>{address.line2}</p>}
      <p>
        {address.city}, {address.state} {address.pincode}
      </p>
      <p>{address.country || "India"}</p>
      {(phone || address.phone) && <p className="mt-1">{phone || address.phone}</p>}
    </address>
  );
}

// Shipment card: courier, AWB, ETA, tracking action and invoice access.
export function ShipmentCard({ order, compact = false }) {
  const { payment, fulfillment, shipment } = order;
  if (payment.status !== "paid" && payment.status !== "refunded" && payment.status !== "partially_refunded") return null;
  const hasAwb = Boolean(shipment?.awb_code);
  const message = !hasAwb
    ? fulfillment.status === "cancelled"
      ? "This shipment was cancelled."
      : "Payment successful — preparing your shipment. Tracking details will be available once your shipment is booked."
    : null;
  return (
    <div data-testid="shipment-card" className="rounded-2xl border border-zinc-200 p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Delivery</p>
        <FulfillmentBadge status={fulfillment.status} />
      </div>
      {message && <p className="text-sm text-zinc-600">{message}</p>}
      {hasAwb && (
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-zinc-500">Courier</dt>
          <dd className="font-semibold text-right">{shipment.courier_name || "—"}</dd>
          <dt className="text-zinc-500">Tracking number</dt>
          <dd data-testid="awb-code" className="font-mono text-right break-all">{shipment.awb_code}</dd>
          {shipment.etd && (
            <>
              <dt className="text-zinc-500">Estimated delivery</dt>
              <dd className="font-semibold text-right">{fmtDay(shipment.etd)}</dd>
            </>
          )}
        </dl>
      )}
      {!compact && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to={`/orders/${order.order_id}`} data-testid="track-order-link" className="inline-flex items-center gap-2 bg-ink text-white px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
            <Truck size={14} /> Track order
          </Link>
          {shipment.track_url && (
            <a href={shipment.track_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-zinc-300 px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors">
              Courier tracking <ExternalLink size={13} />
            </a>
          )}
          {shipment.invoice_url && (
            <a href={shipment.invoice_url} target="_blank" rel="noreferrer" data-testid="invoice-link" className="inline-flex items-center gap-2 border border-zinc-300 px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors">
              <FileText size={14} /> Invoice
            </a>
          )}
        </div>
      )}
    </div>
  );
}

const TIMELINE_STEPS = ["preparing", "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery", "delivered"];

export function ShipmentTimeline({ tracking, fulfillmentStatus }) {
  const current = fulfillmentStatus || tracking?.status;
  const idx = TIMELINE_STEPS.indexOf(current);
  const exceptional = ["delivery_exception", "returned", "cancelled"].includes(current);
  const events = tracking?.events || [];
  return (
    <div data-testid="shipment-timeline" className="space-y-6">
      <ol className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {TIMELINE_STEPS.map((step, i) => {
          const done = idx >= i && !exceptional;
          return (
            <li key={step} className="flex flex-col items-center text-center gap-1.5">
              {done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-zinc-300" />}
              <span className={`text-[10px] uppercase tracking-wider ${done ? "text-ink font-semibold" : "text-zinc-400"}`}>{FULFILLMENT_LABEL[step]}</span>
            </li>
          );
        })}
      </ol>
      {exceptional && <p className="text-sm text-rose-600 font-medium">{FULFILLMENT_LABEL[current]} — our team is on it. Contact support if you need help.</p>}
      {events.length > 0 && (
        <ul className="border-l border-zinc-200 ml-2 space-y-4">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="pl-5 relative">
              <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-brand-magenta" />
              <p className="text-sm font-semibold text-ink">{e.label || FULFILLMENT_LABEL[e.status] || e.activity}</p>
              {e.activity && e.activity !== e.label && <p className="text-xs text-zinc-600">{e.activity}</p>}
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {fmtDate(e.at)}
                {e.location ? ` · ${e.location}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {events.length === 0 && !exceptional && <p className="text-sm text-zinc-500">Shipment updates will appear here as the courier scans your package.</p>}
    </div>
  );
}
