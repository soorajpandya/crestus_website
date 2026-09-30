import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "../lib/api";
import { track } from "../lib/firebase";
import { useCart } from "../context/CartContext";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

// Dynamically load Cashfree JS SDK v3
const loadCashfree = () =>
  new Promise((resolve) => {
    if (window.Cashfree) return resolve(window.Cashfree);
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.onload = () => resolve(window.Cashfree);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });

const EMPTY_ADDRESS = { name: "", email: "", phone: "", line1: "", city: "", state: "", pincode: "" };

export default function Checkout() {
  const { items, total, clearCart } = useCart();
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
    track("begin_checkout", {
      currency: "INR",
      value: total,
      items: items.map((i) => ({ item_id: i.product_id, item_name: i.name, price: i.price, quantity: i.qty })),
    });

    try {
      const CashfreeSDK = await loadCashfree();
      if (!CashfreeSDK) {
        throw new Error("Could not load Cashfree Checkout SDK");
      }

      // Create order with Cashfree SDK backend endpoint
      const { data } = await api.post("/orders/create", {
        items: items.map((i) => ({ product_id: i.product_id, size: i.size, qty: i.qty, price: i.price, name: i.name })),
        amount: total,
        address: {
          ...address,
          email: address.email || "customer@crestus.in",
        },
      });

      if (!data.payment_session_id) {
        throw new Error(data.detail || data.message || "Failed to initialize payment session");
      }

      // Initialize Cashfree in production or sandbox mode
      const cashfree = CashfreeSDK({
        mode: data.environment || "production",
      });

      const checkoutOptions = {
        paymentSessionId: data.payment_session_id,
        redirectTarget: "_modal",
      };

      cashfree.checkout(checkoutOptions).then(async (result) => {
        if (result.error) {
          toast.error(result.error.message || "Payment cancelled or failed");
          setPaying(false);
          return;
        }

        if (result.paymentDetails || result.redirect) {
          try {
            await api.post("/orders/verify", {
              order_id: data.order_id,
              cf_order_id: data.cf_order_id,
            });
          } catch {
            // Non-blocking verify
          }

          // Save order to local order history
          try {
            const existingOrders = JSON.parse(localStorage.getItem("crestus_orders") || "[]");
            const newOrder = {
              order_id: data.order_id,
              cf_order_id: data.cf_order_id,
              amount: total,
              status: "paid",
              items,
              address,
              created_at: new Date().toISOString(),
            };
            localStorage.setItem("crestus_orders", JSON.stringify([newOrder, ...existingOrders]));
          } catch {}

          track("purchase", {
            transaction_id: data.order_id,
            currency: "INR",
            value: total,
            items: items.map((i) => ({ item_id: i.product_id, item_name: i.name, price: i.price, quantity: i.qty })),
          });

          clearCart();
          toast.success("Payment successful! Order placed.");
          navigate("/orders");
        }
        setPaying(false);
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || "Could not start payment. Please try again.");
      setPaying(false);
    }
  };



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
    { key: "email", label: "Email address", span: true, type: "email" },
    { key: "phone", label: "Phone number", span: true, type: "tel" },
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
                type={f.type || "text"}
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
            <p className="text-[11px] text-zinc-400 text-center">Secured by Cashfree Payments · UPI, Cards, Netbanking</p>
          </div>
        </div>
      </div>
    </div>
  );
}
