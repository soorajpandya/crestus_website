import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { authErrorMessage, authRedirect } from "../lib/authUi";
import { LOGIN, REGISTER } from "../constants/testIds/auth";

export default function Login({ signup = false, admin = false }) {
  const { user, loading, login, loginWithEmail, signupWithEmail, resetPassword } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectUrl = authRedirect(searchParams.get("redirect") || (admin ? '/' : null));
  const [pending, setPending] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const signingIn = pending === "google";
  const busy = Boolean(pending);
  const ids = signup ? REGISTER : LOGIN;
  const switchUrl = `${signup ? "/login" : "/signup"}?${new URLSearchParams({ redirect: redirectUrl })}`;

  useEffect(() => {
    setError("");
    setNotice("");
    setPassword("");
    setConfirmation("");
    setResetting(false);
  }, [signup]);

  const isCheckoutRedirect = redirectUrl.includes("/checkout");

  useEffect(() => {
    if (!loading && user) {
      navigate(redirectUrl, { replace: true });
    }
  }, [user, loading, navigate, redirectUrl]);

  const handleSignIn = async () => {
    try {
      setPending("google");
      setError("");
      setNotice("");
      const res = await login();
      if (res) {
        navigate(redirectUrl, { replace: true });
      }
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setPending("");
    }
  };

  const handleEmailSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    if (signup && !resetting && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setPending("email");
    try {
      if (resetting) {
        const recipient = email.trim();
        await resetPassword(recipient);
        setNotice(`If an account exists for ${recipient}, a password reset link has been sent. Please check your inbox and spam folder.`);
      } else {
        await (signup ? signupWithEmail(email, password) : loginWithEmail(email, password));
        navigate(redirectUrl, { replace: true });
      }
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setPending("");
    }
  };

  if (loading) {
    return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  }

  return (
    <div data-testid="login-page" className="min-h-screen pt-28 pb-20 px-6 flex items-center justify-center bg-gradient-to-b from-white via-zinc-50/50 to-white">
      <div className="w-full max-w-md">
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
            {resetting ? "Reset your password" : admin ? "Sign in to your workspace" : signup ? "Create your account" : isCheckoutRedirect ? "Sign in to place your order" : "Welcome to CRESTUS"}
          </h1>
          <p className="text-sm text-zinc-500 mb-8 max-w-sm mx-auto leading-relaxed">
            {resetting
              ? "Enter your email and we'll send you a link to choose a new password."
              : admin
                ? "Use your authorized administrator account to manage your Crestus store."
              : signup
                ? "Sign up with your email and password, or continue with Google."
                : "Sign in with your email and password or Google to access your bag and orders."}
          </p>

          {isCheckoutRedirect && count > 0 && (
            <div className="mb-6 p-3.5 bg-zinc-50 border border-zinc-200/80 rounded-2xl flex items-center justify-center gap-2 text-xs font-medium text-zinc-700">
              <ShoppingBag size={14} className="text-brand-magenta" />
              <span>
                You have <strong>{count} {count === 1 ? "item" : "items"}</strong> waiting in your bag
              </span>
            </div>
          )}

          {error && <p role="alert" className="mb-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 text-left">{error}</p>}
          {notice && <p role="status" className="mb-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 text-left">{notice}</p>}

          <form onSubmit={handleEmailSubmit} className="space-y-4 text-left">
            <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
              <div>
                <label htmlFor="auth-email" className="block text-sm font-medium text-zinc-700 mb-1.5">Email address</label>
                <input id="auth-email" data-testid={ids.emailInput} type="email" autoComplete="email" required maxLength={254}
                  value={email} onChange={(event) => { setEmail(event.target.value); setNotice(""); }}
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-brand-magenta focus:ring-2 focus:ring-brand-magenta/20" />
              </div>
              {!resetting && <>
                <div>
                  <label htmlFor="auth-password" className="block text-sm font-medium text-zinc-700 mb-1.5">Password</label>
                  <input id="auth-password" data-testid={ids.passwordInput} type="password" required minLength={signup ? 6 : undefined}
                    autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)}
                    aria-describedby={signup ? "password-hint" : undefined}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-brand-magenta focus:ring-2 focus:ring-brand-magenta/20" />
                  {signup && <p id="password-hint" className="mt-1.5 text-xs text-zinc-500">Use at least 6 characters.</p>}
                </div>
                {signup && <div>
                  <label htmlFor="auth-confirmation" className="block text-sm font-medium text-zinc-700 mb-1.5">Confirm password</label>
                  <input id="auth-confirmation" data-testid={REGISTER.passwordConfirmInput} type="password" required minLength={6} autoComplete="new-password"
                    value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-brand-magenta focus:ring-2 focus:ring-brand-magenta/20" />
                </div>}
              </>}
              <button type="submit" data-testid={resetting ? "reset-password-submit-button" : ids.submitButton}
                className="w-full bg-ink hover:bg-brand-magenta text-white font-semibold py-3.5 px-6 rounded-full text-sm transition-colors disabled:cursor-not-allowed">
                {pending === "email" ? "Please wait…" : resetting ? "Send reset link" : signup ? "Create account" : "Sign in with email"}
              </button>
            </fieldset>
          </form>

          {!signup && <button type="button" data-testid={LOGIN.forgotPasswordLink} disabled={busy}
            onClick={() => { setResetting(!resetting); setError(""); setNotice(""); setPassword(""); }}
            className="mt-4 text-sm font-medium text-zinc-600 hover:text-brand-magenta disabled:opacity-60">
            {resetting ? "Back to sign in" : "Forgot password?"}
          </button>}

          <div className="flex items-center gap-3 my-6 text-xs text-zinc-400">
            <div className="h-px bg-zinc-200 flex-1" /><span>or</span><div className="h-px bg-zinc-200 flex-1" />
          </div>

          {/* Google Sign In Button */}
          <button
            data-testid="google-signin-btn"
            onClick={handleSignIn}
            disabled={busy}
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

          {!admin && <p className="mt-6 text-sm text-zinc-500">
            {signup ? "Already have an account? " : "New to CRESTUS? "}
            <Link to={switchUrl} data-testid={signup ? REGISTER.loginLink : LOGIN.registerLink}
              onClick={(event) => { if (busy) event.preventDefault(); }} aria-disabled={busy}
              className="font-semibold text-brand-magenta hover:underline">
              {signup ? "Sign in" : "Create an account"}
            </Link>
          </p>}

        </div>
      </div>
    </div>
  );
}
