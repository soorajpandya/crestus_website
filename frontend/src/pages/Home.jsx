import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import api from "../lib/api";
import { ProductCard } from "../components/ProductCard";
import { MarqueeBand } from "../components/MarqueeBand";
import { OfferBanner } from "../components/OfferBanner";
import NewsletterSubscribe from "../components/NewsletterSubscribe";

const CHAPTERS = [
  { num: "01", title: "Fabric first", body: "Every piece begins at the mill. Merino, selvedge, silk crepe — materials chosen to outlast trends." },
  { num: "02", title: "Cut with intent", body: "Silhouettes engineered on real bodies. Nothing boxy by accident, nothing tight by mistake." },
  { num: "03", title: "Worn for years", body: "We design for the hundredth wear, not the first photo. Buy less, wear more, look better." },
];

export default function Home() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api.get("/products").then(({ data }) => setProducts(data)).catch(() => {});
  }, []);

  const featured = products.slice(0, 8);

  return (
    <div data-testid="home-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pt-24 pb-8">
        <OfferBanner />
      </div>
      <MarqueeBand />

      {/* Featured grid */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-3">The Edit</p>
            <h2 className="font-display font-semibold tracking-tighter text-base md:text-lg lg:text-lg uppercase">Featured this week</h2>
          </div>
          <Link to="/shop" data-testid="view-all-link" className="text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-brand-magenta transition-colors shrink-0">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
          {featured.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      </section>

      {/* Campaign edits */}
      <section aria-label="Shop the Crestus edits" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pb-24 grid lg:grid-cols-2 gap-6">
        <OfferBanner campaign="everyday" compact />
        <OfferBanner campaign="street" compact />
      </section>

      {/* Manifesto */}
      <section className="bg-zinc-50 border-y border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-14">The Crestus Manifesto</p>
          <div className="space-y-20">
            {CHAPTERS.map((ch, i) => (
              <motion.div
                key={ch.num}
                initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className={`flex flex-col md:flex-row gap-6 md:gap-16 items-start ${i % 2 === 1 ? "md:ml-24" : ""}`}
              >
                <span className="font-display font-light text-7xl lg:text-8xl text-brand-magenta leading-none shrink-0">{ch.num}</span>
                <div className="pt-2">
                  <h3 className="font-display font-semibold text-base md:text-lg tracking-tight uppercase">{ch.title}</h3>
                  <p className="text-zinc-600 mt-3 max-w-lg leading-relaxed text-sm md:text-base">{ch.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <NewsletterSubscribe />
      <MarqueeBand dark />
    </div>
  );
}
