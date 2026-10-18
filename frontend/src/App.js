import { lazy, Suspense, useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Lenis from "lenis";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { AdminLayout, AdminOverview, AdminOrdersPage, AdminCatalog, AdminCustomers, AdminSettings, AdminNotFound } from "@/pages/AdminPanel";
import { isAdminHost } from "@/lib/adminUi";
import { track } from "@/lib/firebase";
const Header = lazy(() => import("@/components/Header").then(module => ({ default: module.Header })));
const CartDrawer = lazy(() => import("@/components/CartDrawer").then(module => ({ default: module.CartDrawer })));
const Footer = lazy(() => import("@/components/Footer").then(module => ({ default: module.Footer })));
const Home = lazy(() => import("@/pages/Home"));
const Shop = lazy(() => import("@/pages/Shop"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Orders = lazy(() => import("@/pages/Orders"));
const OrderDetail = lazy(() => import("@/pages/OrderDetail"));
const PaymentSuccess = lazy(() => import("@/pages/PaymentResult").then(module => ({ default: module.PaymentSuccess })));
const PaymentFailed = lazy(() => import("@/pages/PaymentResult").then(module => ({ default: module.PaymentFailed })));
const PaymentPending = lazy(() => import("@/pages/PaymentResult").then(module => ({ default: module.PaymentPending })));
const AdminOrderDetail = lazy(() => import("@/pages/AdminOrders").then(module => ({ default: module.AdminOrderDetail })));
const Login = lazy(() => import("@/pages/Login"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const Collection = lazy(() => import("@/pages/Collection"));
const FAQ = lazy(() => import("@/pages/FAQ"));
const Contact = lazy(() => import("@/pages/Contact"));
const TrackOrder = lazy(() => import("@/pages/TrackOrder"));
const CookiePreferences = lazy(() => import("@/pages/CookiePreferences"));
const About = lazy(() => import("@/pages/StaticPages").then(module => ({ default: module.About })));
const ShippingPolicy = lazy(() => import("@/pages/StaticPages").then(module => ({ default: module.ShippingPolicy })));
const RefundPolicy = lazy(() => import("@/pages/StaticPages").then(module => ({ default: module.RefundPolicy })));
const CancellationPolicy = lazy(() => import("@/pages/StaticPages").then(module => ({ default: module.CancellationPolicy })));
const PrivacyPolicy = lazy(() => import("@/pages/StaticPages").then(module => ({ default: module.PrivacyPolicy })));
const TermsOfService = lazy(() => import("@/pages/StaticPages").then(module => ({ default: module.TermsOfService })));

function LenisWrapper({ children }) {
  useEffect(() => {
    if (isAdminHost() || window.location.pathname.startsWith('/admin')) return;
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
  const adminHost = isAdminHost();
  useEffect(() => {
    track("page_view", { page_path: location.pathname + location.search, page_title: document.title });
  }, [location]);
  // Handle OAuth callback BEFORE normal routing (session_id arrives in URL fragment)
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  if (adminHost || location.pathname === '/admin' || location.pathname.startsWith('/admin/')) {
    return <Routes>
      {adminHost && <Route path="/login" element={<div className="admin-login"><a className="admin-login-back" href="https://crestuseccommerce.store">← Back to storefront</a><Login admin /><p className="admin-login-note">Crestus administration · Authorized accounts only</p></div>} />}
      {adminHost && <Route path="/admin/*" element={<Navigate to="/" replace />} />}
      <Route path={adminHost ? '/' : '/admin'} element={<AdminLayout />}>
        <Route index element={<AdminOverview />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="orders/:order_id" element={<AdminOrderDetail />} />
        <Route path="catalog" element={<AdminCatalog />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="*" element={<AdminNotFound />} />
      </Route>
    </Routes>;
  }
  return (
    <>
      <Header />
      <CartDrawer />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Login signup />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:order_id" element={<OrderDetail />} />
        <Route path="/success" element={<PaymentSuccess />} />
        <Route path="/failed" element={<PaymentFailed />} />
        <Route path="/pending" element={<PaymentPending />} />
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
              <Suspense fallback={<div className="admin-loading" role="status">Loading page…</div>}><AppRouter /></Suspense>
            </LenisWrapper>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

export default App;
