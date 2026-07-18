import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { ProductCard } from "../components/ProductCard";

const TABS = [
  { key: "", label: "All" },
  { key: "men", label: "Men" },
  { key: "women", label: "Women" },
];

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get("c") || "";
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get("/products", { params: category ? { category } : {} })
      .then(({ data }) => setProducts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category]);

  return (
    <div data-testid="shop-page" className="max-w-7xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-3">The Collection</p>
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl lg:text-6xl">
        {category === "men" ? "Men" : category === "women" ? "Women" : "Shop All"}
      </h1>

      <div className="flex gap-2 mt-8 mb-12">
        {TABS.map((t) => (
          <button
            key={t.key || "all"}
            data-testid={`filter-${t.key || "all"}`}
            onClick={() => setSearchParams(t.key ? { c: t.key } : {})}
            className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-colors ${
              category === t.key ? "bg-ink text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
          {Array.from({ length: 8 }).map((_, i) => (
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
