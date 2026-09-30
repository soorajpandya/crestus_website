import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "../lib/api";
import { track } from "../lib/firebase";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";

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

export function validateAddress(address) {
  const errors = {};

  // Full name
  const name = (address.name || "").trim();
  if (!name) {
    errors.name = "Full name is required";
  } else if (name.length < 2) {
    errors.name = "Please enter your full name (at least 2 letters)";
  } else if (!/^[a-zA-Z\s'.]+$/.test(name)) {
    errors.name = "Name should contain only letters";
  }

  // Email
  const email = (address.email || "").trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email) {
    errors.email = "Email address is required";
  } else if (!emailRegex.test(email)) {
    errors.email = "Please enter a valid email address (e.g. name@domain.com)";
  }

  // Phone: Indian 10 digits starting with 6, 7, 8, 9
  const phone = (address.phone || "").trim().replace(/\D/g, "").slice(-10);
  if (!phone) {
    errors.phone = "Phone number is required";
  } else if (phone.length !== 10) {
    errors.phone = "Please enter a complete 10-digit phone number";
  } else if (!/^[6-9]\d{9}$/.test(phone)) {
    errors.phone = "Mobile number must start with 6, 7, 8, or 9";
  }

  // Delivery Address
  const line1 = (address.line1 || "").trim();
  if (!line1) {
    errors.line1 = "Address is required";
  } else if (line1.length < 5) {
    errors.line1 = "Please enter a complete address (flat/house no., street, area)";
  }

  // City
  const city = (address.city || "").trim();
  if (!city) {
    errors.city = "City is required";
  } else if (city.length < 2) {
    errors.city = "Please enter a valid city name";
  }

  // State
  const state = (address.state || "").trim();
  if (!state) {
    errors.state = "State is required";
  } else if (state.length < 2) {
    errors.state = "Please enter a valid state";
  }

  // Pincode: exactly 6 digits
  const pincode = (address.pincode || "").trim().replace(/\D/g, "");
  if (!pincode) {
    errors.pincode = "Pincode is required";
  } else if (!/^\d{6}$/.test(pincode)) {
    errors.pincode = "Please enter a valid 6-digit postal pincode";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    cleanedAddress: {
      name,
      email,
      phone,
      line1,
      city,
      state,
      pincode,
    },
  };
}

export default function Checkout() {
  const { items, total, clearCart } = useCart();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [errors, setErrors] = useState({});
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (user) {
      setAddress((prev) => ({
        ...prev,
        name: prev.name || user.name || user.displayName || "",
        email: prev.email || user.email || "",
      }));
    }
  }, [user]);

  const handleChange = (k) => (e) => {
    let val = e.target.value;
    if (k === "phone") {
      val = val.replace(/\D/g, "").slice(0, 10);
    } else if (k === "pincode") {
      val = val.replace(/\D/g, "").slice(0, 6);
    }
    setAddress((a) => ({ ...a, [k]: val }));
    if (errors[k]) {
      setErrors((prev) => ({ ...prev, [k]: null }));
    }
  };

  const handlePay = async () => {
    const { isValid, errors: validationErrors, cleanedAddress } = validateAddress(address);
    if (!isValid) {
      setErrors(validationErrors);
      const firstError = Object.values(validationErrors)[0];
      toast.error(firstError || "Please fill in all address fields correctly");
      return;
    }
    setErrors({});
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

      // Create order with Cashfree SDK backend endpoint using validated address and user_id
      const { data } = await api.post("/orders/create", {
        items: items.map((i) => ({ product_id: i.product_id, size: i.size, qty: i.qty, price: i.price, name: i.name })),
        amount: total,
        address: cleanedAddress,
        user_id: user?.uid || null,
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

          // Save order to user-scoped local order history
          try {
            const userOrdersKey = user?.uid ? `crestus_orders_${user.uid}` : "crestus_orders_guest";
            const existingOrders = JSON.parse(localStorage.getItem(userOrdersKey) || "[]");
            const newOrder = {
              order_id: data.order_id,
              cf_order_id: data.cf_order_id,
              user_id: user?.uid || null,
              amount: total,
              status: "paid",
              items,
              address: cleanedAddress,
              created_at: new Date().toISOString(),
            };
            localStorage.setItem(userOrdersKey, JSON.stringify([newOrder, ...existingOrders]));
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
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl mb-6">Checkout</h1>

      {user ? (
        <div className="mb-8 flex items-center gap-3 p-3.5 bg-zinc-50 border border-zinc-200/80 rounded-xl text-xs text-zinc-700">
          {user.picture ? (
            <img src={user.picture} alt={user.name} className="w-5 h-5 rounded-full object-cover" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-zinc-200 flex items-center justify-center font-bold text-[10px]">
              {user.name?.[0] || "U"}
            </div>
          )}
          <span>
            Signed in as <strong>{user.name}</strong> ({user.email}). This order will be linked to your account.
          </span>
        </div>
      ) : (
        <div className="mb-8 flex items-center justify-between p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-xl text-xs text-amber-900">
          <span>Sign in with Google to automatically track this order in your account.</span>
          <button
            type="button"
            onClick={login}
            className="font-bold text-amber-900 underline hover:text-brand-magenta transition-colors shrink-0 ml-3"
          >
            Sign in with Google →
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-12">
        <div className="md:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-5">Delivery address</p>
          <div className="grid grid-cols-2 gap-4">
            {fields.map((f) => {
              const hasError = Boolean(errors[f.key]);
              return (
                <div key={f.key} className={f.span ? "col-span-2" : ""}>
                  <input
                    type={f.type || "text"}
                    data-testid={`address-${f.key}`}
                    placeholder={f.label}
                    value={address[f.key]}
                    onChange={handleChange(f.key)}
                    className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors ${
                      hasError
                        ? "border-rose-400 bg-rose-50/20 focus:border-rose-500 text-zinc-900"
                        : "border-zinc-200 focus:border-brand-magenta text-zinc-900"
                    }`}
                  />
                  {hasError && (
                    <p className="text-[12px] text-rose-500 mt-1 ml-1 font-medium">{errors[f.key]}</p>
                  )}
                </div>
              );
            })}
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
