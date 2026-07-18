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
  const [sub, setSub] = useState("");

  useEffect(() => {
    setLoading(true);
    setSub("");
    api.get("/products", { params: category ? { category } : {} })
      .then(({ data }) => setProducts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category]);

  const subcats = [...new Set(products.map((p) => p.subcategory).filter(Boolean))].sort();
  const visible = sub ? products.filter((p) => p.subcategory === sub) : products;

  return (
    <div data-testid="shop-page" className="max-w-7xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-3">The Collection</p>
      <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl lg:text-6xl">
        {category === "men" ? "Men" : category === "women" ? "Women" : "Shop All"}
      </h1>

      <div className="flex gap-2 mt-8 mb-6">
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

      {!loading && subcats.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-12">
          <button
            data-testid="subfilter-all"
            onClick={() => setSub("")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              !sub ? "border-brand-magenta text-brand-magenta" : "border-zinc-200 text-zinc-500 hover:border-zinc-400"
            }`}
          >
            All Categories
          </button>
          {subcats.map((s) => (
            <button
              key={s}
              data-testid={`subfilter-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              onClick={() => setSub(s === sub ? "" : s)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                sub === s ? "border-brand-magenta text-brand-magenta" : "border-zinc-200 text-zinc-500 hover:border-zinc-400"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-2xl bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
          {visible.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      )}
    </div>
  );
}
