import { Link, useNavigate } from "react-router-dom";
import { ShoppingBag, Package, LogOut, User, ShieldCheck } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export const Header = () => {
  const { count, setDrawerOpen } = useCart();
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/80 border-b border-zinc-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link to="/" data-testid="header-logo" className="font-display font-semibold text-xl tracking-tighter shrink-0">
          CRESTUS<span className="text-brand-magenta">.</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-8">
          <Link to="/shop?c=men" data-testid="nav-men" className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.18em] text-zinc-700 hover:text-brand-magenta transition-colors">
            Men
          </Link>
          <Link to="/shop?c=women" data-testid="nav-women" className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.18em] text-zinc-700 hover:text-brand-magenta transition-colors">
            Women
          </Link>
          <button
            data-testid="cart-button"
            onClick={() => setDrawerOpen(true)}
            className="relative p-2 hover:text-brand-magenta transition-colors"
            aria-label="Open cart"
          >
            <ShoppingBag size={19} strokeWidth={1.8} />
            {count > 0 && (
              <span data-testid="cart-count" className="absolute -top-0.5 -right-0.5 bg-brand-magenta text-white text-[10px] font-bold rounded-full w-4.5 h-4.5 min-w-[18px] min-h-[18px] flex items-center justify-center">
                {count}
              </span>
            )}
          </button>
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button data-testid="user-menu-button" className="flex items-center gap-2 focus:outline-none" aria-label="Account menu">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full border border-zinc-200 object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 border border-zinc-200">
                      <User size={15} strokeWidth={1.8} />
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-1.5">
                <DropdownMenuLabel className="font-normal px-2 py-1.5">
                  <p className="text-xs font-semibold text-zinc-900 truncate">{user.name || "My Account"}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-testid="menu-orders" onClick={() => navigate("/orders")} className="cursor-pointer">
                  <Package size={15} className="mr-2" /> My Orders
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem data-testid="menu-admin" onClick={() => navigate("/admin/orders")} className="cursor-pointer">
                    <ShieldCheck size={15} className="mr-2" /> Admin · Fulfillment
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem data-testid="menu-logout" onClick={logout} className="cursor-pointer text-rose-600 focus:text-rose-600">
                  <LogOut size={15} className="mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              data-testid="login-button"
              onClick={() => navigate("/login")}
              className="inline-flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.16em] bg-ink text-white px-2.5 sm:px-3.5 py-1.5 rounded-full hover:bg-brand-magenta transition-colors whitespace-nowrap"
            >
              <User size={14} aria-hidden="true" />
              <span>Sign in</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};
