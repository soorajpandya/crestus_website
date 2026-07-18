import { PageShell } from "../components/PageShell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion";

const FAQS = [
  { q: "How long does delivery take?", a: "Metro cities receive orders in 3–5 business days, the rest of India in 5–8 business days, and remote pin codes in 8–12 business days. Orders are dispatched within 1–2 business days of payment." },
  { q: "What payment methods do you accept?", a: "We accept UPI, credit/debit cards, netbanking, and popular wallets — all processed securely via Razorpay. We never store your payment details." },
  { q: "Can I return or exchange an item?", a: "Yes. Returns are accepted within 7 days of delivery for unworn items with tags intact. Size exchanges are free, subject to stock. See our Refund Policy for details." },
  { q: "How do I track my order?", a: "Use the Track Order page with your order ID (starts with 'ord_'), or check My Orders after signing in. You'll also receive tracking updates by email/SMS once your order ships." },
  { q: "Can I cancel my order?", a: "You can cancel free of charge any time before dispatch by emailing support@crestuseccommerce.store with your order ID. After dispatch, please use the returns process instead." },
  { q: "How do I choose the right size?", a: "Each product page lists available sizes. If you're between sizes, we recommend sizing up for outerwear and staying true to size for tees and shirts. Free size exchanges have you covered either way." },
  { q: "Do you ship outside India?", a: "Currently we ship only within India. International shipping is on our roadmap." },
  { q: "Is there a shipping fee?", a: "Shipping is free on orders above ₹1,999. Orders below that carry a flat ₹79 fee." },
];

export default function FAQ() {
  return (
    <PageShell title="Frequently Asked Questions" eyebrow="Help" testId="faq-page">
      <Accordion type="single" collapsible className="w-full">
        {FAQS.map((f, i) => (
          <AccordionItem key={i} value={`q-${i}`} data-testid={`faq-item-${i}`}>
            <AccordionTrigger className="text-left text-ink font-semibold hover:text-brand-magenta hover:no-underline">{f.q}</AccordionTrigger>
            <AccordionContent className="text-zinc-600 leading-relaxed">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </PageShell>
  );
}
