import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

const loadRazorpay = () =>
  new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

const EMPTY_ADDRESS = { name: "", phone: "", line1: "", city: "", state: "", pincode: "" };

export default function Checkout() {
  const { items, total, clearCart } = useCart();
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [paying, setPaying] = useState(false);

  const set = (k) => (e) => setAddress((a) => ({ ...a, [k]: e.target.value }));

  const handlePay = async () => {
    if (Object.values(address).some((v) => !v.trim())) {
      toast.error("Please fill in all address fields");
      return;
    }
    setPaying(true);
    try {
      const ok = await loadRazorpay();
      if (!ok) throw new Error("Could not load Razorpay");
      const { data } = await api.post("/orders/create", {
        items: items.map((i) => ({ product_id: i.product_id, size: i.size, qty: i.qty })),
        address,
      });
      const rzp = new window.Razorpay({
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: "Veloura",
        description: "Clothing order",
        order_id: data.razorpay_order_id,
        prefill: { name: address.name || data.name, email: data.email, contact: address.phone },
        theme: { color: "#F41CB2" },
        handler: async (res) => {
          try {
            await api.post("/orders/verify", {
              razorpay_order_id: res.razorpay_order_id,
              razorpay_payment_id: res.razorpay_payment_id,
              razorpay_signature: res.razorpay_signature,
            });
            clearCart();
            toast.success("Payment successful! Order placed.");
            navigate("/orders");
          } catch {
            toast.error("Payment verification failed. Contact support.");
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.on("payment.failed", () => {
        toast.error("Payment failed. Please try again.");
        setPaying(false);
      });
      rzp.open();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not start payment. Please try again.");
      setPaying(false);
    }
  };

  if (loading) return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;

  if (!user) {
    return (
      <div data-testid="checkout-login-required" className="pt-40 pb-24 text-center min-h-screen px-6">
        <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">Sign in to checkout</h1>
        <p className="text-zinc-500 mt-4">You need an account to place an order.</p>
        <button
          data-testid="checkout-login-button"
          onClick={login}
          className="mt-8 bg-ink text-white px-10 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div data-testid="checkout-empty" className="pt-40 pb-24 text-center min-h-screen px-6">
        <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">Your bag is empty</h1>
        <button
          data-testid="checkout-go-shop"
          onClick={() => navigate("/shop")}
          className="mt-8 bg-ink text-white px-10 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
        >
          Browse the collection
        </button>
      </div>
    );
  }

  const fields = [
    { key: "name", label: "Full name", span: true },
    { key: "phone", label: "Phone number", span: true },
    { key: "line1", label: "Address", span: true },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "pincode", label: "Pincode" },
  ];

  return (
    <div data-testid="checkout-page" className="max-w-5xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl mb-12">Checkout</h1>
      <div className="grid md:grid-cols-5 gap-12">
        <div className="md:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-5">Delivery address</p>
          <div className="grid grid-cols-2 gap-4">
            {fields.map((f) => (
              <input
                key={f.key}
                data-testid={`address-${f.key}`}
                placeholder={f.label}
                value={address[f.key]}
                onChange={set(f.key)}
                className={`${f.span ? "col-span-2" : ""} border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-magenta transition-colors`}
              />
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-5">Order summary</p>
          <div className="bg-zinc-50 rounded-2xl p-6 space-y-4">
            {items.map((i) => (
              <div key={i.key} className="flex justify-between text-sm gap-3">
                <span className="text-zinc-600 truncate">{i.name} · {i.size} × {i.qty}</span>
                <span className="font-semibold shrink-0">{inr(i.price * i.qty)}</span>
              </div>
            ))}
            <div className="border-t border-zinc-200 pt-4 flex justify-between items-baseline">
              <span className="text-xs uppercase tracking-widest text-zinc-500">Total</span>
              <span data-testid="checkout-total" className="font-display text-2xl font-semibold">{inr(total)}</span>
            </div>
            <button
              data-testid="pay-button"
              onClick={handlePay}
              disabled={paying}
              className="w-full bg-brand-magenta text-white py-4 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-darkorange transition-colors disabled:opacity-60"
            >
              {paying ? "Processing…" : `Pay ${inr(total)}`}
            </button>
            <p className="text-[11px] text-zinc-400 text-center">Secured by Razorpay · UPI, Cards, Netbanking</p>
          </div>
        </div>
      </div>
    </div>
  );
}
