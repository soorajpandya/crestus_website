export function authErrorMessage(error) {
  const messages = {
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/invalid-credential": "The email or password is incorrect. Try again or reset your password.",
    "auth/wrong-password": "The email or password is incorrect. Try again or reset your password.",
    "auth/user-not-found": "The email or password is incorrect. Try again or reset your password.",
    "auth/email-already-in-use": "An account already uses this email. Sign in or reset your password.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/password-does-not-meet-requirements": "This password does not meet the security requirements. Try a longer password with uppercase and lowercase letters, numbers, and symbols.",
    "auth/too-many-requests": "Too many attempts. Please wait a little before trying again.",
    "auth/network-request-failed": "Unable to connect. Check your internet connection and try again.",
    "auth/user-disabled": "This account has been disabled. Please contact support.",
    "auth/operation-not-allowed": "This sign-in method is currently unavailable. Please try another method or contact support.",
    "auth/unauthorized-domain": "Sign-in is unavailable on this website address. Please contact support.",
    "auth/popup-blocked": "Your browser blocked Google sign-in. Allow pop-ups for this site and try again.",
    "auth/account-exists-with-different-credential": "This email already uses another sign-in method. Sign in with your existing method first.",
  };
  return messages[error?.code] || "Unable to complete your request. Please try again.";
}

// Accept only local return paths, and avoid sending signed-in users back to auth.
export function authRedirect(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/shop";
  try {
    const url = new URL(value, "https://crestus.local");
    if (url.origin !== "https://crestus.local" || /^\/(login|signup)\/?$/.test(url.pathname)) return "/shop";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/shop";
  }
}
