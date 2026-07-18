import { Link } from "react-router-dom";

export const Footer = () => (
  <footer className="bg-ink text-white mt-0">
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20">
      <div className="flex flex-col md:flex-row justify-between gap-12">
        <div>
          <p className="font-display font-semibold text-3xl tracking-tighter">
            CRESTUS<span className="text-brand-magenta">.</span>
          </p>
          <p className="text-zinc-400 text-sm mt-4 max-w-xs leading-relaxed">
            Premium clothing for men and women. Cut with intent, worn for years.
          </p>
        </div>
        <div className="flex gap-16">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest text-zinc-500">Shop</p>
            <Link to="/shop?c=men" data-testid="footer-men" className="block text-sm text-zinc-300 hover:text-brand-magenta transition-colors">Men</Link>
            <Link to="/shop?c=women" data-testid="footer-women" className="block text-sm text-zinc-300 hover:text-brand-magenta transition-colors">Women</Link>
            <Link to="/shop" data-testid="footer-all" className="block text-sm text-zinc-300 hover:text-brand-magenta transition-colors">All Products</Link>
          </div>
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest text-zinc-500">Account</p>
            <Link to="/orders" data-testid="footer-orders" className="block text-sm text-zinc-300 hover:text-brand-magenta transition-colors">My Orders</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-zinc-800 mt-16 pt-6 flex justify-between text-xs text-zinc-500">
        <p>© 2026 Crestus. All rights reserved.</p>
        <p>Made for the moment.</p>
      </div>
    </div>
  </footer>
);
