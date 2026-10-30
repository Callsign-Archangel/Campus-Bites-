/**
 * chat.js — one entry point for all Campus Bites agents.
 *   assistant · deals · group · track · menu
 * Returns { agent, reply, parsed, cards[] } — the UI renders cards as rich blocks.
 */
const { getCatalog } = require("../catalog");
const { parseRequest, detectIntent } = require("./parse");
const { searchCombos, diversePick, why, planGroup } = require("./planner");
const orders = require("../orders");
const store = require("../store");

const rupee = n => `₹${Math.round(n)}`;

function freshness(catalog) {
  const live = catalog.vendors.filter(v => v.source === "tinyfish" && v.fetchedAt);
  const total = catalog.vendors.length;
  if (!live.length) return `${total} campus menus (vendor menus are sample snapshots until TinyFish discovery runs)`;
  const newest = Math.max(...live.map(v => new Date(v.fetchedAt).getTime()));
  const mins = Math.round((Date.now() - newest) / 60000);
  return `${total} campus menus (${live.length} fetched live by TinyFish, latest ${mins < 1 ? "just now" : `${mins} min ago`})`;
}

function modeNote(mode) {
  return mode === "delivery" ? "incl. delivery fee" : "pickup prices — add ₹15–20 if you want it delivered";
}

// ------------------------------------------------------------------ assistant
function assistant(p, ctx, catalog) {
  const assumed = [];
  let budget = p.budget;
  if (!budget) { budget = 150; assumed.push("a ₹150 budget (tell me yours)"); }
  const mode = p.mode || ctx.mode || "pickup";
  const goals = { ...p.goals };
  const mealish = ["lunch", "dinner", "brunch"].includes(p.meal) || goals.filling;
  const minKcal = goals.light || p.meal === "snack" ? 0 : mealish ? 450 : 300;

  const { combos, considered, vendorsSearched } = searchCombos(catalog, {
    budget, mode, goals, vegOnly: p.vegOnly, exclude: p.exclude, vendorId: p.vendorId, maxItems: 3, minKcal, requireMain: mealish && !goals.light,
  });
  const picks = diversePick(combos, 3);
  const what = [goals.protein && "high-protein", goals.filling && "filling", p.vegOnly && "veg", p.meal].filter(Boolean).join(" ") || "meal";

  if (!picks.length) {
    const any = searchCombos(catalog, { mode, goals, vegOnly: p.vegOnly, exclude: p.exclude, maxItems: 2, minKcal, requireMain: mealish && !goals.light }).combos
      .sort((a, b) => a.total - b.total)[0];
    return {
      reply: `I couldn't find a ${what} for ${rupee(budget)} across ${freshness(catalog)}.` +
        (any ? ` The cheapest option that fits is **${any.lines.map(l => l.name).join(" + ")}** from ${any.vendorName} at ${rupee(any.total)} — ${rupee(any.total - budget)} more.` : ""),
      cards: any ? [{ type: "combos", title: "Closest option", combos: [{ ...any, why: why(any, goals) }] }] : [],
    };
  }
  const top = picks[0];
  return {
    reply:
      `For **${rupee(budget)}** (${modeNote(mode)}), my top ${what} pick is **${top.lines.map(l => (l.qty > 1 ? `${l.qty}× ` : "") + l.name).join(" + ")}** ` +
      `from ${top.vendorName} — **${rupee(top.total)}**, ${why(top, goals)}. ` +
      `I compared ${considered.toLocaleString("en-IN")} combinations from ${vendorsSearched} vendors across ${freshness(catalog)}.` +
      (assumed.length ? ` _I assumed ${assumed.join(", ")}._` : ""),
    cards: [{ type: "combos", title: `Best ${what} options under ${rupee(budget)}`, combos: picks.map(c => ({ ...c, why: why(c, goals) })) }],
  };
}

