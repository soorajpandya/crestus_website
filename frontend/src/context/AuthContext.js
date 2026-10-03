import { createContext, useContext, useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, signInWithGoogle, logOut } from "../lib/firebase";
import api from "../lib/api";
import { toast } from "sonner";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
          name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
          photoURL: firebaseUser.photoURL,
          picture: firebaseUser.photoURL,
        });
        // Role comes from the backend (custom claim or ADMIN_EMAILS); the client never decides it.
        api.get("/auth/me").then(({ data }) => setIsAdmin(Boolean(data?.is_admin))).catch(() => setIsAdmin(false));
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      setLoading(true);
      const res = await signInWithGoogle();
      const u = res.user;
      toast.success(`Welcome, ${u.displayName || "back"}!`);
      return u;
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
        return null;
      }
      if (err.code === "auth/unauthorized-domain") {
        toast.error("Domain unauthorized: Add this domain in Firebase Console -> Auth -> Settings -> Authorized Domains");
      } else {
        toast.error(err.message || "Failed to sign in with Google");
      }
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await logOut();
      setUser(null);
      toast.success("Signed out successfully");
    } catch (err) {
      toast.error("Failed to sign out");
    }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, isAdmin, login, logout, signInWithGoogle: login }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
