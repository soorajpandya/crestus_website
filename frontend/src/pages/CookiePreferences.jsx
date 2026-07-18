import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "../components/PageShell";
import { Switch } from "../components/ui/switch";

const STORAGE_KEY = "crestus_cookie_prefs";
const DEFAULTS = { analytics: true, marketing: false };

const OPTIONS = [
  { key: "essential", title: "Essential cookies", desc: "Required for core features like your shopping bag, sign-in session, and checkout. Always on.", locked: true },
  { key: "analytics", title: "Analytics cookies", desc: "Help us understand how shoppers use the site so we can improve the experience." },
  { key: "marketing", title: "Marketing cookies", desc: "Used to show you relevant offers and measure campaign performance." },
];

export default function CookiePreferences() {
  const [prefs, setPrefs] = useState(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch {
      return DEFAULTS;
    }
  });

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    toast.success("Cookie preferences saved");
  };

  return (
    <PageShell title="Cookie Preferences" eyebrow="Company" testId="cookie-preferences-page">
      <p>We use cookies to run the store and improve your experience. Manage your preferences below — changes apply to this browser.</p>
      <div className="space-y-4 mt-8">
        {OPTIONS.map((o) => (
          <div key={o.key} className="flex items-start justify-between gap-6 border border-zinc-200 rounded-2xl p-6">
            <div>
              <p className="font-semibold text-ink">{o.title}</p>
              <p className="text-sm text-zinc-500 mt-1">{o.desc}</p>
            </div>
            <Switch
              data-testid={`cookie-toggle-${o.key}`}
              checked={o.locked ? true : prefs[o.key]}
              disabled={o.locked}
              onCheckedChange={(v) => setPrefs((p) => ({ ...p, [o.key]: v }))}
            />
          </div>
        ))}
      </div>
      <button
        data-testid="cookie-save-button"
        onClick={save}
        className="mt-8 bg-ink text-white px-10 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
      >
        Save preferences
      </button>
    </PageShell>
  );
}