// ------------------------------------------------------------------ deals
function deals(p, ctx, catalog) {
  let budget = p.budget;
  const assumed = !budget;
  if (!budget) budget = 150;
  const mode = p.mode || ctx.mode || "pickup";
  const goals = { ...p.goals, cheap: true };
  const { combos, considered } = searchCombos(catalog, { budget, mode, goals, vegOnly: p.vegOnly, exclude: p.exclude, vendorId: p.vendorId, maxItems: 3, minKcal: 0 });

  // every active offer, compared on what it actually saves within this budget
  const offerRows = catalog.offers.filter(o => o.type !== "info" || o.details).map(o => {
    const using = combos.filter(c => c.offer?.id === o.id).sort((a, b) => b.discount - a.discount || b.score - a.score);
    const vendor = catalog.vendors.find(v => v.id === o.vendorId);
    return {
      id: o.id, vendorId: o.vendorId, vendorName: vendor?.name || o.vendorId, source: vendor?.source,
      title: o.title, details: o.details, code: o.code, minOrder: o.minOrder,
      bestSaving: using[0]?.discount || 0,
      bestUse: using[0] ? { ...using[0], why: why(using[0], goals) } : null,
    };
  }).sort((a, b) => b.bestSaving - a.bestSaving);

  const meals = combos.filter(c => c.kcal >= 450).sort((a, b) => a.total - b.total || b.score - a.score);
  const cheapest = diversePick(meals, 3);
  const biggestSaving = combos.filter(c => c.kcal >= 400).sort((a, b) => b.discount - a.discount || b.score - a.score)[0];

  const priceDrops = [];
  for (const v of catalog.vendors) {
    for (const ch of v.changes || []) if (ch.type === "price_drop") priceDrops.push({ vendorName: v.name, ...ch });
  }
  for (const i of catalog.items) {
    if (i.originalPrice && i.available) priceDrops.push({ vendorName: i.vendorName, type: "marked_down", item: i.name, from: i.originalPrice, to: i.price });
  }

  const c0 = cheapest[0];
  let reply = c0
    ? `Cheapest proper meal within **${rupee(budget)}**: **${c0.lines.map(l => (l.qty > 1 ? `${l.qty}× ` : "") + l.name).join(" + ")}** from ${c0.vendorName} for **${rupee(c0.total)}** (~${c0.kcal} kcal${c0.discount ? `, ${rupee(c0.discount)} off via “${c0.offer.title}”` : ""}).`
    : `Nothing that counts as a full meal fits ${rupee(budget)} right now.`;
  if (biggestSaving?.discount) reply += ` Biggest saving available: **${rupee(biggestSaving.discount)} off** at ${biggestSaving.vendorName} with “${biggestSaving.offer.title}”.`;
  reply += ` I checked ${offerRows.length} offers and ${considered.toLocaleString("en-IN")} combinations across ${freshness(catalog)}.`;
  if (assumed) reply += " _Assumed a ₹150 budget — tell me yours._";

  const cards = [];
  if (cheapest.length) cards.push({ type: "combos", title: `Cheapest meals under ${rupee(budget)}`, combos: cheapest.map(c => ({ ...c, why: why(c, goals) })) });
  if (biggestSaving?.discount && !cheapest.some(c => c === biggestSaving)) cards.push({ type: "combos", title: "Biggest saving", combos: [{ ...biggestSaving, why: why(biggestSaving, goals) }] });
  cards.push({ type: "offers", title: "All campus offers, compared", offers: offerRows, budget });
  if (priceDrops.length) cards.push({ type: "pricedrops", title: "Price drops spotted", drops: priceDrops.slice(0, 8) });
  return { reply, cards };
}

