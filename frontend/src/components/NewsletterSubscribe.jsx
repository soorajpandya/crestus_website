import { useState } from "react";
import { toast } from "sonner";
import { Mail, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import api from "../lib/api";

export default function NewsletterSubscribe() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Email format validation regex
  const validateEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const handleSubscribe = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    // Step 1: Input & Validation
    if (!validateEmail(cleanEmail)) {
      setError("Please enter valid email");
      return;
    }

    setError("");
    setLoading(true);

    try {
      // Step 2 & 3 & 4: API call with duplicate check & DB storage
      const res = await api.post("/newsletter/subscribe", {
        email: cleanEmail,
        source: "homepage_newsletter",
      });

      if (res.data?.alreadySubscribed) {
        // Step 3 (duplicate):
        toast.info("Already part of our private circle!");
      } else if (res.data?.success) {
        // Step 4 & 5 (success):
        toast.success("Welcome to the world!");
        setSuccess(true);
        setEmail("");
      }
    } catch (err) {
      const serverMsg = err.response?.data?.error || err.response?.data?.detail;
      if (serverMsg) {
        setError(serverMsg);
        toast.error(serverMsg);
      } else {
        toast.error("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-ink text-white py-20 px-6 lg:px-10 border-t border-zinc-900 relative overflow-hidden">
      {/* Subtle decorative glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand-magenta/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-2xl mx-auto text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold uppercase tracking-widest text-brand-magenta mb-6">
          <Sparkles size={13} className="text-brand-magenta" />
          The Private Circle
        </div>

        <h2 className="font-display font-semibold text-3xl md:text-4xl lg:text-5xl tracking-tight uppercase mb-4">
          Join Our Newsletter<span className="text-brand-magenta">.</span>
        </h2>

        <p className="text-zinc-400 text-sm md:text-base leading-relaxed mb-8 max-w-lg mx-auto">
          Subscribe to receive exclusive collection previews, private drops, and priority invitations directly to your inbox.
        </p>

        {success ? (
          <div className="p-5 bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 rounded-2xl text-sm flex items-center justify-center gap-3 backdrop-blur-sm animate-in fade-in duration-300">
            <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
            <span>
              <strong>Welcome to the world!</strong> Check your inbox soon for private updates.
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubscribe} className="max-w-md mx-auto" noValidate>
            <div className="flex flex-col sm:flex-row gap-2.5 bg-zinc-900/90 p-2 rounded-2xl border border-zinc-800 shadow-xl focus-within:border-zinc-700 transition-all">
              <div className="relative flex-1 flex items-center">
                <Mail size={18} className="absolute left-3.5 text-zinc-500 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Enter your email address"
                  data-testid="newsletter-input"
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-3 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none disabled:opacity-50"
                  aria-label="Email address for newsletter"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                data-testid="newsletter-submit"
                className="px-6 py-3 bg-brand-magenta hover:bg-brand-maroon text-white font-medium text-xs uppercase tracking-widest rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 active:scale-95 shadow-md shadow-brand-magenta/20"
              >
                {loading ? (
                  <span>Subscribing...</span>
                ) : (
                  <>
                    <span>Subscribe</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>

            {error && (
              <p
                role="alert"
                data-testid="newsletter-error"
                className="text-xs text-rose-400 mt-2.5 text-left pl-2 font-medium"
              >
                {error}
              </p>
            )}

            <p className="text-[11px] text-zinc-500 mt-3 text-center">
              No spam. Unsubscribe at any time with one click.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
