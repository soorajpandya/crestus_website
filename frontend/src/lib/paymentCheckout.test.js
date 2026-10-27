import api from "./api";
import { openRazorpayCheckout } from "./razorpay";
import { openPaymentCheckout } from "./paymentCheckout";

jest.mock("./api", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("./razorpay", () => ({ openRazorpayCheckout: jest.fn() }));

const session = { gateway: "razorpay", order_id: "ord_internal", key_id: "rzp_test_fake", razorpay_order_id: "order_fake", amount_minor: 12345, currency: "INR" };
const signed = { razorpay_order_id: "order_fake", razorpay_payment_id: "pay_fake", razorpay_signature: "signed" };
beforeEach(() => { jest.clearAllMocks(); api.post.mockReset(); openRazorpayCheckout.mockResolvedValue(signed); });

test("Razorpay success sends all signature fields to the owned server order before returning", async () => {
  await expect(openPaymentCheckout(session)).resolves.toEqual(signed);
  expect(openRazorpayCheckout).toHaveBeenCalledWith(session);
  expect(api.post).toHaveBeenCalledWith("/orders/ord_internal/verify", signed);
});

test("modal dismissal neither submits a signature nor reports payment success", async () => {
  const dismissed = { error: { message: "Payment was not completed" } };
  openRazorpayCheckout.mockResolvedValue(dismissed);
  await expect(openPaymentCheckout(session)).resolves.toEqual(dismissed);
  expect(api.post).not.toHaveBeenCalled();
});

test("forged signature rejection is surfaced, while network uncertainty reaches server polling", async () => {
  const forged = { response: { status: 401 } };
  api.post.mockRejectedValueOnce(forged);
  await expect(openPaymentCheckout(session)).rejects.toBe(forged);
  api.post.mockRejectedValueOnce(new Error("Network Error"));
  await expect(openPaymentCheckout(session)).resolves.toEqual(signed);
});

test("incomplete callback never submits verification", async () => {
  openRazorpayCheckout.mockResolvedValue({ razorpay_payment_id: "pay_fake" });
  await expect(openPaymentCheckout(session)).rejects.toThrow("Incomplete");
  expect(api.post).not.toHaveBeenCalled();
});

test("retired or unknown gateways cannot open checkout or submit verification", async () => {
  for (const gateway of ["cashfree", "unknown", undefined]) {
    await expect(openPaymentCheckout({ gateway, payment_session_id: "old_session" })).rejects.toThrow("no longer supported");
  }
  expect(openRazorpayCheckout).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
