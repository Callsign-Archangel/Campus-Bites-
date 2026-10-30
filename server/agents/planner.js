/**
 * planner.js — searches every combination of items on every campus menu,
 * applies each vendor's best offer, and ranks the results for the student's goal.
 * Used by the Food Assistant, Deal Finder and Group Ordering agents.
 */
const { bestOffer } = require("../offers");

const MULTI_PIECE = /\(\d+\s*(?:pc|pcs|pieces)?\)|\b\d+\s*(?:pc|pcs|pieces|eggs)\b/i;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Items a student is allowed to get, given dietary prefs & exclusions. */
function eligibleItems(items, { vegOnly = false, exclude = [], vendorId = null } = {}) {
  return items.filter(i =>
    i.available &&
    (!vegOnly || i.veg) &&
    (!vendorId || i.vendorId === vendorId) &&
    !exclude.some(w => `${i.name} ${i.desc}`.toLowerCase().includes(w)));
}

function groupByVendor(items) {
  const m = new Map();
  for (const i of items) { if (!m.has(i.vendorId)) m.set(i.vendorId, []); m.get(i.vendorId).push(i); }
  return m;
}

/** All multisets of up to maxItems units from one vendor's list (qty ≤ 2 per item). */
function* enumerate(list, maxItems) {
  const L = list.length;
  function* rec(start, picked, units) {
    if (picked.length) yield picked;
    if (units >= maxItems) return;
    for (let i = start; i < L; i++) {
      const last = picked[picked.length - 1];
      if (last && last.item === list[i]) continue;
      for (let q = 1; q <= 2 && units + q <= maxItems; q++) {
        yield* rec(i + 1, [...picked, { item: list[i], qty: q }], units + q);
      }
    }
  }
  yield* rec(0, [], 0);
}

function scoreCombo(c, goals = {}) {
  const P = c.protein / 35, K = c.kcal / 800, F = c.fill / 10;
  let s;
  if (goals.protein && !goals.filling) s = 0.6 * clamp(P, 0, 1.4) + 0.2 * clamp(K, 0, 1.2) + 0.2 * clamp(F, 0, 1.2);
  else if (goals.protein && goals.filling) s = 0.45 * clamp(P, 0, 1.4) + 0.3 * clamp(K, 0, 1.3) + 0.25 * clamp(F, 0, 1.2);
  else if (goals.filling) s = 0.2 * clamp(P, 0, 1.2) + 0.45 * clamp(K, 0, 1.3) + 0.35 * clamp(F, 0, 1.2);
  else if (goals.light) s = 0.4 * clamp(P, 0, 1) + 0.6 * (1 - Math.abs(K - 0.45));
  else s = 0.35 * clamp(P, 0, 1.2) + 0.35 * clamp(K, 0, 1.2) + 0.3 * clamp(F, 0, 1.2);
  if (c.kcal > 1300) s -= (c.kcal - 1300) / 2000;              // don't recommend a food coma
  s -= 0.02 * (c.lines.length - 1);                            // simpler orders are nicer
  if (c.lines.some(l => l.qty > 1 && l.kind === "main")) s -= 0.06; // variety
  if (goals.drink && !c.lines.some(l => l.kind === "drink")) s -= 0.15;
  if (goals.sweet && !c.lines.some(l => l.kind === "dessert")) s -= 0.1;
  return Math.round(s * 1000) / 1000;
}

/**
 * Search combos.
 * opts: { budget, mode, goals, vegOnly, exclude, vendorId, maxItems, minKcal, fees: {vendorId: fee} }
 * Returns combos sorted by score (desc), each within budget (if budget given).
 */
