const { initFirebaseAdmin } = require("./store");

// Verifies Firebase ID tokens (Authorization: Bearer <idToken>). Admin = custom claim `admin` or ADMIN_EMAILS.
function createAuth(config) {
  const app = initFirebaseAdmin(config);
  const admin = app ? require("firebase-admin") : null;

  const isAdminIdentity = (identity) =>
    Boolean(identity && (identity.claims?.admin === true || config.adminEmails.includes((identity.email || "").toLowerCase())));

  async function identify(req) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (token && admin) {
      try {
        const decoded = await admin.auth(app).verifyIdToken(token);
        return { uid: decoded.uid, email: (decoded.email || "").toLowerCase(), claims: decoded, verified: true };
      } catch {
        return null;
      }
    }
    if (!admin && config.allowInsecureDevAuth && req.headers["x-dev-uid"]) {
      return { uid: String(req.headers["x-dev-uid"]), email: String(req.headers["x-dev-email"] || "").toLowerCase(), claims: {}, verified: false };
    }
    return null;
  }

  const requireAuth = async (req, res, next) => {
    if (!admin && !config.allowInsecureDevAuth) {
      return res.status(503).json({ detail: "Authentication is not configured on the server" });
    }
    const identity = await identify(req);
    if (!identity) return res.status(401).json({ detail: "Sign in required" });
    req.user = { ...identity, is_admin: isAdminIdentity(identity) };
    next();
  };

  const requireAdmin = async (req, res, next) =>
    requireAuth(req, res, () => {
      if (!req.user.is_admin) return res.status(403).json({ detail: "Admin access required" });
      next();
    });

  const ownsOrder = (user, order) =>
    Boolean(
      user &&
        order &&
        ((order.user_id && order.user_id === user.uid) ||
          (user.email && (order.customer?.email || "").toLowerCase() === user.email))
    );

  return { requireAuth, requireAdmin, ownsOrder, isAdminIdentity, enabled: Boolean(admin) || config.allowInsecureDevAuth };
}

module.exports = { createAuth };
