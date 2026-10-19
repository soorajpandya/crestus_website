import { Mail, Phone, MapPin, Clock } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { COMPANY } from "../lib/company";

const CARDS = [
  { icon: Mail, label: "Email us", value: COMPANY.email, href: `mailto:${COMPANY.email}`, note: "We reply within 24 hours" },
  { icon: Phone, label: "Call us", value: COMPANY.phone, href: `tel:${COMPANY.phone.replace(/\s/g, "")}`, note: "Mon–Sat, 10 AM – 7 PM IST" },
];

export default function Contact() {
  return (
    <PageShell title="Contact Us" eyebrow="Help" testId="contact-page">
      <p>Questions about an order, sizing, or anything else? Our support team is happy to help.</p>
      <div className="grid sm:grid-cols-2 gap-4 mt-8">
        {CARDS.map((c) => (
          <a
            key={c.label}
            href={c.href}
            data-testid={`contact-${c.label.split(" ")[0].toLowerCase()}`}
            className="group border border-zinc-200 rounded-2xl p-6 hover:border-brand-magenta transition-colors"
          >
            <c.icon size={20} className="text-brand-magenta" />
            <p className="text-xs uppercase tracking-widest text-zinc-400 mt-4">{c.label}</p>
            <p className="text-ink font-semibold mt-1 group-hover:text-brand-magenta transition-colors">{c.value}</p>
            <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1.5"><Clock size={12} /> {c.note}</p>
          </a>
        ))}
      </div>
      <div className="border border-zinc-200 rounded-2xl p-6 mt-4">
        <MapPin size={20} className="text-brand-magenta" />
        <p className="text-xs uppercase tracking-widest text-zinc-400 mt-4">Registered office</p>
        <p className="text-ink font-semibold mt-1">{COMPANY.legalName}</p>
        <p className="text-zinc-600 mt-1">{COMPANY.address}</p>
        <p className="text-xs text-zinc-400 mt-3">CIN: {COMPANY.cin} · GSTIN: {COMPANY.gstin}</p>
      </div>
    </PageShell>
  );
}