function searchCombos(catalog, opts = {}) {
  const { budget = null, mode = "pickup", goals = {}, maxItems = 3, minKcal = 0, requireMain = false } = opts;
  const items = eligibleItems(catalog.items, opts);
  const out = [];
  let considered = 0;
  for (const [vendorId, list] of groupByVendor(items)) {
    const vendor = catalog.vendors.find(v => v.id === vendorId);
    const offers = catalog.offers.filter(o => o.vendorId === vendorId);
    const fee = mode === "delivery" ? (vendor?.deliveryFee ?? 20) : 0;
    for (const picked of enumerate(list, maxItems)) {
      considered++;
      const drinks = picked.filter(p => p.item.kind === "drink").reduce((s, p) => s + p.qty, 0);
      const desserts = picked.filter(p => p.item.kind === "dessert").reduce((s, p) => s + p.qty, 0);
      const food = picked.filter(p => !["drink", "dessert"].includes(p.item.kind));
      if (!food.length || drinks > 1 || desserts > 1) continue;
      if (requireMain && !picked.some(p => p.item.kind === "main")) continue;
      if (picked.some(p => p.qty > 1 && MULTI_PIECE.test(p.item.name))) continue; // "2× Boiled Eggs (4)" = 8 eggs
      if (picked.some(p => p.qty > 1 && p.item.price > 60 && p.item.kind === "main") && !goals.protein) continue;
      const subtotal = picked.reduce((s, p) => s + p.item.price * p.qty, 0);
      if (budget && subtotal - 60 > budget) continue; // cheap prune before offer math
      const { offer, discount } = bestOffer(offers, picked);
      const total = subtotal - discount + fee;
      if (budget && total > budget) continue;
      const protein = picked.reduce((s, p) => s + p.item.protein * p.qty, 0);
      const kcal = picked.reduce((s, p) => s + p.item.kcal * p.qty, 0);
      if (kcal < minKcal) continue;
      const fill = Math.min(10, picked.reduce((s, p) => s + p.item.fill * p.qty, 0) * (picked.length > 1 ? 0.8 : 1));
      const combo = {
        vendorId, vendorName: vendor?.name || vendorId, vendorSource: vendor?.source,
        lines: picked.map(p => ({ itemId: p.item.id, name: p.item.name, emoji: p.item.emoji, qty: p.qty, price: p.item.price, veg: p.item.veg, kind: p.item.kind, protein: p.item.protein, kcal: p.item.kcal })),
        subtotal, discount, offer: offer ? { id: offer.id, title: offer.title, code: offer.code } : null,
        fee, total, protein, kcal, fill: Math.round(fill * 10) / 10,
      };
      combo.score = scoreCombo(combo, goals);
      out.push(combo);
    }
  }
  out.sort((a, b) => b.score - a.score || a.total - b.total);
  return { combos: out, considered, vendorsSearched: new Set(items.map(i => i.vendorId)).size };
}

/** Pick top N with vendor diversity (best per vendor first). */
function diversePick(combos, n = 3) {
  const picked = [], seenVendor = new Set(), seenSig = new Set();
  const sig = c => c.lines.map(l => l.itemId).sort().join("|");
  for (const c of combos) {
    if (picked.length >= n) break;
    if (seenVendor.has(c.vendorId)) continue;
    picked.push(c); seenVendor.add(c.vendorId); seenSig.add(sig(c));
  }
  for (const c of combos) {
    if (picked.length >= n) break;
    if (seenSig.has(sig(c))) continue;
    // avoid near-duplicates: must differ by a main item
    if (picked.some(p => p.vendorId === c.vendorId && p.lines[0].itemId === c.lines[0].itemId)) continue;
    picked.push(c); seenSig.add(sig(c));
  }
  return picked;
}

function why(c, goals) {
  const bits = [];
  if (goals.protein) bits.push(`~${c.protein} g protein`);
  bits.push(`~${c.kcal} kcal`);
  if (c.discount) bits.push(`saves ₹${c.discount} with “${c.offer.title}”`);
  if (!goals.protein && c.protein >= 25) bits.push(`${c.protein} g protein`);
  return bits.join(" · ");
}

// ---------------------------- group ordering ----------------------------

/**
 * Build a shared cart for N people under a total budget, from a single vendor
 * (one pickup / one delivery). Greedy: give everyone the cheapest decent plate,
 * then spend leftover budget on the upgrades that add the most value per rupee.
 */
