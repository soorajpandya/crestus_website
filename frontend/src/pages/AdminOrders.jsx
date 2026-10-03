import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, FileText, RefreshCw, Truck, XCircle, IndianRupee } from "lucide-react";
import api, { apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { inr, fmtDate } from "../lib/orderUi";
import { OrderItems, PriceBreakdown, AddressBlock, PaymentBadge, FulfillmentBadge, ShipmentTimeline } from "../components/OrderBits";

const STAGES = ["serviceability", "create_order", "assign_awb", "pickup", "manifest", "label", "invoice"];

const JOB_STYLE = {
  not_started: "bg-zinc-100 text-zinc-600",
  queued: "bg-sky-100 text-sky-700",
  processing: "bg-sky-100 text-sky-700",
  retry_wait: "bg-amber-100 text-amber-700",
  needs_attention: "bg-rose-100 text-rose-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-zinc-100 text-zinc-600",
};

function useAdminGate() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`, { replace: true });
  }, [user, loading, navigate]);
  return { ready: !loading && Boolean(user), isAdmin };
}

function Forbidden() {
  return (
    <div className="pt-40 pb-24 text-center min-h-screen px-6">
      <h1 className="font-display font-semibold tracking-tighter text-4xl">Admin access required</h1>
      <p className="text-zinc-500 mt-3 text-sm">Your account doesn't have permission to view this page.</p>
    </div>
  );
}

export function AdminOrders() {
  const { ready, isAdmin } = useAdminGate();
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!ready || !isAdmin) return;
    const params = {};
    if (filter === "attention") params.fulfillment_status = "needs_attention";
    if (filter === "paid") params.payment_status = "paid";
    if (filter === "pending") params.payment_status = "pending";
    api.get("/admin/orders", { params }).then(({ data }) => setOrders(data)).catch((e) => toast.error(apiErrorMessage(e)));
  }, [ready, isAdmin, filter]);

  if (!ready) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  if (!isAdmin) return <Forbidden />;

  return (
    <div data-testid="admin-orders-page" className="max-w-6xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <h1 className="font-display font-semibold tracking-tighter text-4xl">Orders & fulfillment</h1>
        <div className="flex gap-2 text-xs">
          {[
            ["all", "All"],
            ["attention", "Needs attention"],
            ["paid", "Paid"],
            ["pending", "Unpaid"],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`px-4 py-2 rounded-full font-bold uppercase tracking-widest border transition-colors ${filter === k ? "bg-ink text-white border-ink" : "border-zinc-300 hover:border-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {orders === null ? (
        <p className="text-zinc-400">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-zinc-500">No orders match this filter.</p>
      ) : (
        <div className="overflow-x-auto border border-zinc-200 rounded-2xl">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="text-left px-4 py-3">Order</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Payment</th>
                <th className="text-left px-4 py-3">Fulfillment job</th>
                <th className="text-left px-4 py-3">Shipment</th>
                <th className="text-right px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="px-4 py-3">
                    <Link to={`/admin/orders/${o.order_id}`} className="font-mono text-xs text-brand-magenta hover:underline">{o.order_id}</Link>
                    <p className="text-[11px] text-zinc-400">{fmtDate(o.created_at)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{o.customer?.name}</p>
                    <p className="text-[11px] text-zinc-500">{o.customer?.email}</p>
                  </td>
                  <td className="px-4 py-3"><PaymentBadge status={o.payment?.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${JOB_STYLE[o.fulfillment?.status] || "bg-zinc-100 text-zinc-600"}`}>{o.fulfillment?.status?.replace("_", " ")}</span>
                    {o.fulfillment?.status === "needs_attention" && <p className="text-[11px] text-rose-600 mt-1 max-w-[220px] truncate">{o.fulfillment.last_error?.message}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <FulfillmentBadge status={o.customer_fulfillment_status} />
                    {o.shipment?.awb_code && <p className="font-mono text-[11px] text-zinc-500 mt-1">{o.shipment.courier_name} · {o.shipment.awb_code}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(o.totals?.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminOrderDetail() {
  const { order_id: orderId } = useParams();
  const { ready, isAdmin } = useAdminGate();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [stage, setStage] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    api.get(`/admin/orders/${orderId}`).then(({ data }) => setOrder(data)).catch((e) => setError(apiErrorMessage(e)));
  }, [orderId]);

  useEffect(() => {
    if (ready && isAdmin) load();
  }, [ready, isAdmin, load]);

  const act = async (label, fn) => {
    setBusy(label);
    try {
      const { data } = await fn();
      setOrder(data);
      toast.success(`${label} done`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy("");
    }
  };

  if (!ready) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  if (!isAdmin) return <Forbidden />;
  if (error) return <div className="pt-40 text-center text-rose-600 min-h-screen">{error}</div>;
  if (!order) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;

  const f = order.fulfillment || {};
  const s = order.shipment || {};
  const canRetry = order.payment.status === "paid" && !["completed", "cancelled"].includes(f.status);
  const canCancel = s.sr_order_id && f.status !== "cancelled" && !["picked_up", "in_transit", "out_for_delivery", "delivered"].includes(order.tracking?.status);
  const refunded = (order.payment.refunds || []).reduce((sum, r) => sum + Number(r.amount), 0);
  const refundable = Math.max(0, Number(order.payment.amount_paid || 0) - refunded);

  return (
    <div data-testid="admin-order-detail" className="max-w-6xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <Link to="/admin/orders" className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-ink transition-colors">
        <ArrowLeft size={14} /> All orders
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4 mt-4 mb-8">
        <div>
          <h1 className="font-display font-semibold tracking-tighter text-3xl break-all">{order.order_id}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {order.customer?.name} · {order.customer?.email} · {order.customer?.phone} · {fmtDate(order.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PaymentBadge status={order.payment.status} />
          <span className={`text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${JOB_STYLE[f.status] || ""}`}>job: {f.status?.replace("_", " ")}</span>
          <FulfillmentBadge status={order.customer_fulfillment_status} />
          <span className="font-display text-2xl font-semibold">{inr(order.totals.total)}</span>
        </div>
      </div>

      {f.status === "needs_attention" && f.last_error && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <p className="font-semibold flex items-center gap-2"><AlertTriangle size={16} /> Fulfillment stopped at stage “{f.last_error.stage}” ({f.last_error.code})</p>
          <p className="mt-1">{f.last_error.message}</p>
          {f.last_error.data && <pre className="mt-3 text-[11px] bg-white/70 rounded-lg p-3 overflow-x-auto">{JSON.stringify(f.last_error.data, null, 2)}</pre>}
        </div>
      )}
      {order.alerts?.some((a) => a.type === "payment_amount_mismatch") && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <p className="font-semibold">Payment amount mismatch detected — verify manually in the Cashfree dashboard before fulfilling.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Identifiers</p>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["Cashfree order id", order.payment.cashfree_order_id],
                ["cf_order_id", order.payment.cf_order_id],
                ["cf_payment_id", order.payment.cf_payment_id],
                ["Payment method", order.payment.payment_method],
                ["Confirmed via", order.payment.confirmed_via],
                ["Shiprocket order id", s.sr_order_id],
                ["Shipment id", s.sr_shipment_id],
                ["Courier", s.courier_name ? `${s.courier_name} (#${s.courier_company_id})` : null],
                ["AWB", s.awb_code],
                ["Pickup", s.pickup?.scheduled_date ? `${s.pickup.scheduled_date} · ${s.pickup.token || ""}` : null],
                ["Quoted courier rate", s.selected_courier_rate != null ? inr(s.selected_courier_rate) : null],
                ["Shipping charged", inr(order.totals.shipping)],
                ["Rate variance", s.shipping_cost_variance != null ? inr(s.shipping_cost_variance) : null],
                ["Package", `${order.package.weight_kg} kg · ${order.package.length_cm}×${order.package.breadth_cm}×${order.package.height_cm} cm`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="font-mono text-xs text-right break-all">{v || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Tracking</p>
            <ShipmentTimeline tracking={order.tracking} fulfillmentStatus={order.customer_fulfillment_status} />
            <p className="text-[11px] text-zinc-400 mt-4">Raw provider status: {order.tracking?.raw_status || "—"} ({order.tracking?.raw_status_id ?? "—"}) · last event {fmtDate(order.tracking?.last_event_at) || "—"}</p>
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Items</p>
            <OrderItems items={order.items} />
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Fulfillment history</p>
            <ul className="space-y-1 text-xs font-mono">
              {(f.history || []).slice().reverse().map((h, i) => (
                <li key={i} className={h.ok ? "text-zinc-600" : "text-rose-600"}>
                  {fmtDate(h.at)} · {h.stage} · {h.ok ? "ok" : "failed"}{h.message ? ` · ${h.message}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Actions</p>
            <button disabled={Boolean(busy)} onClick={() => act("Payment re-check", () => api.post(`/admin/orders/${orderId}/payment/verify`))} className="w-full inline-flex items-center justify-center gap-2 border border-zinc-300 px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors disabled:opacity-50">
              <RefreshCw size={14} /> Re-verify payment with Cashfree
            </button>
            {canRetry && (
              <div className="space-y-2 pt-2">
                <select value={stage} onChange={(e) => setStage(e.target.value)} className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-xs">
                  <option value="">Resume from current stage ({f.stage || "start"})</option>
                  {STAGES.map((st) => (
                    <option key={st} value={st}>Restart from: {st}</option>
                  ))}
                </select>
                <button disabled={Boolean(busy)} onClick={() => act("Fulfillment retry", () => api.post(`/admin/orders/${orderId}/fulfillment/retry`, stage ? { stage } : {}))} className="w-full inline-flex items-center justify-center gap-2 bg-ink text-white px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors disabled:opacity-50">
                  <Truck size={14} /> Retry fulfillment
                </button>
              </div>
            )}
            {s.awb_code && (
              <button disabled={Boolean(busy)} onClick={() => act("Tracking refresh", () => api.post(`/admin/orders/${orderId}/tracking/refresh`))} className="w-full inline-flex items-center justify-center gap-2 border border-zinc-300 px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:border-ink transition-colors disabled:opacity-50">
                <RefreshCw size={14} /> Refresh tracking from Shiprocket
              </button>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Documents</p>
            {[
              ["Shipping label", s.label_url],
              ["Manifest", s.manifest_url],
              ["Invoice", s.invoice_url],
            ].map(([label, url]) => (
              <a key={label} href={url || undefined} target="_blank" rel="noreferrer" className={`flex items-center gap-2 text-sm ${url ? "text-brand-magenta hover:underline" : "text-zinc-400 pointer-events-none"}`}>
                <FileText size={14} /> {label} {url ? "" : "(not generated)"}
              </a>
            ))}
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Cancellation & refund</p>
            <p className="text-[11px] text-zinc-500">Shipment cancellation and payment refund are separate operations.</p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown in history)" className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-xs" />
            <button disabled={!canCancel || Boolean(busy)} onClick={() => act("Shipment cancellation", () => api.post(`/admin/orders/${orderId}/fulfillment/cancel`, { reason }))} className="w-full inline-flex items-center justify-center gap-2 border border-rose-300 text-rose-700 px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-rose-50 transition-colors disabled:opacity-40">
              <XCircle size={14} /> Cancel shipment in Shiprocket
            </button>
            <div className="flex gap-2">
              <input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={`Amount (max ${refundable})`} inputMode="decimal" className="flex-1 border border-zinc-200 rounded-xl px-3 py-2 text-xs" />
              <button
                disabled={refundable <= 0 || Boolean(busy)}
                onClick={() => {
                  if (!window.confirm(`Refund ${inr(refundAmount || refundable)} to the customer via Cashfree?`)) return;
                  act("Refund", () => api.post(`/admin/orders/${orderId}/refund`, { amount: refundAmount ? Number(refundAmount) : undefined, reason }));
                }}
                className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors disabled:opacity-40"
              >
                <IndianRupee size={14} /> Refund
              </button>
            </div>
            {order.payment.refunds?.length > 0 && (
              <ul className="text-xs space-y-1 pt-1">
                {order.payment.refunds.map((r) => (
                  <li key={r.refund_id} className="font-mono text-zinc-600">{fmtDate(r.created_at)} · {inr(r.amount)} · {r.status} · {r.refund_id}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Totals</p>
            <PriceBreakdown totals={order.totals} />
          </section>
          <section className="rounded-2xl border border-zinc-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Ship to</p>
            <AddressBlock address={order.shipping_address} name={order.customer?.name} phone={order.customer?.phone} />
            <p className="text-[11px] text-zinc-400 mt-3">Pickup: {order.pickup_location}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
