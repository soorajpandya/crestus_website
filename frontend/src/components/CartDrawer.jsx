import { useNavigate } from "react-router-dom";
import { Minus, Plus, X } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

export const CartDrawer = () => {
  const { items, updateQty, removeItem, total, drawerOpen, setDrawerOpen } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleCheckout = () => {
    setDrawerOpen(false);
    if (!user) {
      navigate("/login?redirect=/checkout");
    } else {
      navigate("/checkout");
    }
  };

  return (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <SheetContent data-testid="cart-drawer" aria-describedby={undefined} className="w-full sm:max-w-md flex flex-col bg-white">
        <SheetHeader>
          <SheetTitle className="font-display tracking-tight">Your Bag ({items.length})</SheetTitle>
        </SheetHeader>
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <p data-testid="cart-empty-message" className="text-sm">Your bag is empty.</p>
            <button
              data-testid="cart-continue-shopping"
              onClick={() => { setDrawerOpen(false); navigate("/shop"); }}
              className="text-xs font-semibold uppercase tracking-widest text-brand-magenta hover:text-brand-maroon transition-colors"
            >
              Continue shopping →
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto py-4 space-y-5">
              {items.map((item) => (
                <div key={item.key} data-testid={`cart-item-${item.product_id}`} className="flex gap-4">
                  <img src={item.image} alt={item.name} className="w-20 h-[104px] object-cover rounded-lg bg-zinc-100" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-sm font-semibold truncate">{item.name}</p>
                      <button data-testid={`cart-remove-${item.product_id}`} onClick={() => removeItem(item.key)} className="text-zinc-400 hover:text-brand-maroon transition-colors" aria-label="Remove item">
                        <X size={15} />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">Size {item.size}</p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-3 border border-zinc-200 rounded-full px-2 py-1">
                        <button data-testid={`cart-qty-minus-${item.product_id}`} onClick={() => updateQty(item.key, item.qty - 1)} aria-label="Decrease quantity"><Minus size={13} /></button>
                        <span className="text-xs font-semibold w-4 text-center">{item.qty}</span>
                        <button data-testid={`cart-qty-plus-${item.product_id}`} onClick={() => updateQty(item.key, item.qty + 1)} aria-label="Increase quantity"><Plus size={13} /></button>
                      </div>
                      <p className="text-sm font-bold">{inr(item.price * item.qty)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-100 pt-4 space-y-4">
              <div className="flex justify-between items-baseline">
                <span className="text-xs uppercase tracking-widest text-zinc-500">Subtotal</span>
                <span data-testid="cart-total" className="font-display text-xl font-semibold">{inr(total)}</span>
              </div>
              <button
                data-testid="checkout-button"
                onClick={handleCheckout}
                className="w-full bg-ink text-white py-3.5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-brand-magenta transition-colors"
              >
                Checkout
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
