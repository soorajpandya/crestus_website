import { openRazorpayCheckout } from "./razorpay";

const session = { key_id: "rzp_test_fake", razorpay_order_id: "order_fake", amount_minor: 12345, currency: "INR", prefill: { email: "test@example.invalid" } };
let options;
let failed;

beforeEach(() => {
  options = undefined;
  window.Razorpay = jest.fn().mockImplementation(value => {
    options = value;
    return { on: (name, callback) => { failed = callback; }, open: jest.fn() };
  });
});
afterEach(() => { delete window.Razorpay; });

test("checkout uses the server order, public key, exact paise and signed callback", async () => {
  const pending = openRazorpayCheckout(session);
  await Promise.resolve();
  expect(options.key).toBe(session.key_id);
  expect(options.order_id).toBe(session.razorpay_order_id);
  expect(options.amount).toBe(12345);
  expect(options.currency).toBe("INR");
  expect(options.prefill).toEqual(session.prefill);
  const callback = { razorpay_order_id: "order_fake", razorpay_payment_id: "pay_fake", razorpay_signature: "signed" };
  options.handler(callback);
  await expect(pending).resolves.toEqual(callback);
});

test("a failed attempt leaves modal retries available; closing resolves without payment success", async () => {
  const pending = openRazorpayCheckout(session);
  await Promise.resolve();
  failed({ error: { description: "Bank declined" } });
  options.modal.ondismiss();
  await expect(pending).resolves.toEqual({ error: { message: "Bank declined" } });
});

test("invalid checkout session cannot open a payment modal", async () => {
  await expect(openRazorpayCheckout({ ...session, amount_minor: 1.5 })).rejects.toThrow("initialize");
  await expect(openRazorpayCheckout({ ...session, razorpay_order_id: null })).rejects.toThrow("initialize");
  expect(window.Razorpay).not.toHaveBeenCalled();
});

test("SDK loading is shared and failed network loads can be retried", async () => {
  delete window.Razorpay;
  const { loadRazorpay } = require("./razorpay");
  const first = loadRazorpay();
  const duplicate = loadRazorpay();
  expect(first).toBe(duplicate);
  const script = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
  script.onerror();
  await expect(first).rejects.toThrow("Could not load");
  const retried = loadRazorpay();
  window.Razorpay = jest.fn();
  document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]').onload();
  await expect(retried).resolves.toBe(window.Razorpay);
});
