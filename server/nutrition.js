/**
 * nutrition.js — rough nutrition + classification for menu items scraped from
 * vendor websites (which rarely list nutrition). Numbers are approximate and
 * the UI labels them "~".
 */

// protein grams per serving for keyword hits (first strong match wins, plus add-ons)
const PROTEIN_RULES = [
  [/whey|protein shake/, 25],
  [/chicken|mutton|fish|keema/, 26],
  [/egg white/, 20],
  [/paneer/, 18],
  [/soya|soy chunk|tofu/, 20],
  [/rajma|chole|chana|chickpea/, 13],
  [/\bdal\b|lentil|sambar/, 11],
  [/sprout/, 11],
  [/omelet|omelette|bhurji|\beggs?\b/, 13],
  [/peanut butter|nut butter/, 9],
  [/thali/, 16],
  [/lassi|milk|shake|curd|yogurt|dahi|raita/, 7],
  [/cheese|pizza/, 12],
];

const CATEGORY_RULES = [
  ["Drinks",   /chai|tea|coffee|shake|lassi|soda|juice|lemonade|smoothie|cola|drink|mojito|buttermilk|chaas/],
  ["Desserts", /gulab|jamun|ice ?cream|brownie|cake|halwa|kheer|pastry|dessert|sweet(?! lassi)/],
  ["Pizza",    /pizza/],
  ["Burgers",  /burger|sandwich/],
  ["Bowls",    /bowl/],
  ["Meals",    /rice|thali|chawal|biryani|pulao|roti|naan|paratha|bhature|curry|masala|meal|wrap|roll|noodle|pasta|maggi|bhaji|khichdi|dosa|idli/],
  ["Snacks",   /salad|samosa|pav|puff|poha|upma|tikki|chaat|toast|fries|pakora|vada|bun|momos|egg|nachos/],
];

const KIND_BY_CAT = {
  Meals: "main", Burgers: "main", Pizza: "main", Bowls: "main",
  Snacks: "side", Drinks: "drink", Desserts: "dessert",
};

function classify(name = "", vendorCat = "", desc = "") {
  const text = `${name} ${vendorCat} ${desc}`.toLowerCase();
  // name is the strongest signal, then vendor category, then description
  for (const src of [name.toLowerCase(), vendorCat.toLowerCase(), text]) {
    for (const [cat, re] of CATEGORY_RULES) if (re.test(src)) return cat;
  }
  return "Snacks";
}

function multiplier(name) {
  const m = name.match(/\((\d+)\s*(?:pc|pcs|pieces)?\)|(\d+)\s*(?:eggs|pc|pcs|pieces)/i);
  const n = m ? Number(m[1] || m[2]) : 1;
  return n >= 2 && n <= 8 ? n : 1;
}

function estimate({ name = "", desc = "", cat = "Snacks", price = 0, protein = null, kcal = null }) {
  const text = `${name} ${desc}`.toLowerCase();
  let p = protein;
  if (p == null) {
    p = 0;
    for (const [re, g] of PROTEIN_RULES) { if (re.test(text)) { p = g; break; } }
    if (/\beggs?\b|boiled/.test(text) && !/egg white|curry|bhurji|rice|roll/.test(text)) p = 6.5 * multiplier(name) || p;
    if (!p) p = { Meals: 9, Burgers: 9, Pizza: 12, Bowls: 12, Snacks: 4, Drinks: 1, Desserts: 3 }[cat] ?? 4;
  }
  let k = kcal;
  if (k == null) {
    const base = { Meals: 560, Burgers: 450, Pizza: 600, Bowls: 480, Snacks: 280, Drinks: 140, Desserts: 280 }[cat] ?? 250;
    // pricier mains tend to be bigger portions
    k = Math.round(base * Math.min(1.35, Math.max(0.7, 0.7 + price / 300)));
    if (/shake|lassi/.test(text)) k = Math.max(k, 260);
  }
  return { protein: Math.round(p), kcal: Math.round(k) };
}

/** 0–10 "how full will this keep me" score. */
function fillScore({ kcal, protein, kind }) {
  const s = kcal / 90 + protein / 8 + (kind === "main" ? 1.5 : 0) - (kind === "drink" ? 1 : 0);
  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

const EMOJI = {
  Meals: "🍛", Burgers: "🍔", Pizza: "🍕", Bowls: "🥗", Snacks: "🥟", Drinks: "🥤", Desserts: "🍮",
};
function emojiFor(name, cat) {
  const n = name.toLowerCase();
  const pairs = [[/chai|tea/, "🍵"], [/coffee/, "☕"], [/shake|lassi|smoothie/, "🥤"], [/egg/, "🥚"],
    [/chicken/, "🍗"], [/paneer/, "🧀"], [/wrap|roll/, "🌯"], [/rice|chawal|pulao|biryani/, "🍚"],
    [/roti|naan|paratha|bhature/, "🫓"], [/salad|sprout|chaat/, "🥗"], [/toast|bun|pav/, "🍞"],
    [/samosa|puff/, "🥟"], [/gulab|jamun|sweet/, "🍮"], [/soda|lemon/, "🍋"], [/thali/, "🍱"], [/banana/, "🍌"]];
  for (const [re, e] of pairs) if (re.test(n)) return e;
  return EMOJI[cat] || "🍽️";
}

module.exports = { classify, estimate, fillScore, emojiFor, KIND_BY_CAT };
