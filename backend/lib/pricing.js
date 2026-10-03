// Builds the trusted order snapshot: prices from the catalog, package from packaging rules — never from the client.
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

function validateAddress(raw = {}) {
  const name = String(raw.name || "").trim();
  if (name.length < 2) throw new ValidationError("Please provide your full name (at least 2 letters)", "name");
  const email = String(raw.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Please provide a valid email address", "email");
  const phone = String(raw.phone || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ValidationError("Please provide a valid 10-digit mobile number starting with 6, 7, 8, or 9", "phone");
  const line1 = String(raw.line1 || "").trim();
  if (line1.length < 5) throw new ValidationError("Please provide a complete address (flat/house no., street, area)", "line1");
  const line2 = String(raw.line2 || "").trim();
  const city = String(raw.city || "").trim();
  if (city.length < 2) throw new ValidationError("Please provide a valid city", "city");
  const state = String(raw.state || "").trim();
  if (state.length < 2) throw new ValidationError("Please provide a valid state", "state");
  const pincode = String(raw.pincode || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(pincode)) throw new ValidationError("Please provide a valid 6-digit postal pincode", "pincode");
  return { name, email, phone, line1, line2, city, state, pincode, country: "India" };
}

function resolveItemWeightKg(product, rules) {
  if (Number.isFinite(Number(product.weight_kg)) && Number(product.weight_kg) > 0) return Number(product.weight_kg);
  const bySub = rules?.subcategory_weight_kg?.[product.subcategory];
  if (Number.isFinite(Number(bySub)) && Number(bySub) > 0) return Number(bySub);
  const def = rules?.default_item_weight_kg;
  if (Number.isFinite(Number(def)) && Number(def) > 0) return Number(def);
  return null;
}

function buildLineItems(rawItems, products, rules) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new ValidationError("Your bag is empty", "items");
  const byId = new Map(products.map((p) => [p.id, p]));
  const merged = new Map();
  for (const raw of rawItems) {
    const product = byId.get(String(raw.product_id || ""));
    if (!product) throw new ValidationError(`Product ${raw.product_id} is no longer available`, "items");
    const size = String(raw.size || "").trim();
    if (Array.isArray(product.sizes) && product.sizes.length && !product.sizes.includes(size)) {
      throw new ValidationError(`Size ${size || "(none)"} is not available for ${product.name}`, "items");
    }
    const qty = Number.parseInt(raw.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new ValidationError(`Invalid quantity for ${product.name}`, "items");
    const weight = resolveItemWeightKg(product, rules);
    if (!weight) {
      const err = new ValidationError(`Shipping weight is not configured for "${product.subcategory}" products`, "packaging");
      err.status = 503;
      throw err;
    }
    const key = `${product.id}-${size}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += qty;
      continue;
    }
    merged.set(key, {
      key,
      product_id: product.id,
      sku: `${product.id}${size ? `-${size}` : ""}`.toUpperCase(),
      name: product.name,
      image: product.image,
      category: product.category,
      subcategory: product.subcategory,
      variant: { size, color: product.color || null },
      size,
      qty,
      unit_price: Number(product.price),
      unit_mrp: Number(product.mrp || product.price),
      unit_weight_kg: weight,
    });
  }
  return Array.from(merged.values()).map((li) => ({
    ...li,
    line_total: round2(li.unit_price * li.qty),
    line_discount: round2(Math.max(0, li.unit_mrp - li.unit_price) * li.qty),
  }));
}

function buildPackage(lineItems, rules) {
  const units = lineItems.reduce((s, li) => s + li.qty, 0);
  const itemsWeight = lineItems.reduce((s, li) => s + li.unit_weight_kg * li.qty, 0);
  const box = rules?.box || {};
  const height = Math.min(
    Number(box.max_height_cm) || 40,
    (Number(box.height_cm) || 5) + Math.max(0, units - 1) * (Number(box.extra_height_per_additional_item_cm) || 0)
  );
  return {
    weight_kg: round2(itemsWeight + (Number(rules?.packaging_weight_kg) || 0)),
    length_cm: Number(box.length_cm) || 30,
    breadth_cm: Number(box.breadth_cm) || 25,
    height_cm: height,
    units,
  };
}

function computeTotals(lineItems, shippingCharge, gstRatePercent) {
  const subtotal = round2(lineItems.reduce((s, li) => s + li.line_total, 0));
  const mrpTotal = round2(lineItems.reduce((s, li) => s + li.unit_mrp * li.qty, 0));
  const discount = round2(Math.max(0, mrpTotal - subtotal));
  const shipping = round2(Math.max(0, Number(shippingCharge) || 0));
  const total = round2(subtotal + shipping);
  // Catalogue prices are tax-inclusive; expose the embedded GST for reporting only.
  const taxIncluded = gstRatePercent > 0 ? round2(subtotal - subtotal / (1 + gstRatePercent / 100)) : 0;
  return { currency: "INR", subtotal, mrp_total: mrpTotal, discount, shipping, tax_included: taxIncluded, tax_rate_percent: gstRatePercent, total };
}

module.exports = { ValidationError, validateAddress, buildLineItems, buildPackage, computeTotals, round2 };