// ------------------------------------------------------------------ group
function group(p, ctx, catalog) {
  const people = p.people || null;
  if (!people) {
    return {
      reply: "Happy to build a group order! How many people, and what's the total budget? e.g. _“Lunch for 5 people under ₹500, 2 veg”_.",
      cards: [{ type: "suggestions", items: ["Lunch for 5 people under ₹500", "Dinner for 3 under ₹400, all veg", "4 friends, ₹100 each, high protein"] }],
    };
  }
  let budget = p.budget;
  const assumed = !budget;
  if (!budget) budget = people * 120;
  const mode = p.mode || ctx.mode || "pickup";
  const plan = planGroup(catalog, { people, budget, mode, goals: p.goals, vegOnly: p.vegOnly, vegCount: p.vegCount, nonVegCount: p.nonVegCount, exclude: p.exclude, vendorId: p.vendorId });

  if (!plan.best) {
    const min = plan.infeasible.sort((a, b) => a.minTotal - b.minTotal)[0];
    return {
      reply: `I couldn't fit a proper meal for ${people} people within ${rupee(budget)} (${modeNote(mode)}).` +
        (min ? ` The cheapest workable cart is at ${min.vendor.name} for about ${rupee(min.minTotal)} — ${rupee(min.minTotal - budget)} over.` : ""),
      cards: [],
    };
  }
  const b = plan.best;
  const seats = b.seats.map((s, i) => ({
    seat: i + 1, lines: s.lines, total: s.subtotal, protein: s.protein, kcal: s.kcal, veg: s.lines.every(l => l.veg),
  }));
  const allLines = mergeLines(seats.flatMap(s => s.lines));
  const bill = orders.computeBill(allLines, mode, catalog);
  return {
    reply:
      `Here's a shared cart for **${people} people** from **${b.vendor.name}**: **${rupee(bill.total)}** total ` +
      `(${rupee(bill.total / people)} per head${bill.discount ? `, ${rupee(bill.discount)} saved with “${bill.vendors[0].offer.title}”` : ""}${bill.fee ? `, incl. ${rupee(bill.fee)} delivery` : ""}). ` +
      `That leaves ${rupee(budget - bill.total)} of your ${rupee(budget)}. ` +
      (plan.vegSeats ? `${plan.vegSeats} seat${plan.vegSeats > 1 ? "s are" : " is"} veg-only. ` : "") +
      `Create the shared cart, send the link to your group, and everyone can swap their plate and confirm.` +
      (assumed ? ` _Assumed ₹120 per head — tell me the real budget._` : ""),
    cards: [{
      type: "group",
      request: { people, budget, mode },
      vendorId: b.vendor.id, vendorName: b.vendor.name,
      seats, bill,
      alternatives: plan.alternatives.map(a => ({ vendorName: a.vendor.name, total: a.bill.total, perHead: Math.round(a.bill.total / people), kcal: a.kcal })),
    }],
  };
}

function mergeLines(lines) {
  const m = new Map();
  for (const l of lines) m.set(l.itemId, (m.get(l.itemId) || 0) + l.qty);
  return [...m].map(([itemId, qty]) => ({ itemId, qty }));
}

