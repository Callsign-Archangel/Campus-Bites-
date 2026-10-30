/**
 * catalog.js — one unified catalog of everything a student can order:
 *   • Campus Bites canteen (our own menu, served by our backend)
 *   • Other campus vendors, whose menus/prices/offers are collected from their
 *     websites by TinyFish (see discovery.js) and cached in data/db.json
 */
const fs = require("fs");
const path = require("path");
const store = require("./store");
const { classify, estimate, fillScore, emojiFor, KIND_BY_CAT } = require("./nutrition");
const { parseOffer } = require("./offers");

const VENDORS_FILE = path.join(__dirname, "..", "data", "vendors.json");
const SEED_FILE = path.join(__dirname, "..", "data", "seed-snapshots.json");

const DELIVERY_FEE = 20;

// ---------------- Campus Bites (own canteen) ----------------
const CANTEEN = {
  id: "campus-bites",
  name: "Campus Bites Canteen",
  location: "Block-A, Ground Floor",
  deliveryFee: DELIVERY_FEE,
  source: "own",
};

// protein (g) and kcal are approximate per serving
const CANTEEN_ITEMS = [
  { n: 1,  name: "Masala Maggi",     desc: "Classic street-style Maggi with veggies & spices",       price: 50,  emoji: "🍜", cat: "Snacks",  veg: true,  protein: 7,  kcal: 390, kind: "main", prep: 6 },
  { n: 2,  name: "Veg Burger",       desc: "Crispy patty with lettuce, cheese & special sauce",       price: 80,  emoji: "🍔", cat: "Burgers", veg: true,  protein: 10, kcal: 430, kind: "main", prep: 8 },
  { n: 3,  name: "Chicken Burger",   desc: "Spicy fried chicken with coleslaw & jalapeños",           price: 110, emoji: "🍔", cat: "Burgers", veg: false, protein: 24, kcal: 520, kind: "main", prep: 10 },
  { n: 4,  name: "Cheese Pizza",     desc: "Hand-tossed with mozzarella & fresh basil",              price: 120, emoji: "🍕", cat: "Pizza",   veg: true,  protein: 18, kcal: 610, kind: "main", prep: 12 },
  { n: 5,  name: "Samosa (2pc)",     desc: "Crispy pastry filled with spiced potatoes & peas",       price: 30,  emoji: "🥟", cat: "Snacks",  veg: true,  protein: 5,  kcal: 300, kind: "side", prep: 3 },
  { n: 6,  name: "Cold Coffee",      desc: "Blended espresso with milk & vanilla ice cream",         price: 70,  emoji: "☕", cat: "Drinks",  veg: true,  protein: 7,  kcal: 250, kind: "drink", prep: 4 },
  { n: 7,  name: "Aloo Tikki",       desc: "Golden potato patty served with green chutney",          price: 40,  emoji: "🥔", cat: "Snacks",  veg: true,  protein: 3,  kcal: 220, kind: "side", prep: 5 },
  { n: 8,  name: "Pav Bhaji",        desc: "Buttery bhaji with soft pav — Mumbai street style",     price: 90,  emoji: "🥘", cat: "Meals",   veg: true,  protein: 11, kcal: 560, kind: "main", prep: 7 },
  { n: 9,  name: "Paneer Wrap",      desc: "Tandoori paneer with onions & mint chutney in a wrap",  price: 100, emoji: "🌯", cat: "Meals",   veg: true,  protein: 20, kcal: 480, kind: "main", prep: 8 },
  { n: 10, name: "Egg Roll",         desc: "Kolkata-style egg wrap with onions & spiced veggies",   price: 70,  emoji: "🥚", cat: "Meals",   veg: false, protein: 14, kcal: 400, kind: "main", prep: 7 },
  { n: 11, name: "Mango Shake",      desc: "Fresh alphonso mango blended with chilled milk",        price: 80,  emoji: "🥭", cat: "Drinks",  veg: true,  protein: 7,  kcal: 300, kind: "drink", prep: 4 },
  { n: 12, name: "Chicken Sandwich", desc: "Grilled chicken with mayo, onion & sliced tomato",     price: 95,  emoji: "🥪", cat: "Burgers", veg: false, protein: 22, kcal: 410, kind: "main", prep: 7 },
];

