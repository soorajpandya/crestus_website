import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, ShoppingBag, Truck, Lock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";

export default function Login() {
  const { user, loading, login } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/shop";
  const [signingIn, setSigningIn] = useState(false);

  const isCheckoutRedirect = redirectUrl.includes("/checkout");

  useEffect(() => {
    if (!loading && user) {
      navigate(redirectUrl, { replace: true });
    }
  }, [user, loading, navigate, redirectUrl]);

  const handleSignIn = async () => {
    try {
      setSigningIn(true);
      const res = await login();
      if (res) {
        navigate(redirectUrl, { replace: true });
      }
    } catch {
      // Errors and toasts handled in AuthContext
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  }

  return (
    <div data-testid="login-page" className="min-h-screen pt-28 pb-20 px-6 flex items-center justify-center bg-gradient-to-b from-white via-zinc-50/50 to-white">
      <div className="w-full max-w-md">
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-brand-magenta transition-colors mb-8"
        >
          <ArrowLeft size={14} /> Back to shopping
        </Link>

        <div className="bg-white border border-zinc-200/90 rounded-3xl p-8 sm:p-10 shadow-xl shadow-zinc-950/5 text-center relative overflow-hidden">
          {/* Subtle decorative glow */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-brand-magenta/5 rounded-full blur-3xl pointer-events-none" />

          {/* Logo */}
          <div className="mb-6 inline-block">
            <span className="font-display font-bold text-2xl tracking-tighter">
              CRESTUS<span className="text-brand-magenta">.</span>
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-display font-semibold text-2xl sm:text-3xl tracking-tight text-zinc-900 mb-2">
            {isCheckoutRedirect ? "Sign in to place your order" : "Welcome to CRESTUS"}
          </h1>
          <p className="text-sm text-zinc-500 mb-8 max-w-sm mx-auto leading-relaxed">
            {isCheckoutRedirect
              ? "Please sign in with your Google account to complete your checkout and secure your delivery address."
              : "Sign in with Google to access your user-isolated bag, past orders, and personalized shopping."}
          </p>

          {isCheckoutRedirect && count > 0 && (
            <div className="mb-6 p-3.5 bg-zinc-50 border border-zinc-200/80 rounded-2xl flex items-center justify-center gap-2 text-xs font-medium text-zinc-700">
              <ShoppingBag size={14} className="text-brand-magenta" />
              <span>
                You have <strong>{count} {count === 1 ? "item" : "items"}</strong> waiting in your bag
              </span>
            </div>
          )}

          {/* Google Sign In Button */}
          <button
            data-testid="google-signin-btn"
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full relative flex items-center justify-center gap-3.5 bg-white hover:bg-zinc-50 text-zinc-800 border-2 border-zinc-200 hover:border-zinc-300 font-semibold py-3.5 px-6 rounded-full text-sm transition-all duration-200 shadow-sm hover:shadow active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed group"
          >
            {signingIn ? (
              <div className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-800 rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            <span className="tracking-wide">
              {signingIn ? "Connecting with Google…" : "Continue with Google"}
            </span>
          </button>

          {/* Privacy and trust indicator */}
          <div className="mt-8 pt-6 border-t border-zinc-100 space-y-3 text-left">
            <div className="flex items-center gap-2.5 text-xs text-zinc-500">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
              <span>Google Firebase secure single sign-on</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-zinc-500">
              <Lock size={16} className="text-zinc-400 shrink-0" />
              <span>User-wise bag & order isolation (private to you)</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-zinc-500">
              <Truck size={16} className="text-zinc-400 shrink-0" />
              <span>Order updates & automated Cashfree receipts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
