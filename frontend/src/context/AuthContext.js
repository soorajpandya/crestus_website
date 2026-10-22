import { createContext, useContext, useState, useEffect } from "react";
import { onIdTokenChanged, reload } from "firebase/auth";
import {
  auth, signInWithGoogle, signInWithEmail, createEmailAccount,
  resetEmailPassword, verifyEmail, logOut, getAdditionalUserInfo,
} from "../lib/firebase";
import api from "../lib/api";
import { toast } from "sonner";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState(false);

  useEffect(() => {
    let revision = 0;
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      const currentRevision = ++revision;
      setIsAdmin(false);
      setRoleLoading(Boolean(firebaseUser));
      setRoleError(false);
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          emailVerified: firebaseUser.emailVerified,
          displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
          name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
          photoURL: firebaseUser.photoURL,
          picture: firebaseUser.photoURL,
        });
        // Roles remain server-controlled. Ignore responses from a previous session.
        api.get("/auth/me").then(({ data }) => {
          if (revision === currentRevision) { setIsAdmin(Boolean(data?.is_admin)); setRoleLoading(false); }
        }).catch(() => {
          if (revision === currentRevision) { setIsAdmin(false); setRoleError(true); setRoleLoading(false); }
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => { revision++; unsubscribe(); };
  }, []);

  const login = async () => {
    try {
      const result = await signInWithGoogle();
      const signedInUser = result.user;
      toast.success(`Welcome, ${signedInUser.displayName || "back"}!`);
      // Trigger welcome email if this is a first-time Google sign-up
      const isNewUser = Boolean(getAdditionalUserInfo(result)?.isNewUser) || (signedInUser.metadata?.creationTime === signedInUser.metadata?.lastSignInTime);
      if (isNewUser) {
        api.post("/auth/welcome-email", {
          email: signedInUser.email,
          name: signedInUser.displayName || signedInUser.email.split("@")[0],
        }).catch((err) => {
          console.warn("[Auth] Could not send welcome email:", err.message);
        });
      }
      return signedInUser;
    } catch (error) {
      if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") return null;
      throw error;
    }
  };

  const loginWithEmail = async (email, password) => {
    const { user: signedInUser } = await signInWithEmail(email, password);
    toast.success("Welcome back!");
    return signedInUser;
  };

  const signupWithEmail = async (email, password) => {
    const { user: newUser } = await createEmailAccount(email, password);
    // Trigger welcome email in background
    api.post("/auth/welcome-email", {
      email: newUser.email,
      name: newUser.displayName || newUser.email.split("@")[0],
    }).catch((err) => {
      console.warn("[Auth] Could not send welcome email:", err.message);
    });
    toast.success("Account created successfully. Welcome to Crestus!");
    return newUser;
  };

  const refreshUser = async () => {
    if (!auth.currentUser) return;
    await reload(auth.currentUser);
    await auth.currentUser.getIdToken(true);
  };

  const logout = async () => {
    try {
      await logOut();
      setUser(null);
      toast.success("Signed out successfully");
    } catch {
      toast.error("Failed to sign out");
    }
  };

  return (
    <AuthContext.Provider value={{
      user, setUser, loading, isAdmin, roleLoading, roleError, login, logout, signInWithGoogle: login,
      loginWithEmail, signupWithEmail, resetPassword: resetEmailPassword,
      sendVerification: verifyEmail, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
