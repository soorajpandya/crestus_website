import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Lenis from "lenis";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { Header } from "@/components/Header";
import { CartDrawer } from "@/components/CartDrawer";
import { Footer } from "@/components/Footer";
import Home from "@/pages/Home";
import Shop from "@/pages/Shop";
import ProductDetail from "@/pages/ProductDetail";
import Checkout from "@/pages/Checkout";
import Orders from "@/pages/Orders";
import AuthCallback from "@/pages/AuthCallback";
import Collection from "@/pages/Collection";
import FAQ from "@/pages/FAQ";
import Contact from "@/pages/Contact";
import TrackOrder from "@/pages/TrackOrder";
import CookiePreferences from "@/pages/CookiePreferences";
import { About, ShippingPolicy, RefundPolicy, CancellationPolicy, PrivacyPolicy, TermsOfService } from "@/pages/StaticPages";

function LenisWrapper({ children }) {
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    const lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    let rafId;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);
  return children;
}

function AppRouter() {
  const location = useLocation();
  // Handle OAuth callback BEFORE normal routing (session_id arrives in URL fragment)
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <>
      <Header />
      <CartDrawer />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/new-arrivals" element={<Collection type="new" />} />
        <Route path="/best-sellers" element={<Collection type="best" />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/shipping-policy" element={<ShippingPolicy />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/cancellation-policy" element={<CancellationPolicy />} />
        <Route path="/track-order" element={<TrackOrder />} />
        <Route path="/about" element={<About />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/cookie-preferences" element={<CookiePreferences />} />
      </Routes>
      <Footer />
    </>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <LenisWrapper>
              <AppRouter />
            </LenisWrapper>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

export default App;