const CANTEEN_OFFERS = [
  { id: "campus-bites:combo", vendorId: CANTEEN.id, title: "Burger + Drink Combo — ₹20 off", details: "Any burger/sandwich with any drink", code: null,
    type: "combo", value: 20, minOrder: 0, maxDiscount: null, appliesTo: [], groups: [["cat:Burgers"], ["cat:Drinks"]] },
  { id: "campus-bites:student10", vendorId: CANTEEN.id, title: "STUDENT10 — 10% off above ₹200", details: "Max ₹50 discount", code: "STUDENT10",
    type: "percent", value: 10, minOrder: 200, maxDiscount: 50, appliesTo: [], groups: [] },
];

function canteenItems() {
  return CANTEEN_ITEMS.map(i => {
    const item = {
      id: `cb:${i.n}`, vendorId: CANTEEN.id, vendorName: CANTEEN.name,
      name: i.name, desc: i.desc, price: i.price, originalPrice: null,
      cat: i.cat, vendorCat: i.cat, veg: i.veg, available: true,
      protein: i.protein, kcal: i.kcal, kind: i.kind, emoji: i.emoji, prep: i.prep,
      source: "own",
    };
    item.fill = fillScore(item);
    return item;
  });
}

// ---------------- Vendors (TinyFish-discovered) ----------------
function loadVendorConfig() {
  try { return JSON.parse(fs.readFileSync(VENDORS_FILE, "utf8")); } catch { return []; }
}
function saveVendorConfig(list) {
  fs.writeFileSync(VENDORS_FILE, JSON.stringify(list, null, 2));
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const toNum = v => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const m = String(v).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const NONVEG_RE = /chicken|mutton|fish|keema|prawn|egg|omelet|omelette|bhurji/i;
const PREP = { Meals: 12, Bowls: 10, Burgers: 9, Pizza: 14, Snacks: 5, Drinks: 3, Desserts: 2 };

/** Normalise a raw TinyFish extraction into our snapshot format. */
function normalizeSnapshot(vendor, raw) {
  const obj = Array.isArray(raw) ? { items: raw } : (raw || {});
  const rawItems = obj.items || obj.menu || obj.menu_items || obj.products || [];
  const rawOffers = obj.offers || obj.special_offers || obj.deals || obj.promotions || [];

  const seen = new Set();
  const items = [];
  for (const r of Array.isArray(rawItems) ? rawItems : []) {
    const name = String(r.name || r.item || r.title || "").trim().slice(0, 80);
    const price = toNum(r.price ?? r.current_price ?? r.cost);
    if (!name || price == null || price <= 0 || price > 5000) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const desc = String(r.description || r.desc || "").trim().slice(0, 160);
    const vendorCat = String(r.category || r.section || "").trim().slice(0, 40);
    const cat = classify(name, vendorCat, desc);
    const kind = KIND_BY_CAT[cat] || "side";
    const veg = typeof r.veg === "boolean" ? r.veg
      : typeof r.is_veg === "boolean" ? r.is_veg
      : !NONVEG_RE.test(`${name} ${desc}`);
    const statedProtein = toNum(r.protein_g ?? r.protein);
    const { protein, kcal } = estimate({ name, desc, cat, price, protein: statedProtein, kcal: toNum(r.kcal ?? r.calories) });
    const original = toNum(r.original_price ?? r.mrp ?? r.old_price);
    const item = {
      id: `${vendor.id}:${slug(name)}`, vendorId: vendor.id, vendorName: vendor.name,
      name, desc, price, originalPrice: original && original > price ? original : null,
      cat, vendorCat, veg, available: r.available !== false && !/sold ?out|unavailable/i.test(String(r.status || "")),
      protein, kcal, proteinStated: statedProtein != null, kind, emoji: emojiFor(name, cat), prep: PREP[cat] || 6,
      source: "tinyfish",
    };
    item.fill = fillScore(item);
    items.push(item);
  }
  const names = items.map(i => i.name);
  const offers = (Array.isArray(rawOffers) ? rawOffers : [])
    .map(o => (typeof o === "string" ? { title: o } : o))
    .map((o, i) => parseOffer(o, vendor.id, i, names));

  return { items, offers, notes: obj.notes ? String(obj.notes).slice(0, 300) : "" };
}

/** Compare two snapshots → menu changes (what students care about). */
function diffSnapshots(prev, next) {
  const changes = [];
  if (!prev) return changes;
  const byName = list => new Map(list.map(i => [i.name.toLowerCase(), i]));
  const a = byName(prev.items || []), b = byName(next.items || []);
  for (const [k, n] of b) {
    const o = a.get(k);
    if (!o) changes.push({ type: "added", item: n.name, price: n.price });
    else {
      if (o.price !== n.price) changes.push({ type: n.price < o.price ? "price_drop" : "price_up", item: n.name, from: o.price, to: n.price });
      if (o.available !== n.available) changes.push({ type: n.available ? "back_in_stock" : "sold_out", item: n.name });
    }
  }
  for (const [k, o] of a) if (!b.has(k)) changes.push({ type: "removed", item: o.name, price: o.price });
  const ta = new Set((prev.offers || []).map(o => o.title.toLowerCase()));
  const tb = new Set((next.offers || []).map(o => o.title.toLowerCase()));
  for (const o of next.offers || []) if (!ta.has(o.title.toLowerCase())) changes.push({ type: "new_offer", item: o.title });
  for (const o of prev.offers || []) if (!tb.has(o.title.toLowerCase())) changes.push({ type: "offer_ended", item: o.title });
  return changes;
}

/** On first boot, load sample snapshots so the app works before the first TinyFish run. */
function ensureSeeded() {
  const db = store.get();
  let seeds = {};
  try { seeds = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); } catch { /* none */ }
  let changed = false;
  for (const v of loadVendorConfig()) {
    if (db.vendors[v.id]) continue;
    if (!seeds[v.id]) continue;
    const snap = normalizeSnapshot(v, seeds[v.id]);
    db.vendors[v.id] = {
      ...snap,
      fetchedAt: null,
      source: "seed",
      lastRun: { status: "seed", at: new Date().toISOString(), message: "Sample snapshot — run TinyFish discovery to fetch live" },
      changes: [],
    };
    changed = true;
  }
  if (changed) store.save();
}

