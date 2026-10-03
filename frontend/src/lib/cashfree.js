// Loads the Cashfree JS SDK v3 once and opens the hosted checkout modal for a payment session.
export const loadCashfree = () =>
  new Promise((resolve) => {
    if (window.Cashfree) return resolve(window.Cashfree);
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.onload = () => resolve(window.Cashfree);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });

// Resolves when the modal closes. The result only says the modal finished — payment truth comes from the backend.
export async function openCashfreeCheckout({ paymentSessionId, environment }) {
  const CashfreeSDK = await loadCashfree();
  if (!CashfreeSDK) throw new Error("Could not load Cashfree Checkout SDK");
  const cashfree = CashfreeSDK({ mode: environment || "production" });
  return cashfree.checkout({ paymentSessionId, redirectTarget: "_modal" });
}
