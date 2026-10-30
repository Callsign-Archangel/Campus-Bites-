/**
 * orders.js — billing, our own order API and the order lifecycle used by the
 * Smart Order Tracking Agent. Status is derived from time + kitchen actions:
 *   placed → confirmed → preparing → ready → out_for_delivery → delivered
 *   (pickup orders stop at "ready" until collected)
 */
const crypto = require("crypto");
const store = require("./store");
const { getCatalog } = require("./catalog");
const { bestOffer } = require("./offers");

const SPEED = () => Math.max(0.1, Number(process.env.DEMO_SPEED || 1));

const LOCATIONS = {
  "Hostel A": 6, "Hostel B": 8, "Hostel C": 10, "Boys PG Block": 7, "Girls PG Block": 7,
  "Library": 5, "Academic Block": 6, "Pick-up from Canteen": 0,
};

// --------------------------- billing ---------------------------
/** lines: [{ itemId, qty }] → itemised bill with best offer per vendor. */
function computeBill(lines, mode = "pickup", catalog = getCatalog()) {
  const byVendor = new Map();
  const problems = [];
  for (const l of lines || []) {
    const qty = Math.max(0, Math.min(50, Math.floor(Number(l.qty) || 0)));
    if (!qty) continue;
    const item = catalog.items.find(i => i.id === l.itemId);
    if (!item) { problems.push(`Item ${l.itemId} is no longer on the menu`); continue; }
    if (!item.available) problems.push(`${item.name} is sold out right now`);
    if (!byVendor.has(item.vendorId)) byVendor.set(item.vendorId, []);
    byVendor.get(item.vendorId).push({ item, qty });
  }
  const vendors = [];
  for (const [vendorId, vlines] of byVendor) {
    const vendor = catalog.vendors.find(v => v.id === vendorId);
    const subtotal = vlines.reduce((s, l) => s + l.item.price * l.qty, 0);
    const { offer, discount } = bestOffer(catalog.offers.filter(o => o.vendorId === vendorId), vlines);
    const fee = mode === "delivery" ? (vendor?.deliveryFee ?? 20) : 0;
    vendors.push({
      vendorId, vendorName: vendor?.name || vendorId,
      lines: vlines.map(l => ({ itemId: l.item.id, name: l.item.name, emoji: l.item.emoji, price: l.item.price, qty: l.qty, veg: l.item.veg, total: l.item.price * l.qty })),
      subtotal, discount, offer: offer ? { id: offer.id, title: offer.title, code: offer.code } : null,
      fee, total: subtotal - discount + fee,
    });
  }
  const sum = k => vendors.reduce((s, v) => s + v[k], 0);
  return { mode, vendors, subtotal: sum("subtotal"), discount: sum("discount"), fee: sum("fee"), total: sum("total"), problems };
}

