import { Link } from "react-router-dom";
import { motion } from "framer-motion";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

export const ProductCard = ({ product, index = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-40px" }}
    transition={{ duration: 0.55, delay: (index % 4) * 0.07, ease: [0.22, 1, 0.36, 1] }}
  >
    <Link to={`/product/${product.id}`} data-testid={`product-card-${product.id}`} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-100">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
        />
        {product.badge && (
          <span className="absolute top-3 left-3 bg-white/90 backdrop-blur text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-brand-maroon">
            {product.badge}
          </span>
        )}
      </div>
      <div className="mt-3 flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate group-hover:text-brand-magenta transition-colors">{product.name}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{product.subcategory || product.color}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold">{inr(product.price)}</p>
          {product.mrp > product.price && (
            <p className="text-xs">
              <s className="text-zinc-400">{inr(product.mrp)}</s>{" "}
              <span className="text-brand-magenta font-bold">-{Math.round((1 - product.price / product.mrp) * 100)}%</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  </motion.div>
);