function planGroup(catalog, { people, budget, mode = "pickup", goals = {}, vegOnly = false, vegCount = null, nonVegCount = null, exclude = [], vendorId = null }) {
  const N = clamp(people || 2, 2, 20);
  const vegSeats = vegOnly ? N : clamp(vegCount ?? (nonVegCount != null ? N - nonVegCount : 0), 0, N);
  const plans = [];
  const vendors = catalog.vendors.filter(v => !vendorId || v.id === vendorId);

  for (const vendor of vendors) {
    const vItems = eligibleItems(catalog.items, { exclude, vendorId: vendor.id });
    if (!vItems.length) continue;
    const sub = { ...catalog, items: vItems };
    // single-person plates: up to 2 items, a real meal
    const needMain = !goals.light;
    let plates = searchCombos(sub, { goals, maxItems: 2, minKcal: 380, mode: "pickup", requireMain: needMain }).combos
      .filter(p => p.lines.reduce((s, l) => s + l.qty, 0) <= 2 && !p.lines.some(l => l.kind === "main" && l.qty > 1));
    if (plates.length < 2) continue;
    plates = plates.map(p => ({ ...p, isVeg: p.lines.every(l => l.veg) }));
    const offers = catalog.offers.filter(o => o.vendorId === vendor.id);
    const fee = mode === "delivery" ? (vendor.deliveryFee ?? 20) : 0;

    const seatsVeg = Array.from({ length: N }, (_, i) => i < vegSeats);
    const allowed = s => plates.filter(p => !seatsVeg[s] || p.isVeg);
    if (seatsVeg.some((_, s) => !allowed(s).length)) continue;

    const maxSame = Math.max(1, Math.ceil(N / 2));
    const mainOf = p => (p.lines.find(l => l.kind === "main") || p.lines[0]).itemId;
    const cartTotal = seats => {
      const map = new Map();
      for (const p of seats) for (const l of p.lines) {
        const it = vItems.find(i => i.id === l.itemId);
        map.set(it, (map.get(it) || 0) + l.qty);
      }
      const lines = [...map].map(([item, qty]) => ({ item, qty }));
      const subtotal = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
      const { offer, discount } = bestOffer(offers, lines);
      return { subtotal, discount, offer, total: subtotal - discount + fee };
    };
    const usage = seats => seats.reduce((m, p) => m.set(mainOf(p), (m.get(mainOf(p)) || 0) + 1), new Map());

    // 1) cheapest feasible start, preferring variety
    const seats = [];
    for (let s = 0; s < N; s++) {
      const u = usage(seats);
      const opts = allowed(s).slice().sort((a, b) => a.total - b.total || b.score - a.score);
      seats.push(opts.find(p => (u.get(mainOf(p)) || 0) < maxSame) || opts[0]);
    }
    let bill = cartTotal(seats);
    if (budget && bill.total > budget) {
      plans.push({ vendor, feasible: false, minTotal: bill.total });
      continue;
    }
    // 2) upgrades by value-per-rupee
    for (let iter = 0; iter < 60; iter++) {
      let best = null;
      for (let s = 0; s < N; s++) {
        const u = usage(seats);
        u.set(mainOf(seats[s]), u.get(mainOf(seats[s])) - 1);
        for (const p of allowed(s)) {
          if (p.score <= seats[s].score + 0.005) continue;
          if ((u.get(mainOf(p)) || 0) >= maxSame) continue;
          const trial = seats.slice(); trial[s] = p;
          const b = cartTotal(trial);
          if (budget && b.total > budget) continue;
          const gain = p.score - seats[s].score;
          const cost = Math.max(1, b.total - bill.total);
          const ratio = gain / cost;
          if (!best || ratio > best.ratio) best = { s, p, b, ratio };
        }
      }
      if (!best) break;
      seats[best.s] = best.p; bill = best.b;
    }
    const totalScore = seats.reduce((s, p) => s + p.score, 0);
    plans.push({ vendor, feasible: true, seats, bill, fee, totalScore,
      protein: seats.reduce((s, p) => s + p.protein, 0), kcal: seats.reduce((s, p) => s + p.kcal, 0) });
  }

  const feasible = plans.filter(p => p.feasible).sort((a, b) => b.totalScore - a.totalScore || a.bill.total - b.bill.total);
  return { people: N, vegSeats, best: feasible[0] || null, alternatives: feasible.slice(1, 3), infeasible: plans.filter(p => !p.feasible) };
}

module.exports = { searchCombos, diversePick, why, planGroup, eligibleItems };
