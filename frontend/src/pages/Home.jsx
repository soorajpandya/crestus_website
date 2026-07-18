import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import api from "../lib/api";
import { ProductCard } from "../components/ProductCard";
import { MarqueeBand } from "../components/MarqueeBand";

const HERO_LINES = [
  { text: "DRESS LIKE", accent: false },
  { text: "YOU MEAN", accent: false },
  { text: "IT.", accent: true },
];

const CHAPTERS = [
  { num: "01", title: "Fabric first", body: "Every piece begins at the mill. Merino, selvedge, silk crepe — materials chosen to outlast trends." },
  { num: "02", title: "Cut with intent", body: "Silhouettes engineered on real bodies. Nothing boxy by accident, nothing tight by mistake." },
  { num: "03", title: "Worn for years", body: "We design for the hundredth wear, not the first photo. Buy less, wear more, look better." },
];

const Hero = () => {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const yImg = useTransform(scrollYProgress, [0, 1], [0, 110]);
  const yImg2 = useTransform(scrollYProgress, [0, 1], [0, -70]);

  return (
    <section ref={ref} className="relative pt-28 lg:pt-36 pb-16 lg:pb-24 px-6 lg:px-10 max-w-7xl mx-auto overflow-hidden">
      <div className="grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7">
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.8 }}
            className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-6"
          >
            Menswear ✦ Womenswear — SS'26
          </motion.p>
          <h1 className="font-display font-semibold tracking-tighter leading-[0.95] text-5xl sm:text-6xl lg:text-[6.5rem]">
            {HERO_LINES.map((line, i) => (
              <span key={i} className="block overflow-hidden">
                <motion.span
                  className={`block ${line.accent ? "text-brand-magenta" : ""}`}
                  initial={{ y: "110%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, delay: 0.25 + i * 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                  {line.text}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.7 }}
            className="text-zinc-600 text-base md:text-lg max-w-md mt-8 leading-relaxed"
          >
            Precision-cut clothing for men and women. No noise, no filler — just pieces that earn their place in your wardrobe.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.7 }}
            className="flex flex-wrap gap-4 mt-10"
          >
            <Link to="/shop?c=men" data-testid="hero-shop-men" className="group inline-flex items-center gap-2 bg-ink text-white px-7 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors">
              Shop Men <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link to="/shop?c=women" data-testid="hero-shop-women" className="group inline-flex items-center gap-2 border-2 border-ink px-7 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:border-brand-magenta hover:text-brand-magenta transition-colors">
              Shop Women <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </div>
        <div className="lg:col-span-5 relative hidden md:block">
          <motion.div style={{ y: yImg }} className="relative z-10 w-[72%] ml-auto">
            <motion.img
              initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
              src="https://images.pexels.com/photos/38563258/pexels-photo-38563258.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
              alt="Womenswear editorial"
              className="aspect-[3/4] w-full object-cover rounded-2xl"
            />
          </motion.div>
          <motion.div style={{ y: yImg2 }} className="absolute -bottom-10 left-0 z-20 w-[46%]">
            <motion.img
              initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
              src="https://images.pexels.com/photos/17806235/pexels-photo-17806235.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
              alt="Menswear editorial"
              className="aspect-[3/4] w-full object-cover rounded-2xl border-4 border-white shadow-xl"
            />
          </motion.div>
          <div className="absolute -top-6 -right-6 w-40 h-40 rounded-full bg-brand-magenta/10 blur-2xl" />
        </div>
      </div>
    </section>
  );
};

export default function Home() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api.get("/products").then(({ data }) => setProducts(data)).catch(() => {});
  }, []);

  const featured = products.slice(0, 8);

  return (
    <div data-testid="home-page">
      <Hero />
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

      {/* Category split */}
      <section className="max-w-7xl mx-auto px-6 lg:px-10 pb-24 grid md:grid-cols-2 gap-6">
        {[
          { c: "men", img: "https://images.pexels.com/photos/17806235/pexels-photo-17806235.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940", label: "MEN" },
          { c: "women", img: "https://images.pexels.com/photos/38563258/pexels-photo-38563258.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940", label: "WOMEN" },
        ].map(({ c, img, label }) => (
          <motion.div
            key={c}
            initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link to={`/shop?c=${c}`} data-testid={`category-banner-${c}`} className="group relative block aspect-[4/3] overflow-hidden rounded-2xl">
              <img src={img} alt={`${label} collection`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <div className="absolute bottom-6 left-6 flex items-center gap-3">
                <span className="font-display font-semibold text-white text-3xl tracking-tighter">{label}</span>
                <span className="bg-white/20 backdrop-blur rounded-full p-2 transition-transform group-hover:translate-x-1">
                  <ArrowRight size={16} className="text-white" />
                </span>
              </div>
            </Link>
          </motion.div>
        ))}
      </section>

      {/* Manifesto */}
      <section className="bg-zinc-50 border-y border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-14">The Veloura Manifesto</p>
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

      <MarqueeBand dark />
    </div>
  );
}
