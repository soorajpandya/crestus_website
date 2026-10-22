import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Login from "./Login";
import { useAuth } from "../context/AuthContext";
import { authRedirect } from "../lib/authUi";

jest.mock("../context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("../context/CartContext", () => ({ useCart: () => ({ count: 2 }) }));
const mockNavigate = jest.fn();
let mockParams;
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockParams],
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}), { virtual: true });

let container, root, auth;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  mockParams = new URLSearchParams("redirect=/checkout");
  auth = {
    user: null, loading: false,
    login: jest.fn().mockResolvedValue({ uid: "google-user" }),
    loginWithEmail: jest.fn().mockResolvedValue({ uid: "email-user" }),
    signupWithEmail: jest.fn().mockResolvedValue({ uid: "new-user" }),
    resetPassword: jest.fn().mockResolvedValue(),
  };
  useAuth.mockImplementation(() => auth);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const find = (id) => container.querySelector(`[data-testid="${id}"]`);
const render = async (signup = false) => act(async () => root.render(<Login signup={signup} />));
async function input(id, value) {
  await act(async () => {
    const field = find(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(element) {
  await act(async () => element.click());
}
async function submit() {
  await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

test("email login submits credentials and returns to checkout", async () => {
  await render();
  await input("login-email-input", "customer@example.com");
  await input("login-password-input", " secret password ");
  await submit();
  expect(auth.loginWithEmail).toHaveBeenCalledWith("customer@example.com", " secret password ");
  expect(mockNavigate).toHaveBeenCalledWith("/checkout", { replace: true });
});

test("signup prevents mismatched passwords and creates a matching account", async () => {
  await render(true);
  expect(find("google-signin-btn")).not.toBeNull();
  await input("register-email-input", "new@example.com");
  await input("register-password-input", "strongPassword1!");
  await input("register-password-confirm-input", "differentPassword");
  await submit();
  expect(container.querySelector('[role="alert"]').textContent).toBe("Passwords do not match.");
  expect(auth.signupWithEmail).not.toHaveBeenCalled();
  await input("register-password-confirm-input", "strongPassword1!");
  await submit();
  expect(auth.signupWithEmail).toHaveBeenCalledWith("new@example.com", "strongPassword1!");
  expect(mockNavigate).toHaveBeenCalledWith("/checkout", { replace: true });
});

test("failed login displays a friendly error and allows retry", async () => {
  auth.loginWithEmail.mockRejectedValue({ code: "auth/invalid-credential" });
  await render();
  await submit();
  expect(container.querySelector('[role="alert"]').textContent).toContain("email or password is incorrect");
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(find("login-submit-button").disabled).toBe(false);
});

test("password reset needs only email and shows a neutral confirmation", async () => {
  await render();
  await input("login-email-input", "customer@example.com");
  await click(find("login-forgot-password-link"));
  expect(find("login-password-input")).toBeNull();
  await submit();
  expect(auth.resetPassword).toHaveBeenCalledWith("customer@example.com");
  expect(container.querySelector('[role="status"]').textContent).toContain("password reset link");
  expect(container.querySelector('[role="status"]').textContent).toContain("customer@example.com");
  expect(auth.loginWithEmail).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  await input("login-email-input", "another@example.com");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test("reset confirmation waits for Firebase and keeps concurrent requests disabled", async () => {
  let finish;
  auth.resetPassword.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render();
  await input("login-email-input", "customer@example.com");
  await click(find("login-forgot-password-link"));
  await submit();
  expect(container.querySelector("fieldset").disabled).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
  await submit();
  expect(auth.resetPassword).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(container.querySelector("fieldset").disabled).toBe(false);
  expect(container.querySelector('[role="status"]').textContent).toContain("customer@example.com");
});

test("reset failure displays an error and never claims an email was sent", async () => {
  auth.resetPassword.mockRejectedValue({ code: "auth/network-request-failed" });
  await render();
  await input("login-email-input", "customer@example.com");
  await click(find("login-forgot-password-link"));
  await submit();
  expect(container.querySelector('[role="alert"]').textContent).toContain("Check your internet connection");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector("fieldset").disabled).toBe(false);
});

test("Google pending state keeps the form visible and prevents concurrent actions", async () => {
  let finish;
  auth.login.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render();
  await click(find("google-signin-btn"));
  expect(container.querySelector("fieldset").disabled).toBe(true);
  expect(find("google-signin-btn").disabled).toBe(true);
  expect(find("login-email-input")).not.toBeNull();
  await act(async () => finish({ uid: "google-user" }));
  expect(mockNavigate).toHaveBeenCalledWith("/checkout", { replace: true });
});

test("cancelled Google popup stays on the login form", async () => {
  auth.login.mockResolvedValue(null);
  await render();
  await click(find("google-signin-btn"));
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("signup link preserves checkout return path", async () => {
  await render();
  expect(find("login-register-link").getAttribute("href")).toBe("/signup?redirect=%2Fcheckout");
  await render(true);
  expect(find("register-login-link").getAttribute("href")).toBe("/login?redirect=%2Fcheckout");
});

test("existing session returns to the requested local page", async () => {
  auth.user = { uid: "signed-in" };
  await render();
  expect(mockNavigate).toHaveBeenCalledWith("/checkout", { replace: true });
});

test('admin sign-in returns to the workspace root and hides customer signup', async () => {
  mockParams = new URLSearchParams();
  await act(async () => root.render(<Login admin />));
  expect(container.textContent).toContain('Sign in to your workspace');
  expect(find('login-register-link')).toBeNull();
  expect(find('google-signin-btn')).not.toBeNull();
  await input('login-email-input', 'admin@crestuseccommerce.store');
  await input('login-password-input', 'admin-secret');
  await submit();
  expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
});

test.each(["https://example.com", "//example.com", "/\\example.com", "/login", "/signup?redirect=/checkout", null])(
  "rejects unsafe or looping auth return path %s", (value) => expect(authRedirect(value)).toBe("/shop")
);
test("preserves local return query parameters", () => {
  expect(authRedirect("/orders?view=active#recent")).toBe("/orders?view=active#recent");
});
