import { Link, useNavigate } from "react-router-dom";
import { ShoppingBag, Package, LogOut, User } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export const Header = () => {
  const { count, setDrawerOpen } = useCart();
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/80 border-b border-zinc-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link to="/" data-testid="header-logo" className="font-display font-semibold text-xl tracking-tighter">
          CRESTUS<span className="text-brand-magenta">.</span>
        </Link>
        <nav className="flex items-center gap-6 sm:gap-8">
          <Link to="/shop?c=men" data-testid="nav-men" className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-700 hover:text-brand-magenta transition-colors">
            Men
          </Link>
          <Link to="/shop?c=women" data-testid="nav-women" className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-700 hover:text-brand-magenta transition-colors">
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
                <button data-testid="user-menu-button" className="flex items-center" aria-label="Account menu">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full border border-zinc-200" />
                  ) : (
                    <User size={19} strokeWidth={1.8} />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem data-testid="menu-orders" onClick={() => navigate("/orders")}>
                  <Package size={15} className="mr-2" /> My Orders
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="menu-logout" onClick={logout}>
                  <LogOut size={15} className="mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              data-testid="login-button"
              onClick={login}
              className="text-xs font-semibold uppercase tracking-[0.18em] bg-ink text-white px-4 py-2 rounded-full hover:bg-brand-magenta transition-colors"
            >
              Sign in
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};
