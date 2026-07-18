import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useCart } from "../context/CartContext";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [size, setSize] = useState(null);
  const { addItem } = useCart();

  useEffect(() => {
    window.scrollTo(0, 0);
    api.get(`/products/${id}`).then(({ data }) => setProduct(data)).catch(() => {});
  }, [id]);

  if (!product) {
    return <div className="pt-40 text-center text-zinc-400 min-h-screen">Loading…</div>;
  }

  const handleAdd = () => {
    if (!size) {
      toast.error("Please select a size first");
      return;
    }
    addItem(product, size);
    toast.success(`${product.name} added to your bag`);
  };

  return (
    <div data-testid="product-detail-page" className="max-w-7xl mx-auto px-6 lg:px-10 pt-24 pb-24 min-h-screen">
      <Link to="/shop" data-testid="back-to-shop" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-brand-magenta transition-colors mb-8">
        <ChevronLeft size={14} /> Back to shop
      </Link>
      <div className="grid md:grid-cols-2 gap-10 lg:gap-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-100"
        >
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
          {product.badge && (
            <span className="absolute top-4 left-4 bg-white/90 backdrop-blur text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full text-brand-maroon">
              {product.badge}
            </span>
          )}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="pt-2"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-4">
            {product.category === "men" ? "Menswear" : "Womenswear"}{product.subcategory ? ` · ${product.subcategory}` : ""}
          </p>
          <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl">{product.name}</h1>
          <p data-testid="product-price" className="mt-4 flex items-baseline gap-3">
            <span className="font-display text-2xl font-medium">{inr(product.price)}</span>
            {product.mrp > product.price && (
              <>
                <s className="text-zinc-400 text-base">{inr(product.mrp)}</s>
                <span className="text-brand-magenta font-bold text-sm">{Math.round((1 - product.price / product.mrp) * 100)}% OFF</span>
              </>
            )}
          </p>
          <p className="text-zinc-600 leading-relaxed mt-6 max-w-md text-sm md:text-base">{product.description}</p>

          <div className="mt-8 space-y-2 text-sm">
            <p><span className="text-zinc-400 uppercase text-xs tracking-widest mr-3">Fabric</span> {product.fabric}</p>
            <p><span className="text-zinc-400 uppercase text-xs tracking-widest mr-3">Colour</span> {product.color}</p>
          </div>

          <div className="mt-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Select size</p>
            <div className="flex flex-wrap gap-2">
              {product.sizes.map((s) => (
                <button
                  key={s}
                  data-testid={`size-option-${s}`}
                  onClick={() => setSize(s)}
                  className={`min-w-[52px] px-4 py-2.5 rounded-full text-sm font-semibold border-2 transition-colors ${
                    size === s ? "border-brand-magenta bg-brand-magenta text-white" : "border-zinc-200 hover:border-ink"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            data-testid="add-to-cart-button"
            onClick={handleAdd}
            className="mt-10 w-full md:w-auto bg-ink text-white px-12 py-4 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
          >
            Add to bag — {inr(product.price)}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