// --------------------------- orders ---------------------------
const STAGES = [
  { key: "placed", label: "Order placed" },
  { key: "confirmed", label: "Confirmed by kitchen" },
  { key: "preparing", label: "Preparing your food" },
  { key: "ready", label: "Ready" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];
const IDX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

function newOrderId() {
  const db = store.get();
  let id;
  do { id = "CB" + (100000 + crypto.randomInt(900000)); } while (db.orders.some(o => o.id === id));
  return id;
}

function activeOrdersAhead(vendorIds, now = Date.now()) {
  return store.get().orders.filter(o => {
    const v = orderView(o, now);
    return !["ready", "out_for_delivery", "delivered", "collected"].includes(v.status) &&
      o.bill.vendors.some(x => vendorIds.includes(x.vendorId));
  }).length;
}

function createOrder({ customer = {}, lines, payMethod = "upi", note = "", groupCartId = null }) {
  const name = String(customer.name || "").trim().slice(0, 60);
  const phone = String(customer.phone || "").replace(/\D/g, "").slice(-10);
  const location = String(customer.location || "").trim();
  if (!name) throw httpError(400, "Name is required");
  if (phone.length !== 10) throw httpError(400, "A valid 10-digit phone number is required");
  if (!location) throw httpError(400, "Delivery location is required");

  const mode = location === "Pick-up from Canteen" ? "pickup" : "delivery";
  const catalog = getCatalog();
  const bill = computeBill(lines, mode, catalog);
  if (!bill.vendors.length) throw httpError(400, "Your cart is empty");
  const soldOut = bill.problems.filter(p => /sold out|no longer/.test(p));
  if (soldOut.length) throw httpError(409, soldOut.join(". "));

  // Prep estimate: slowest item + kitchen queue + order size
  const items = bill.vendors.flatMap(v => v.lines.map(l => ({ ...catalog.items.find(i => i.id === l.itemId), qty: l.qty })));
  const slowest = Math.max(...items.map(i => i.prep || 6));
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const queue = activeOrdersAhead(bill.vendors.map(v => v.vendorId));
  const prepMinutes = Math.round(slowest + Math.min(15, queue * 2) + Math.floor(Math.max(0, totalQty - 2) / 3) * 2);
  const travelMinutes = mode === "delivery" ? (LOCATIONS[location] ?? 8) : 0;

  const order = {
    id: newOrderId(),
    createdAt: new Date().toISOString(),
    customer: { name, phone, roll: String(customer.roll || "").slice(0, 20), location },
    mode, payMethod, note: String(note || "").slice(0, 300),
    bill, prepMinutes, travelMinutes, queueAtPlacement: queue,
    delays: [],          // [{ minutes, reason, at }]
    manualStatus: null,  // kitchen override { status, at }
    groupCartId,
  };
  store.get().orders.push(order);
  store.save();
  return orderView(order);
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/** Live view of an order — this is what the tracking agent reads. */
function orderView(o, now = Date.now()) {
  const speed = SPEED();
  const created = new Date(o.createdAt).getTime();
  const elapsed = ((now - created) / 60000) * speed; // "order-clock" minutes
  const delayTotal = (o.delays || []).reduce((s, d) => s + d.minutes, 0);

  // planned timeline in order-clock minutes
  const tConfirmed = 1, tPreparing = 2;
  const tReady = tPreparing + o.prepMinutes + delayTotal;
  const tOut = tReady + 1;
  const tDelivered = tOut + o.travelMinutes;
  const promisedReady = tPreparing + o.prepMinutes;
  const promisedDone = o.mode === "delivery" ? promisedReady + 1 + o.travelMinutes : promisedReady;

  let auto = "placed";
  if (elapsed >= tConfirmed) auto = "confirmed";
  if (elapsed >= tPreparing) auto = "preparing";
  if (elapsed >= tReady) auto = "ready";
  if (o.mode === "delivery") {
    if (elapsed >= tOut) auto = "out_for_delivery";
    if (elapsed >= tDelivered) auto = "delivered";
  }
  let status = auto;
  if (o.manualStatus) {
    const m = o.manualStatus.status;
    if (m === "collected" || m === "cancelled") status = m;
    else if (IDX[m] > IDX[auto]) status = m;
  }
  if (o.mode === "pickup" && status === "ready" && elapsed >= tReady + 45) status = "collected";

  const toClock = mins => new Date(created + (mins / speed) * 60000).toISOString();
  const doneStates = ["delivered", "collected", "cancelled"];
  const finished = doneStates.includes(status);
  const etaDone = o.mode === "delivery" ? tDelivered : tReady;
  const minutesLeft = finished ? 0 : Math.max(0, Math.ceil((etaDone - elapsed) / speed));
  const prepLeft = IDX[status] >= IDX.ready || finished ? 0 : Math.max(0, Math.ceil((tReady - elapsed) / speed));

  const stages = STAGES.filter(s => o.mode === "delivery" || !["out_for_delivery", "delivered"].includes(s.key))
    .map(s => {
      const at = { placed: 0, confirmed: tConfirmed, preparing: tPreparing, ready: tReady, out_for_delivery: tOut, delivered: tDelivered }[s.key];
      const i = IDX[s.key], cur = IDX[status] ?? (finished ? 99 : 0);
      return {
        key: s.key,
        label: s.key === "ready" && o.mode === "pickup" ? "Ready for pickup" : s.label,
        state: finished || i < cur ? "done" : i === cur ? "active" : "pending",
        at: toClock(at),
      };
    });

  // notifications (delays & milestones)
  const notifications = [];
  for (const d of o.delays || []) {
    notifications.push({ type: "delay", at: d.at, message: `Delayed by ${d.minutes} min${d.reason ? ` — ${d.reason}` : ""}. New ETA ${fmtTime(toClock(etaDone))}.` });
  }
  const runningLate = !finished && elapsed > promisedDone + 0.5;
  if (runningLate && !delayTotal) {
    notifications.push({ type: "delay", at: toClock(promisedDone), message: "Running a little behind the promised time — the kitchen has been nudged." });
  }
  if (o.queueAtPlacement >= 4) {
    notifications.push({ type: "info", at: o.createdAt, message: `Kitchen was busy (${o.queueAtPlacement} orders ahead) — ETA includes the queue.` });
  }

  const deliveryStatus = o.mode === "pickup"
    ? (status === "collected" ? "Collected" : status === "ready" ? "Waiting at the counter" : "Pick-up order — not dispatched")
    : ({ out_for_delivery: `On the way to ${o.customer.location}`, delivered: `Delivered to ${o.customer.location}` }[status]
      || `Will be delivered to ${o.customer.location} (~${o.travelMinutes} min ride)`);

  return {
    id: o.id,
    createdAt: o.createdAt,
    customer: { name: o.customer.name, location: o.customer.location, phoneLast4: o.customer.phone.slice(-4) },
    mode: o.mode,
    status,
    statusLabel: status === "collected" ? "Collected" : status === "cancelled" ? "Cancelled" : (stages.find(s => s.key === status)?.label || status),
    stages,
    prepMinutes: Math.round(tReady),
    prepMinutesLeft: prepLeft,
    minutesLeft,
    etaReadyAt: toClock(tReady),
    etaDoneAt: toClock(etaDone),
    promisedDoneAt: toClock(promisedDone),
    deliveryStatus,
    delayed: delayTotal > 0 || runningLate,
    delayMinutes: delayTotal,
    notifications,
    bill: o.bill,
    note: o.note,
    payMethod: o.payMethod,
    groupCartId: o.groupCartId || null,
  };
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: process.env.TZ || "Asia/Kolkata" });
}

function findOrder(id) {
  return store.get().orders.find(o => o.id.toUpperCase() === String(id || "").toUpperCase()) || null;
}
function ordersByPhone(phone) {
  const p = String(phone || "").replace(/\D/g, "").slice(-10);
  return p.length === 10 ? store.get().orders.filter(o => o.customer.phone === p) : [];
}

/** Kitchen actions: advance status, add delay, mark collected/cancelled. */
function kitchenUpdate(id, { status, delayMinutes, reason }) {
  const o = findOrder(id);
  if (!o) throw httpError(404, "Order not found");
  if (delayMinutes) {
    const m = Math.max(1, Math.min(60, Number(delayMinutes)));
    o.delays.push({ minutes: m, reason: String(reason || "").slice(0, 120), at: new Date().toISOString() });
  }
  if (status) {
    if (![...Object.keys(IDX), "collected", "cancelled"].includes(status)) throw httpError(400, "Unknown status");
    o.manualStatus = { status, at: new Date().toISOString() };
  }
  store.save();
  return orderView(o);
}

module.exports = { computeBill, createOrder, orderView, findOrder, ordersByPhone, kitchenUpdate, fmtTime, LOCATIONS, httpError };
