// Courier serviceability, shipping-charge policy and courier selection.
const { ShiprocketError } = require("./shiprocket");

function normaliseCouriers(resp) {
  const list = resp?.data?.available_courier_companies;
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => ({
      courier_company_id: Number(c.courier_company_id),
      courier_name: c.courier_name,
      rate: Number(c.rate ?? c.freight_charge ?? 0),
      etd: c.etd || null,
      estimated_delivery_days: Number(c.estimated_delivery_days) || null,
      cod: Number(c.cod) || 0,
    }))
    .filter((c) => Number.isFinite(c.courier_company_id) && c.rate >= 0);
}

// Policy: recommended (Shiprocket's pick, fallback cheapest) | cheapest | fastest | balanced (rate + weight*days).
function selectCourier(couriers, { policy, recommendedId, etdWeight = 15 }) {
  if (!couriers.length) return null;
  const byRate = [...couriers].sort((a, b) => a.rate - b.rate);
  const byDays = [...couriers].sort((a, b) => (a.estimated_delivery_days || 99) - (b.estimated_delivery_days || 99) || a.rate - b.rate);
  switch (policy) {
    case "cheapest":
      return byRate[0];
    case "fastest":
      return byDays[0];
    case "balanced":
      return [...couriers].sort((a, b) => a.rate + etdWeight * (a.estimated_delivery_days || 10) - (b.rate + etdWeight * (b.estimated_delivery_days || 10)))[0];
    case "recommended":
    default:
      return couriers.find((c) => c.courier_company_id === Number(recommendedId)) || byRate[0];
  }
}

function shippingChargeFor({ subtotal, courierRate }, shipping) {
  if (shipping.mode === "free") return 0;
  if (shipping.mode === "courier") return Math.round(courierRate || 0);
  if (shipping.freeAbove > 0 && subtotal >= shipping.freeAbove) return 0;
  return shipping.flatRate;
}

function createShippingService({ config, shiprocket, logger = console }) {
  const sr = config.shiprocket;

  async function checkServiceability({ pincode, weightKg, declaredValue }) {
    if (!shiprocket.enabled) {
      return { checked: false, serviceable: true, couriers: [], selected: null, reason: "shiprocket_disabled" };
    }
    if (!sr.pickupPostcode) {
      throw new ShiprocketError("SHIPROCKET_PICKUP_POSTCODE is not configured", { code: "NOT_CONFIGURED" });
    }
    const resp = await shiprocket.serviceability({
      pickupPostcode: sr.pickupPostcode,
      deliveryPostcode: pincode,
      weightKg,
      declaredValue: Math.min(declaredValue, config.shipping.declaredValueCap),
    });
    const couriers = normaliseCouriers(resp);
    const selected = selectCourier(couriers, {
      policy: sr.courierPolicy,
      recommendedId: resp?.data?.recommended_courier_company_id,
      etdWeight: sr.courierBalancedEtdWeight,
    });
    return { checked: true, serviceable: couriers.length > 0, couriers, selected, recommended_courier_company_id: resp?.data?.recommended_courier_company_id ?? null };
  }

  // Quote used by both /checkout/quote and /orders/create so the two always agree.
  async function quote({ pincode, subtotal, weightKg }) {
    let svc;
    try {
      svc = await checkServiceability({ pincode, weightKg, declaredValue: subtotal });
    } catch (err) {
      if (err instanceof ShiprocketError && err.transient) {
        logger.warn("[shipping] serviceability unavailable, falling back to policy charge:", err.message);
        svc = { checked: false, serviceable: true, couriers: [], selected: null, reason: "provider_unavailable" };
      } else {
        throw err;
      }
    }
    const charge = shippingChargeFor({ subtotal, courierRate: svc.selected?.rate }, config.shipping);
    return {
      serviceable: svc.serviceable,
      serviceability_checked: svc.checked,
      shipping_charge: svc.serviceable ? charge : null,
      courier: svc.selected
        ? { courier_company_id: svc.selected.courier_company_id, courier_name: svc.selected.courier_name, rate: svc.selected.rate, etd: svc.selected.etd, estimated_delivery_days: svc.selected.estimated_delivery_days }
        : null,
      couriers_considered: svc.couriers.length,
      reason: svc.reason || null,
    };
  }

  return { checkServiceability, quote, selectCourier, normaliseCouriers };
}

module.exports = { createShippingService, selectCourier, normaliseCouriers, shippingChargeFor };
