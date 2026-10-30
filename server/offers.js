/**
 * offers.js — turn offer text into structured offers and compute discounts.
 *
 * Offer shape:
 * { id, vendorId, title, details, code, type, value, minOrder, maxDiscount, appliesTo, groups }
 *   type: "percent" | "flat" | "bogo" | "combo" | "info"
 *   appliesTo: matchers limiting which items count (percent/flat/bogo). [] = whole order
 *   groups:    for combo — every group must be present in the cart, e.g. [["cat:Burgers"],["cat:Drinks"]]
 * Matchers: "cat:Drinks" (our category) or a lowercase substring of the item name.
 * Only the single best offer per vendor is applied (no stacking) — like most canteens.
 */

const num = s => (s == null ? null : Number(String(s).replace(/[^\d.]/g, "")) || null);

function matches(item, matcher) {
  const m = String(matcher).toLowerCase().trim();
  if (m.startsWith("cat:")) return item.cat.toLowerCase() === m.slice(4);
  return item.name.toLowerCase().includes(m);
}
const matchesAny = (item, list) => !list || !list.length || list.some(m => matches(item, m));

const CAT_WORDS = {
  drinks: /\b(chai|tea|coffee|drinks?|beverages?|shakes?)\b/, snacks: /\b(snacks?)\b/,
  meals: /\b(meals?|thalis?)\b/, bowls: /\bbowls?\b/, burgers: /\bburgers?\b/, pizza: /\bpizzas?\b/,
  desserts: /\b(desserts?|sweets?)\b/,
};

const STOP = new Set("any with off flat above over orders order only all every combo offer offers free valid till weekdays weekday lunch dinner code use pair from on the and for your one item items".split(" "));

/** Prefer item-name words ("chai", "thali", "bowl"), else fall back to our categories. */
function wordMatchers(part, itemNames) {
  const names = itemNames.map(n => n.toLowerCase());
  const out = [];
  for (const w of part.match(/[a-z]{4,}/g) || []) {
    if (STOP.has(w)) continue;
    const cands = [w, w.replace(/es$/, ""), w.replace(/s$/, "")];
    const hit = cands.find(c => c.length >= 4 && names.some(n => n.includes(c)));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out.length ? out : catMatchersIn(part);
}

function catMatchersIn(text) {
  const out = [];
  for (const [cat, re] of Object.entries(CAT_WORDS)) if (re.test(text)) out.push(`cat:${cat[0].toUpperCase()}${cat.slice(1)}`);
  return out;
}

/** Best-effort parse of human offer text (from TinyFish) into a structured offer. */
function parseOffer(raw, vendorId, idx = 0, itemNames = []) {
  const title = String(raw.title || raw.name || raw.offer || "").trim();
  const details = String(raw.details || raw.description || raw.terms || "").trim();
  const text = `${title} ${details}`.toLowerCase().replace(/rs\.?\s*/g, "₹");
  const offer = {
    id: `${vendorId}:offer${idx}`,
    vendorId,
    title: title || details.slice(0, 60) || "Offer",
    details,
    code: raw.code || (text.match(/\bcode[:\s]+([a-z0-9]{4,})/i)?.[1] || "").toUpperCase() || null,
    type: "info",
    value: 0,
    minOrder: 0,
    maxDiscount: null,
    appliesTo: [],
    groups: [],
  };

  const minM = text.match(/(?:above|over|min(?:imum)?(?: order)?(?: of)?|orders? (?:above|over))\s*₹?\s*(\d+)/);
  if (minM) offer.minOrder = Number(minM[1]);
  const capM = text.match(/(?:up ?to|max(?:imum)?(?: discount)?(?: of)?)\s*₹\s*(\d+)/);
  if (capM) offer.maxDiscount = Number(capM[1]);

  const named = itemNames.filter(n => n.length > 3 && text.includes(n.toLowerCase()));
  const titleL = title.toLowerCase().replace(/rs\.?\s*/g, "₹");
  const pct = text.match(/(\d{1,2})\s*%\s*off/);
  const flat = text.match(/(?:flat\s*)?₹\s*(\d+)\s*off/);

  if (/buy\s*1\s*get\s*1|bogo|1\s*\+\s*1/.test(text)) {
    offer.type = "bogo";
    offer.appliesTo = named.length ? named.map(n => n.toLowerCase()) : wordMatchers(titleL, itemNames);
  } else if (/\+|combo|with any|along with/.test(titleL) && (flat || pct)) {
    // "Any chai + any snack: ₹10 off"
    const parts = titleL.replace(/[:\-–].*$/, "").split(/\+|with any|along with/).slice(0, 2);
    const groups = parts.map(p => wordMatchers(p, itemNames));
    if (groups.length === 2 && groups.every(g => g.length)) {
      offer.type = flat ? "combo" : "combo_percent";
      offer.value = Number((flat || pct)[1]);
      offer.groups = groups;
    } else if (flat) { offer.type = "flat"; offer.value = Number(flat[1]); }
  } else if (pct) {
    offer.type = "percent";
    offer.value = Number(pct[1]);
    offer.appliesTo = named.length ? named.map(n => n.toLowerCase()) : wordMatchers(titleL.replace(/^[a-z0-9]+:/, ""), itemNames);
  } else if (flat) {
    offer.type = "flat";
    offer.value = Number(flat[1]);
  }
  if (raw.type && ["percent", "flat", "bogo", "combo"].includes(raw.type)) {
    // structured fields from TinyFish win when present
    offer.type = raw.type;
    offer.value = num(raw.value) ?? offer.value;
    offer.minOrder = num(raw.min_order) ?? offer.minOrder;
    offer.maxDiscount = num(raw.max_discount) ?? offer.maxDiscount;
  }
  return offer;
}

/**
 * Discount an offer gives on a set of lines from ONE vendor.
 * lines: [{ item, qty }]
 */
function discountFor(offer, lines) {
  const subtotal = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  if (subtotal < (offer.minOrder || 0)) return 0;
  let d = 0;
  switch (offer.type) {
    case "percent": {
      const base = lines.filter(l => matchesAny(l.item, offer.appliesTo)).reduce((s, l) => s + l.item.price * l.qty, 0);
      d = Math.floor((base * offer.value) / 100);
      break;
    }
    case "flat":
      d = offer.value;
      break;
    case "bogo":
      for (const l of lines) if (offer.appliesTo.length && matchesAny(l.item, offer.appliesTo)) d += Math.floor(l.qty / 2) * l.item.price;
      break;
    case "combo":
    case "combo_percent": {
      // how many complete combos can be formed
      const counts = offer.groups.map(g => lines.filter(l => matchesAny(l.item, g)).reduce((s, l) => s + l.qty, 0));
      const n = Math.min(...counts);
      if (n > 0) {
        if (offer.type === "combo") d = offer.value * n;
        else {
          const prices = offer.groups.map(g => Math.min(...lines.filter(l => matchesAny(l.item, g)).map(l => l.item.price)));
          d = Math.floor((prices.reduce((a, b) => a + b, 0) * offer.value) / 100) * n;
        }
      }
      break;
    }
    default:
      d = 0;
  }
  if (offer.maxDiscount) d = Math.min(d, offer.maxDiscount);
  return Math.max(0, Math.min(d, subtotal));
}

function bestOffer(offers, lines) {
  let best = null, amount = 0;
  for (const o of offers) {
    const d = discountFor(o, lines);
    if (d > amount) { amount = d; best = o; }
  }
  return { offer: best, discount: amount };
}

module.exports = { parseOffer, discountFor, bestOffer, matches };
