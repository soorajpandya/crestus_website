import { Link } from "react-router-dom";
import { Mail, Phone, MapPin } from "lucide-react";
import { COMPANY } from "../lib/company";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      { to: "/shop?c=men", label: "Men" },
      { to: "/shop?c=women", label: "Women" },
      { to: "/new-arrivals", label: "New Arrivals" },
      { to: "/best-sellers", label: "Best Sellers" },
    ],
  },
  {
    title: "Help",
    links: [
      { to: "/faq", label: "FAQ" },
      { to: "/contact", label: "Contact Us" },
      { to: "/shipping-policy", label: "Shipping Policy" },
      { to: "/refund-policy", label: "Refund Policy" },
      { to: "/cancellation-policy", label: "Cancellation Policy" },
      { to: "/track-order", label: "Track Order" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/about", label: "About Us" },
      { to: "/privacy-policy", label: "Privacy Policy" },
      { to: "/terms-of-service", label: "Terms of Service" },
      { to: "/cookie-preferences", label: "Cookie Preferences" },
    ],
  },
];

const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

export const Footer = () => (
  <footer className="bg-ink text-white">
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20">
      <div className="grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5">
          <p className="font-display font-semibold text-3xl tracking-tighter">
            CRESTUS<span className="text-brand-magenta">.</span>
          </p>
          <p className="text-zinc-400 text-sm mt-4 max-w-sm leading-relaxed">{COMPANY.description}</p>
          <div className="mt-6 space-y-2.5 text-sm text-zinc-400">
            <p className="flex items-start gap-2.5"><MapPin size={15} className="mt-0.5 shrink-0 text-brand-magenta" /> {COMPANY.address}</p>
            <p className="flex items-center gap-2.5">
              <Mail size={15} className="shrink-0 text-brand-magenta" />
              <a href={`mailto:${COMPANY.email}`} data-testid="footer-email" className="hover:text-brand-magenta transition-colors">{COMPANY.email}</a>
            </p>
            <p className="flex items-center gap-2.5">
              <Phone size={15} className="shrink-0 text-brand-magenta" />
              <a href={`tel:${COMPANY.phone.replace(/\s/g, "")}`} data-testid="footer-phone" className="hover:text-brand-magenta transition-colors">{COMPANY.phone}</a>
            </p>
          </div>
        </div>
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
          {COLUMNS.map((col) => (
            <div key={col.title} className="space-y-3">
              <p className="text-xs uppercase tracking-widest text-zinc-500">{col.title}</p>
              {col.links.map((l) => (
                <Link key={l.label} to={l.to} data-testid={`footer-${slug(l.label)}`} className="block text-sm text-zinc-300 hover:text-brand-magenta transition-colors">
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-zinc-800 mt-16 pt-6 flex flex-col sm:flex-row justify-between gap-3 text-xs text-zinc-500">
        <p>© 2026 {COMPANY.legalName}. All rights reserved.</p>
        <p>CIN: {COMPANY.cin} · GSTIN: {COMPANY.gstin}</p>
      </div>
    </div>
  </footer>
);
