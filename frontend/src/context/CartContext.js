import { createContext, useContext, useState, useEffect } from "react";
import { track } from "../lib/firebase";

const CartContext = createContext(null);
const STORAGE_KEY = "crestus_cart";

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = (product, size) => {
    track("add_to_cart", {
      currency: "INR",
      value: product.price,
      items: [{ item_id: product.id, item_name: product.name, item_category: product.subcategory, price: product.price, quantity: 1 }],
    });
    setItems((prev) => {
      const key = `${product.id}-${size}`;
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { key, product_id: product.id, name: product.name, price: product.price, image: product.image, size, qty: 1 }];
    });
    setDrawerOpen(true);
  };

  const updateQty = (key, qty) => {
    if (qty < 1) return removeItem(key);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, qty } : i)));
  };

  const removeItem = (key) => {
    const item = items.find((i) => i.key === key);
    if (item) {
      track("remove_from_cart", {
        currency: "INR",
        value: item.price * item.qty,
        items: [{ item_id: item.product_id, item_name: item.name, price: item.price, quantity: item.qty }],
      });
    }
    setItems((prev) => prev.filter((i) => i.key !== key));
  };
  const clearCart = () => setItems([]);

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const count = items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <CartContext.Provider value={{ items, addItem, updateQty, removeItem, clearCart, total, count, drawerOpen, setDrawerOpen }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