// ------------------------------------------------------------------ tracking
function track(p, ctx) {
  let found = [];
  if (p.orderId) { const o = orders.findOrder(p.orderId); if (o) found = [o]; }
  if (!found.length && Array.isArray(ctx.orderIds)) found = ctx.orderIds.map(orders.findOrder).filter(Boolean);
  const phone = p.phone || ctx.phone;
  if (!found.length && phone) found = orders.ordersByPhone(phone);

  if (!found.length) {
    return {
      reply: p.orderId
        ? `I couldn't find order **${p.orderId}**. Double-check the ID on your confirmation (it looks like CB123456), or give me the phone number you ordered with.`
        : "I don't see an order from this device yet. Tell me your order ID (like **CB123456**) or the 10-digit phone number you used.",
      cards: [],
    };
  }
  const views = found.map(o => orders.orderView(o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = views.filter(v => !["delivered", "collected", "cancelled"].includes(v.status));
  const show = (active.length ? active : views.slice(0, 1)).slice(0, 3);

  const lines = show.map(v => {
    const t = orders.fmtTime;
    let s = `**#${v.id}** is **${v.statusLabel}**.`;
    if (["placed", "confirmed", "preparing"].includes(v.status)) s += ` Estimated prep time: **${v.prepMinutes} min** — about ${v.prepMinutesLeft} min left (ready ~${t(v.etaReadyAt)}).`;
    s += ` ${v.mode === "delivery" ? "Delivery" : "Pickup"}: ${v.deliveryStatus}${["delivered", "collected"].includes(v.status) ? "." : v.mode === "delivery" ? `, ETA **${t(v.etaDoneAt)}**.` : "."}`;
    if (v.delayed) s += ` ⚠️ ${v.notifications.filter(n => n.type === "delay").map(n => n.message).pop() || "Running late."}`;
    else if (!["delivered", "collected"].includes(v.status)) s += " ✅ On time.";
    return s;
  });
  return { reply: lines.join("\n\n"), cards: show.map(order => ({ type: "order", order })) };
}

// ------------------------------------------------------------------ menu changes
function menu(p, ctx, catalog) {
  const rows = catalog.vendors.filter(v => v.source !== "own");
  const changes = rows.flatMap(v => (v.changes || []).map(c => ({ vendorName: v.name, ...c })));
  return {
    reply: changes.length
      ? `TinyFish spotted **${changes.length} menu change${changes.length > 1 ? "s" : ""}** on the last refresh across ${freshness(catalog)}.`
      : `No menu changes since the last TinyFish refresh across ${freshness(catalog)}. Open **Live Menus** to run a fresh discovery.`,
    cards: [{ type: "changes", changes, vendors: rows.map(v => ({ name: v.name, fetchedAt: v.fetchedAt, source: v.source, itemCount: v.itemCount, lastRun: v.lastRun })) }],
  };
}

const AGENTS = { assistant, deals, group, track, menu };

function chat({ message, agent = "auto", context = {} }) {
  const catalog = getCatalog();
  const p = parseRequest(message || "", catalog);
  const intent = agent && agent !== "auto" && AGENTS[agent] ? agent : detectIntent(message || "", p);
  const res = AGENTS[intent](p, context || {}, catalog);
  return {
    agent: intent,
    parsed: { budget: p.budget, people: p.people, vegOnly: p.vegOnly, goals: Object.keys(p.goals).filter(k => p.goals[k]), meal: p.meal, mode: p.mode || context.mode || "pickup", orderId: p.orderId, exclude: p.exclude },
    ...res,
  };
}

// ------------------------------------------------------------------ group carts (shared links)
const crypto = require("crypto");

function createGroupCart({ vendorId, seats, budget, mode, people, createdBy }) {
  const catalog = getCatalog();
  if (!catalog.vendors.some(v => v.id === vendorId)) throw orders.httpError(400, "Unknown vendor");
  const cleanSeats = (seats || []).slice(0, 20).map((s, i) => ({
    seat: i + 1, name: "", confirmed: false,
    lines: (s.lines || []).map(l => ({ itemId: String(l.itemId), qty: Math.max(1, Math.min(5, Number(l.qty) || 1)) }))
      .filter(l => catalog.items.some(it => it.id === l.itemId && it.vendorId === vendorId)),
  }));
  if (!cleanSeats.length) throw orders.httpError(400, "No seats");
  const cart = {
    id: crypto.randomBytes(4).toString("hex"),
    vendorId, budget: Number(budget) || null, mode: mode === "delivery" ? "delivery" : "pickup",
    people: people || cleanSeats.length, seats: cleanSeats, createdBy: String(createdBy || "").slice(0, 40),
    status: "open", orderId: null, createdAt: new Date().toISOString(),
  };
  store.get().groupCarts.push(cart);
  store.save();
  return groupCartView(cart);
}

function groupCartView(cart) {
  const catalog = getCatalog();
  const lines = mergeLines(cart.seats.flatMap(s => s.lines));
  const bill = orders.computeBill(lines, cart.mode, catalog);
  const vendor = catalog.vendors.find(v => v.id === cart.vendorId);
  const menu = catalog.items.filter(i => i.vendorId === cart.vendorId && i.available)
    .map(i => ({ id: i.id, name: i.name, price: i.price, emoji: i.emoji, veg: i.veg, kind: i.kind }));
  return {
    ...cart,
    vendorName: vendor?.name || cart.vendorId,
    seats: cart.seats.map(s => ({
      ...s,
      lines: s.lines.map(l => { const it = catalog.items.find(i => i.id === l.itemId); return { ...l, name: it?.name || "Unavailable item", price: it?.price || 0, emoji: it?.emoji || "❔", veg: it?.veg }; }),
      total: s.lines.reduce((t, l) => t + (catalog.items.find(i => i.id === l.itemId)?.price || 0) * l.qty, 0),
    })),
    bill,
    overBudget: cart.budget ? bill.total > cart.budget : false,
    allConfirmed: cart.seats.every(s => s.confirmed),
    menu,
  };
}

function findGroupCart(id) { return store.get().groupCarts.find(c => c.id === id) || null; }

function updateSeat(id, seatNo, { name, confirmed, lines }) {
  const cart = findGroupCart(id);
  if (!cart) throw orders.httpError(404, "Group cart not found");
  if (cart.status !== "open") throw orders.httpError(409, "This group order has already been placed");
  const seat = cart.seats.find(s => s.seat === Number(seatNo));
  if (!seat) throw orders.httpError(404, "Seat not found");
  if (name != null) seat.name = String(name).slice(0, 40);
  if (Array.isArray(lines)) {
    const catalog = getCatalog();
    seat.lines = lines.slice(0, 5).map(l => ({ itemId: String(l.itemId), qty: Math.max(1, Math.min(5, Number(l.qty) || 1)) }))
      .filter(l => catalog.items.some(it => it.id === l.itemId && it.vendorId === cart.vendorId));
    seat.confirmed = false; // changing the plate needs re-confirmation
  }
  if (confirmed != null) seat.confirmed = Boolean(confirmed) && seat.lines.length > 0;
  store.save();
  return groupCartView(cart);
}

function addSeat(id) {
  const cart = findGroupCart(id);
  if (!cart) throw orders.httpError(404, "Group cart not found");
  if (cart.status !== "open" || cart.seats.length >= 20) throw orders.httpError(409, "Cannot add a seat");
  const copy = cart.seats[cart.seats.length - 1];
  cart.seats.push({ seat: cart.seats.length + 1, name: "", confirmed: false, lines: copy ? copy.lines.map(l => ({ ...l })) : [] });
  store.save();
  return groupCartView(cart);
}

function placeGroupOrder(id, { customer, payMethod, note }) {
  const cart = findGroupCart(id);
  if (!cart) throw orders.httpError(404, "Group cart not found");
  if (cart.status !== "open") throw orders.httpError(409, "Already placed as " + cart.orderId);
  if (!cart.seats.every(s => s.confirmed)) throw orders.httpError(409, "Everyone needs to confirm their plate first");
  const lines = mergeLines(cart.seats.flatMap(s => s.lines));
  const seatNote = cart.seats.map(s => `${s.name || "Seat " + s.seat}: ${s.lines.length} item(s)`).join("; ");
  const order = orders.createOrder({ customer, lines, payMethod, note: [note, `Group order (${seatNote})`].filter(Boolean).join(" — "), groupCartId: cart.id });
  cart.status = "placed"; cart.orderId = order.id;
  store.save();
  return { order, cart: groupCartView(cart) };
}

module.exports = { chat, createGroupCart, groupCartView, findGroupCart, updateSeat, addSeat, placeGroupOrder };
