let sdkPromise;

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const fail = () => {
        clearTimeout(timer);
        script.remove();
        sdkPromise = undefined;
        reject(new Error("Could not load Razorpay Checkout. Please try again."));
      };
      const timer = setTimeout(fail, 20000);
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => {
        if (!window.Razorpay) return fail();
        clearTimeout(timer);
        resolve(window.Razorpay);
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export async function openRazorpayCheckout(session) {
  if (!session.key_id || !session.razorpay_order_id || !Number.isSafeInteger(session.amount_minor) || session.amount_minor <= 0 || !session.currency) {
    throw new Error("Could not initialize Razorpay Checkout");
  }
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    let failure;
    const checkout = new Razorpay({
      key: session.key_id,
      order_id: session.razorpay_order_id,
      amount: session.amount_minor,
      currency: session.currency,
      name: "Crestus",
      description: "Crestus order",
      prefill: session.prefill || {},
      theme: { color: "#D63384" },
      handler: response => resolve(response),
      modal: { ondismiss: () => resolve({ error: { message: failure || "Payment was not completed" } }) },
    });
    // Razorpay keeps the modal open after a failure so customers can try another method.
    checkout.on("payment.failed", response => { failure = response.error?.description; });
    try { checkout.open(); } catch (error) { reject(error); }
  });
}
