import api from "./api";
import { openRazorpayCheckout } from "./razorpay";

export async function openPaymentCheckout(session) {
  if (session.gateway !== "razorpay") throw new Error("This payment gateway is no longer supported. Please contact support.");
  const result = await openRazorpayCheckout(session);
  if (!result.error) {
    if (!result.razorpay_order_id || !result.razorpay_payment_id || !result.razorpay_signature) throw new Error("Incomplete payment response");
    try {
      await api.post(`/orders/${encodeURIComponent(session.order_id)}/verify`, {
        razorpay_order_id: result.razorpay_order_id,
        razorpay_payment_id: result.razorpay_payment_id,
        razorpay_signature: result.razorpay_signature,
      });
    } catch (error) {
      if ([400, 401, 403, 404].includes(error.response?.status)) throw error;
      // A network/provider timeout leaves verification to the pending page and server reconciler.
    }
  }
  return result;
}
