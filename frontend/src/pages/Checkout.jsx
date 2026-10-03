import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api, { apiErrorMessage } from "../lib/api";
import { track } from "../lib/firebase";
import { openCashfreeCheckout } from "../lib/cashfree";
import { inr, fmtDay } from "../lib/orderUi";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";

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
  const { items, total: cartTotal } = useCart();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [errors, setErrors] = useState({});
  const [paying, setPaying] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState("idle"); // idle | loading | ready | error

  // Require Google Sign-In before placing order
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login?redirect=/checkout", { replace: true });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      setAddress((prev) => ({
        ...prev,
        name: prev.name || user.name || user.displayName || "",
        email: prev.email || user.email || "",
      }));
    }
  }, [user]);

  const itemsPayload = useMemo(() => items.map((i) => ({ product_id: i.product_id, size: i.size, qty: i.qty })), [items]);
  const cartKeys = useMemo(() => items.map((i) => i.key), [items]);
  const pincodeValid = /^\d{6}$/.test(address.pincode);

  // Server-side quote: trusted prices + serviceability + shipping charge for this pincode.
  useEffect(() => {
    if (!user || items.length === 0 || !pincodeValid) {
      setQuote(null);
      setQuoteState("idle");
      return undefined;
    }
    let cancelled = false;
    setQuoteState("loading");
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post("/checkout/quote", { items: itemsPayload, pincode: address.pincode });
        if (cancelled) return;
        setQuote(data);
        setQuoteState("ready");
        if (!data.serviceable) setErrors((prev) => ({ ...prev, pincode: "Sorry, we can't deliver to this pincode yet." }));
        else setErrors((prev) => (prev.pincode?.startsWith("Sorry") ? { ...prev, pincode: null } : prev));
      } catch (e) {
        if (cancelled) return;
        setQuote(null);
        setQuoteState("error");
        toast.error(apiErrorMessage(e, "Could not calculate shipping. Please try again."));
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, items.length, itemsPayload, address.pincode, pincodeValid]);

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
    if (quote && !quote.serviceable) {
      toast.error("Sorry, we can't deliver to this pincode yet.");
      return;
    }
    setErrors({});
    setPaying(true);
    track("begin_checkout", {
      currency: "INR",
      value: quote?.totals?.total ?? cartTotal,
      items: items.map((i) => ({ item_id: i.product_id, item_name: i.name, price: i.price, quantity: i.qty })),
    });

    try {
      // The backend snapshots the order (trusted prices, package, shipping) before any payment starts.
      const { data } = await api.post("/orders/create", { items: itemsPayload, address: cleanedAddress, cart_keys: cartKeys });
      if (!data.payment_session_id) {
        throw new Error(data.detail || data.message || "Failed to initialize payment session");
      }

      const result = await openCashfreeCheckout({ paymentSessionId: data.payment_session_id, environment: data.environment });
      if (result?.error && !result?.redirect && !result?.paymentDetails) {
        // Modal closed or payment aborted — the order stays retrievable; the backend decides its real status.
        toast.error(result.error.message || "Payment was not completed");
        navigate(`/failed?order_id=${encodeURIComponent(data.order_id)}`);
        return;
      }
      // Never trust the modal result: verify with the backend on the pending page.
      navigate(`/pending?order_id=${encodeURIComponent(data.order_id)}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not start payment. Please try again."));
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  }

  if (!user) {
    return null;
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
    { key: "email", label: "Email address", span: true, type: "email" },
    { key: "phone", label: "Phone number", span: true, type: "tel" },
    { key: "line1", label: "Address", span: true },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "pincode", label: "Pincode" },
  ];

  const totals = quote?.totals;
  const payable = totals?.total ?? cartTotal;
  const canPay = !paying && pincodeValid && quoteState === "ready" && quote?.serviceable;

  return (
    <div data-testid="checkout-page" className="max-w-5xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl mb-6">Checkout</h1>

      <div className="mb-8 flex items-center justify-between p-4 bg-zinc-50 border border-zinc-200/90 rounded-2xl text-xs text-zinc-700">
        <div className="flex items-center gap-3">
          {user.picture ? (
            <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full object-cover border border-zinc-200" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center font-bold text-xs">
              {user.name?.[0] || "U"}
            </div>
          )}
          <div>
            <p className="font-semibold text-zinc-900">{user.name}</p>
            <p className="text-zinc-500 text-[11px]">{user.email}</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/80">
          ✓ Verified Google Account
        </span>
      </div>

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
          {quote?.courier?.etd && quote.serviceable && (
            <p data-testid="delivery-estimate" className="text-xs text-zinc-500 mt-4">
              Estimated delivery by <span className="font-semibold text-ink">{fmtDay(quote.courier.etd)}</span>
            </p>
          )}
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
            <div className="border-t border-zinc-200 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal</span>
                <span>{inr(totals?.subtotal ?? cartTotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Shipping</span>
                <span data-testid="checkout-shipping">
                  {!pincodeValid ? "Enter pincode" : quoteState === "loading" ? "Calculating…" : quoteState === "error" ? "Unavailable" : quote?.serviceable ? (totals.shipping > 0 ? inr(totals.shipping) : "Free") : "Not serviceable"}
                </span>
              </div>
              <div className="flex justify-between items-baseline pt-2">
                <span className="text-xs uppercase tracking-widest text-zinc-500">Total</span>
                <span data-testid="checkout-total" className="font-display text-2xl font-semibold">{inr(payable)}</span>
              </div>
            </div>
            <button
              data-testid="pay-button"
              onClick={handlePay}
              disabled={!canPay}
              className="w-full bg-brand-magenta text-white py-4 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-darkorange transition-colors disabled:opacity-60"
            >
              {paying ? "Processing…" : quoteState === "loading" ? "Calculating…" : `Pay ${inr(payable)}`}
            </button>
            <p className="text-[11px] text-zinc-400 text-center">Secured by Cashfree Payments · UPI, Cards, Netbanking</p>
          </div>
        </div>
      </div>
    </div>
  );
}
