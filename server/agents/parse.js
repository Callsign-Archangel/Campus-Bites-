/**
 * parse.js — understands what a student typed.
 * Rule-based on purpose: instant, free, works offline, and every number it
 * extracts is shown back to the student so they can see how it was read.
 */

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, pair: 2 };
const n = s => (s == null ? null : WORD_NUM[s] ?? Number(s));

function parseRequest(text = "", catalog) {
  const raw = String(text);
  const t = raw.toLowerCase().replace(/rs\.?|inr|rupees?|\/-/g, " ₹ ").replace(/\s+/g, " ");

  // ---- people ----
  let people = null;
  const NUMW = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const pm =
    t.match(new RegExp(`${NUMW}\\s*(?:people|persons?|friends|of us|members|guys|students|ppl|pax|heads|mates|roommates)`)) ||
    t.match(new RegExp(`(?:group|team|squad|gang) of\\s*${NUMW}`)) ||
    t.match(new RegExp(`for\\s*${NUMW}\\b(?!\\s*(?:₹|minutes|mins|min|pm|am))`));
  if (pm) people = n(pm[1]);
  if (!people && /\b(couple of us|both of us|me and my (friend|roommate|gf|bf))\b/.test(t)) people = 2;
  if (people && (people < 1 || people > 30)) people = null;

  // ---- budget ----
  let budget = null;
  const bm =
    t.match(/₹\s*(\d{2,5})/) ||
    t.match(/(\d{2,5})\s*₹/) ||
    t.match(/(?:under|below|within|max|upto|up to|budget(?: of| is)?|have|got|only|less than)\s*₹?\s*(\d{2,5})/);
  if (bm) budget = Number(bm[1]);
  const perHead = /\b(each|per (?:person|head)|a head|apiece)\b/.test(t);
  if (budget && perHead && people) budget *= people;

  // ---- dietary & goals ----
  const nonVegWords = /non[- ]?veg|chicken|egg|mutton|fish|meat/;
  const vegOnly = /\b(pure veg|vegetarian|veg only|only veg|no egg|no meat|jain)\b/.test(t) ||
    (/\bveg\b/.test(t) && !nonVegWords.test(t) && !/\d+\s*veg/.test(t));
  const vegCountM = t.match(/(\d+|one|two|three|four|five|six)\s*(?:are |is )?(?:veg|vegetarians?)\b/);
  const nonVegCountM = t.match(/(\d+|one|two|three|four|five|six)\s*(?:are |is )?non[- ]?veg/);

  const goals = {
    protein: /protein|gym|muscle|gains|workout|bulk/.test(t),
    filling: /filling|heavy|hungry|starving|full|big|stomach|proper meal|hearty/.test(t),
    light: /\blight\b|snack|quick bite|small/.test(t),
    cheap: /cheap|cheapest|lowest|save|saving|deal|discount|offer|coupon|budget/.test(t),
    drink: /drink|coffee|chai|tea|shake|lassi|beverage|juice/.test(t),
    sweet: /dessert|sweet|meetha/.test(t),
  };
  const meal = (t.match(/\b(breakfast|lunch|dinner|snack|brunch)\b/) || [])[1] || null;
  const mode = /\bdeliver|delivery|to my (hostel|room)|hostel [abc]\b/.test(t) ? "delivery" : /\bpick ?up|takeaway|collect\b/.test(t) ? "pickup" : null;

  // exclusions: "no paneer", "without onion", "avoid chicken"
  const exclude = [...t.matchAll(/\b(?:no|without|avoid|except|not)\s+([a-z]{3,})/g)].map(m => m[1]).filter(w => !["veg", "more", "than", "need", "want", "delivery", "egg", "meat"].includes(w));

  // vendor mentions
  let vendorId = null;
  if (catalog) {
    for (const v of catalog.vendors) {
      const words = v.name.toLowerCase().replace(/campus bites canteen/, "campus bites|canteen").split("|");
      if (words.some(w => t.includes(w)) || t.includes(v.name.split(" ")[0].toLowerCase() + " " + (v.name.split(" ")[1] || "").toLowerCase())) { vendorId = v.id; break; }
    }
  }

  const orderId = (raw.match(/\bCB\s?-?\d{6}\b/i) || [])[0]?.replace(/[\s-]/g, "").toUpperCase() || null;
  const phone = (raw.replace(/[\s-]/g, "").match(/(?<!\d)[6-9]\d{9}(?!\d)/) || [])[0] || null;

  return {
    text: raw, budget, people, perHead, vegOnly,
    vegCount: vegCountM ? n(vegCountM[1]) : null,
    nonVegCount: nonVegCountM ? n(nonVegCountM[1]) : null,
    goals, meal, mode, exclude, vendorId, orderId, phone,
  };
}

function detectIntent(text, p) {
  const t = text.toLowerCase();
  if (p.orderId || /where('?s| is)? my (order|food)|track|order status|status of my|when will (it|my|the)|how long|eta|delayed|is it ready|arriv|still waiting|my order/.test(t)) return "track";
  if ((p.people && p.people > 1) || /\b(group|team|all of us|for us|squad|shared cart|split)\b/.test(t)) return "group";
  if (/deal|discount|offer|coupon|promo|cheapest|lowest price|save money|best price|bargain/.test(t)) return "deals";
  if (/what('?s| is) new|menu change|price change|latest menu|live menu|refresh menu/.test(t)) return "menu";
  return "assistant";
}

module.exports = { parseRequest, detectIntent };
