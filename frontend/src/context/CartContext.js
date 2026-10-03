import { createContext, useContext, useState, useEffect, useRef } from "react";
import { track, db } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import { doc, getDoc, setDoc } from "firebase/firestore";

const CartContext = createContext(null);

const getCartStorageKey = (uid) => (uid ? `crestus_cart_${uid}` : "crestus_cart_guest");

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const currentUidRef = useRef(user?.uid || null);
  const isInitialLoadRef = useRef(true);

  // Load cart user-wise whenever user state changes (login, logout, account switch)
  useEffect(() => {
    const currentUid = user?.uid || null;
    currentUidRef.current = currentUid;
    const storageKey = getCartStorageKey(currentUid);

    let localItems = [];
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        localItems = JSON.parse(stored) || [];
      }
    } catch {
      localItems = [];
    }

    // If user just logged in and had guest items, merge them into the user's cart
    if (currentUid) {
      try {
        const guestItemsRaw = localStorage.getItem("crestus_cart_guest") || localStorage.getItem("crestus_cart");
        if (guestItemsRaw) {
          const guestItems = JSON.parse(guestItemsRaw);
          if (Array.isArray(guestItems) && guestItems.length > 0) {
            const mergedMap = new Map();
            localItems.forEach((i) => mergedMap.set(i.key, i));
            guestItems.forEach((gi) => {
              if (mergedMap.has(gi.key)) {
                const ex = mergedMap.get(gi.key);
                mergedMap.set(gi.key, { ...ex, qty: ex.qty + gi.qty });
              } else {
                mergedMap.set(gi.key, gi);
              }
            });
            localItems = Array.from(mergedMap.values());
            localStorage.setItem(storageKey, JSON.stringify(localItems));
            localStorage.removeItem("crestus_cart_guest");
            localStorage.removeItem("crestus_cart"); // clean up legacy global cart
          }
        }
      } catch {}
    }

    setItems(localItems);
    isInitialLoadRef.current = false;

    // Optional Firestore cloud sync for logged-in user (silent fallback if rules/db not setup)
    if (currentUid && db) {
      getDoc(doc(db, "carts", currentUid))
        .then((docSnap) => {
          if (docSnap.exists()) {
            const cloudData = docSnap.data();
            if (Array.isArray(cloudData.items) && cloudData.items.length > 0) {
              setItems((prev) => {
                // If local items already exist, preserve; otherwise use cloud items
                if (prev.length === 0) {
                  localStorage.setItem(storageKey, JSON.stringify(cloudData.items));
                  return cloudData.items;
                }
                return prev;
              });
            }
          }
        })
        .catch(() => {
          // Non-blocking: permissions or offline mode in Firebase
        });
    }
  }, [user?.uid]);

  // Persist items user-wise whenever cart items update
  useEffect(() => {
    if (isInitialLoadRef.current) return;
    const currentUid = currentUidRef.current;
    const storageKey = getCartStorageKey(currentUid);

    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {}

    // Cloud backup in Firestore if user is signed in
    if (currentUid && db) {
      try {
        setDoc(doc(db, "carts", currentUid), {
          items,
          updated_at: new Date().toISOString(),
          user_id: currentUid,
        }, { merge: true }).catch(() => {});
      } catch {}
    }
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

  const clearCart = () => {
    setItems([]);
    const storageKey = getCartStorageKey(currentUidRef.current);
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    if (currentUidRef.current && db) {
      try {
        setDoc(doc(db, "carts", currentUidRef.current), { items: [], updated_at: new Date().toISOString() }, { merge: true }).catch(() => {});
      } catch {}
    }
  };

  // Removes only the purchased lines, so anything added mid-checkout stays in the bag.
  const removeItems = (keys = []) => {
    const set = new Set(keys);
    setItems((prev) => prev.filter((i) => !set.has(i.key)));
  };

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const count = items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <CartContext.Provider value={{ items, addItem, updateQty, removeItem, removeItems, clearCart, total, count, drawerOpen, setDrawerOpen }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