/** Everything orderable, plus vendor metadata. */
function getCatalog() {
  const db = store.get();
  const vendors = [{ ...CANTEEN, itemCount: CANTEEN_ITEMS.length, fetchedAt: null, lastRun: null }];
  let items = canteenItems();
  let offers = [...CANTEEN_OFFERS];
  for (const v of loadVendorConfig()) {
    const snap = db.vendors[v.id];
    vendors.push({
      id: v.id, name: v.name, location: v.location || "", url: v.url,
      deliveryFee: v.deliveryFee ?? DELIVERY_FEE,
      source: snap?.source || "none", fetchedAt: snap?.fetchedAt || null,
      lastRun: snap?.lastRun || null, itemCount: snap?.items?.length || 0,
      changes: snap?.changes || [], notes: snap?.notes || "",
    });
    if (snap) {
      items = items.concat(snap.items.map(i => ({ ...i, vendorName: v.name, source: snap.source })));
      offers = offers.concat(snap.offers);
    }
  }
  return { vendors, items, offers };
}

function itemById(id, catalog = getCatalog()) {
  return catalog.items.find(i => i.id === id) || null;
}

module.exports = {
  CANTEEN, DELIVERY_FEE, getCatalog, itemById, loadVendorConfig, saveVendorConfig,
  normalizeSnapshot, diffSnapshots, ensureSeeded, slug,
};
