import { useEffect, useState } from "react";
import api from "../lib/api";
import { ProductCard } from "../components/ProductCard";

export default function Collection({ type }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const badge = type === "new" ? "New" : "Bestseller";
  const title = type === "new" ? "New Arrivals" : "Best Sellers";

  useEffect(() => {
    window.scrollTo(0, 0);
    setLoading(true);
    api.get("/products")
      .then(({ data }) => setProducts(data.filter((p) => p.badge === badge)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [badge]);

  return (
    <div data-testid={`collection-page-${type}`} className="max-w-7xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-3">The Collection</p>
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl lg:text-6xl mb-12">{title}</h1>
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-2xl bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
          {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      )}
    </div>
  );
}
