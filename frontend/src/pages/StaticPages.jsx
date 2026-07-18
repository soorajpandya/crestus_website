import { PageShell } from "../components/PageShell";
import { COMPANY } from "../lib/company";

export function About() {
  return (
    <PageShell title="About Us" eyebrow="Company" testId="about-page">
      <p>{COMPANY.description}</p>
      <p>Based in Ahmedabad, Gujarat, {COMPANY.brand} was built on a simple belief: clothing should be cut with intent and worn for years. We work directly with mills and manufacturers to bring premium menswear and womenswear to your doorstep at honest prices.</p>
      <h2>What we stand for</h2>
      <ul>
        <li><strong>Fabric first</strong> — every piece begins at the mill, with materials chosen to outlast trends.</li>
        <li><strong>Cut with intent</strong> — silhouettes engineered on real bodies.</li>
        <li><strong>Worn for years</strong> — we design for the hundredth wear, not the first photo.</li>
      </ul>
      <h2>Registered office</h2>
      <p>{COMPANY.legalName}<br />{COMPANY.address}<br />CIN: {COMPANY.cin} · GSTIN: {COMPANY.gstin}</p>
    </PageShell>
  );
}

export function ShippingPolicy() {
  return (
    <PageShell title="Shipping Policy" eyebrow="Help" testId="shipping-policy-page">
      <h2>Processing time</h2>
      <p>Orders are processed within 1–2 business days of payment confirmation. Orders placed on weekends or public holidays are processed the next business day.</p>
      <h2>Delivery timelines</h2>
      <ul>
        <li>Metro cities: 3–5 business days</li>
        <li>Rest of India: 5–8 business days</li>
        <li>Remote pin codes: 8–12 business days</li>
      </ul>
      <h2>Shipping charges</h2>
      <p>Free shipping on all orders above ₹1,999. A flat fee of ₹79 applies to orders below this amount.</p>
      <h2>Order tracking</h2>
      <p>Once your order ships, you will receive a tracking link via email/SMS. You can also track your order anytime on our <a href="/track-order" className="text-brand-magenta font-semibold">Track Order</a> page using your order ID.</p>
      <h2>Delays</h2>
      <p>While we strive to meet the timelines above, deliveries may occasionally be delayed due to weather, courier disruptions, or events beyond our control. For any concerns write to {COMPANY.email} or call {COMPANY.phone}.</p>
    </PageShell>
  );
}

export function RefundPolicy() {
  return (
    <PageShell title="Refund Policy" eyebrow="Help" testId="refund-policy-page">
      <h2>Returns window</h2>
      <p>We accept returns within 7 days of delivery. Items must be unworn, unwashed, with all original tags and packaging intact.</p>
      <h2>Non-returnable items</h2>
      <ul>
        <li>Items marked "Final Sale"</li>
        <li>Innerwear and accessories, for hygiene reasons</li>
        <li>Items damaged due to misuse or normal wear</li>
      </ul>
      <h2>How to initiate a return</h2>
      <p>Email {COMPANY.email} with your order ID and reason for return. Our team will arrange a reverse pickup within 2–3 business days where serviceable, or guide you on self-shipping.</p>
      <h2>Refund processing</h2>
      <p>Once the returned item passes quality check, refunds are issued to the original payment method within 5–7 business days. Razorpay refunds may take an additional 2–3 days to reflect depending on your bank.</p>
      <h2>Exchanges</h2>
      <p>Size exchanges are free of charge, subject to stock availability. Request an exchange the same way as a return.</p>
    </PageShell>
  );
}

export function CancellationPolicy() {
  return (
    <PageShell title="Cancellation Policy" eyebrow="Help" testId="cancellation-policy-page">
      <h2>Before dispatch</h2>
      <p>You may cancel your order free of charge any time before it is dispatched. Write to {COMPANY.email} or call {COMPANY.phone} with your order ID. A full refund will be issued to your original payment method within 5–7 business days.</p>
      <h2>After dispatch</h2>
      <p>Once an order has been dispatched it can no longer be cancelled. You may instead refuse delivery or initiate a return after receiving the item, as per our <a href="/refund-policy" className="text-brand-magenta font-semibold">Refund Policy</a>.</p>
      <h2>Cancellation by CRESTUS</h2>
      <p>We reserve the right to cancel orders in cases of pricing errors, stock unavailability, or suspected fraudulent activity. In such cases the full amount paid is refunded immediately.</p>
    </PageShell>
  );
}

export function PrivacyPolicy() {
  return (
    <PageShell title="Privacy Policy" eyebrow="Company" testId="privacy-policy-page">
      <p>{COMPANY.legalName} ("we", "us") is committed to protecting your privacy. This policy explains what data we collect and how we use it when you use our e-commerce platform.</p>
      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account data</strong> — name, email address, and profile picture when you sign in with Google.</li>
        <li><strong>Order data</strong> — delivery address, phone number, and purchase history.</li>
        <li><strong>Payment data</strong> — payments are processed securely by Razorpay; we never store your card, UPI, or banking details.</li>
        <li><strong>Usage data</strong> — device, browser, and interaction data to improve the shopping experience.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To process and deliver your orders</li>
        <li>To provide customer support and order updates</li>
        <li>To improve our products, website, and services</li>
        <li>To comply with legal and tax obligations</li>
      </ul>
      <h2>Sharing</h2>
      <p>We share data only with service partners essential to fulfilling your order — payment gateways (Razorpay), courier partners, and IT providers. We never sell your personal data.</p>
      <h2>Your rights</h2>
      <p>You may request access, correction, or deletion of your personal data by writing to {COMPANY.email}.</p>
      <h2>Contact</h2>
      <p>{COMPANY.legalName}, {COMPANY.address} · {COMPANY.email} · {COMPANY.phone}</p>
    </PageShell>
  );
}

export function TermsOfService() {
  return (
    <PageShell title="Terms of Service" eyebrow="Company" testId="terms-page">
      <p>These Terms of Service govern your use of the CRESTUS e-commerce platform operated by {COMPANY.legalName}. By accessing or purchasing from our website you agree to these terms.</p>
      <h2>1. Eligibility</h2>
      <p>You must be at least 18 years of age, or use the platform under supervision of a legal guardian, to place orders.</p>
      <h2>2. Products & pricing</h2>
      <p>All prices are listed in Indian Rupees (INR) and are inclusive of applicable GST. We reserve the right to modify prices, product listings, and availability at any time without notice.</p>
      <h2>3. Orders & payment</h2>
      <p>An order is confirmed only upon successful payment through our payment partner, Razorpay. We may cancel orders as described in our Cancellation Policy.</p>
      <h2>4. Shipping, returns & refunds</h2>
      <p>Shipping, returns, refunds, and cancellations are governed by our respective policies published on this website, which form part of these terms.</p>
      <h2>5. Intellectual property</h2>
      <p>All content on this platform — including the CRESTUS name, logo, product imagery, and copy — is the property of {COMPANY.legalName} or its licensors and may not be reproduced without written consent.</p>
      <h2>6. Limitation of liability</h2>
      <p>To the maximum extent permitted by law, our liability for any claim arising out of a purchase is limited to the amount paid for the relevant order.</p>
      <h2>7. Governing law</h2>
      <p>These terms are governed by the laws of India. Courts at Ahmedabad, Gujarat shall have exclusive jurisdiction.</p>
      <h2>8. Contact</h2>
      <p>{COMPANY.legalName} · CIN: {COMPANY.cin} · GSTIN: {COMPANY.gstin} · {COMPANY.email} · {COMPANY.phone}</p>
    </PageShell>
  );
}
