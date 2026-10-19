import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const hasProcessed = useRef(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const sessionId = params.get("session_id");

    (async () => {
      try {
        const { data } = await api.post("/auth/session", { session_id: sessionId });
        setUser(data);
      } catch {}
      const path = window.location.pathname || "/";
      window.history.replaceState(null, "", path);
      navigate(path, { replace: true });
    })();
  }, [navigate, setUser]);

  return (
    <div data-testid="auth-callback" className="min-h-screen flex items-center justify-center">
      <p className="text-zinc-400 text-sm">Signing you in…</p>
    </div>
  );
}
