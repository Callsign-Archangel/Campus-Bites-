/**
 * Campus Bites server — static frontend + REST API + TinyFish-powered agents.
 *   npm install && cp .env.example .env  (add TINYFISH_API_KEY)  && npm start
 */
require("dotenv").config();
const path = require("path");
const express = require("express");

const store = require("./store");
const tinyfish = require("./tinyfish");
const catalogMod = require("./catalog");
const discovery = require("./discovery");
const orders = require("./orders");
const agents = require("./agents/chat");

catalogMod.ensureSeeded();

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

const wrap = fn => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === "function") out.then(v => v !== undefined && res.json(v)).catch(e => fail(res, e));
    else if (out !== undefined) res.json(out);
  } catch (e) { fail(res, e); }
};
function fail(res, e) {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message || "Something went wrong" });
}

// ---------------------------------------------------------------- status
app.get("/api/status", wrap(() => ({
  tinyfish: { configured: tinyfish.isConfigured(), publicBaseUrl: process.env.PUBLIC_BASE_URL || null, running: discovery.isRunning() },
  demoSpeed: Number(process.env.DEMO_SPEED || 1),
  kitchenPin: Boolean(process.env.KITCHEN_PIN),
})));

// ---------------------------------------------------------------- catalog
app.get("/api/catalog", wrap(() => {
  const c = catalogMod.getCatalog();
  return { vendors: c.vendors, items: c.items, offers: c.offers, locations: Object.keys(orders.LOCATIONS) };
}));

app.post("/api/quote", wrap(req => orders.computeBill(req.body.lines, req.body.mode)));

// ---------------------------------------------------------------- live menu discovery (TinyFish)
app.get("/api/vendors", wrap(() => {
  const c = catalogMod.getCatalog();
  return { vendors: c.vendors.filter(v => v.source !== "own"), log: store.get().discoveryLog.slice(0, 20) };
}));

app.post("/api/vendors", wrap(req => {
  const { name, url, location, deliveryFee } = req.body || {};
  if (!name || !url) throw orders.httpError(400, "name and url are required");
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) throw orders.httpError(400, "url must start with https:// (or / for a page on this server)");
  const list = catalogMod.loadVendorConfig();
  let id = catalogMod.slug(name) || "vendor";
  while (list.some(v => v.id === id) || id === catalogMod.CANTEEN.id) id += "-2";
  const v = { id, name: String(name).slice(0, 60), url: String(url).slice(0, 500), location: String(location || "").slice(0, 80), deliveryFee: Number(deliveryFee) || 20 };
  list.push(v);
  catalogMod.saveVendorConfig(list);
  return v;
}));

app.delete("/api/vendors/:id", wrap(req => {
  const list = catalogMod.loadVendorConfig().filter(v => v.id !== req.params.id);
  catalogMod.saveVendorConfig(list);
  delete store.get().vendors[req.params.id];
  store.save();
  return { ok: true };
}));

/** Kick off TinyFish discovery (all vendors, or ?vendor=id). Progress arrives on /api/discover/stream */
app.post("/api/discover", wrap(req => {
  if (!tinyfish.isConfigured()) throw orders.httpError(400, "TINYFISH_API_KEY is not set on the server. Add it to .env and restart.");
  const vendor = req.query.vendor || req.body?.vendor || "all";
  discovery.discover(vendor).catch(() => {});
  return { started: true, vendor };
}));

/** Server-Sent Events: live TinyFish progress for the Live Menus page. */
app.get("/api/discover/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = evt => res.write(`data: ${JSON.stringify(evt)}\n\n`);
  send({ type: "hello", running: discovery.isRunning() });
  discovery.bus.on("event", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { clearInterval(ping); discovery.bus.off("event", send); });
});

// ---------------------------------------------------------------- agents
app.post("/api/agent/chat", wrap(req => agents.chat(req.body || {})));

// ---------------------------------------------------------------- group carts
app.post("/api/group-carts", wrap(req => agents.createGroupCart(req.body || {})));
app.get("/api/group-carts/:id", wrap(req => {
  const c = agents.findGroupCart(req.params.id);
  if (!c) throw orders.httpError(404, "Group cart not found");
  return agents.groupCartView(c);
}));
app.patch("/api/group-carts/:id/seats/:seat", wrap(req => agents.updateSeat(req.params.id, req.params.seat, req.body || {})));
app.post("/api/group-carts/:id/seats", wrap(req => agents.addSeat(req.params.id)));
app.post("/api/group-carts/:id/place", wrap(req => agents.placeGroupOrder(req.params.id, req.body || {})));

// ---------------------------------------------------------------- orders (our own backend order API)
app.post("/api/orders", wrap(req => orders.createOrder(req.body || {})));
app.get("/api/orders/:id", wrap(req => {
  const o = orders.findOrder(req.params.id);
  if (!o) throw orders.httpError(404, "Order not found");
  return orders.orderView(o);
}));
app.get("/api/orders", wrap(req => {
  const ids = String(req.query.ids || "").split(",").filter(Boolean).slice(0, 20);
  let list = ids.map(orders.findOrder).filter(Boolean);
  if (req.query.phone) list = list.concat(orders.ordersByPhone(req.query.phone));
  const seen = new Set();
  return list.filter(o => !seen.has(o.id) && seen.add(o.id)).map(o => orders.orderView(o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}));

// ---------------------------------------------------------------- kitchen dashboard
function kitchenAuth(req) {
  const pin = process.env.KITCHEN_PIN;
  if (pin && req.get("x-kitchen-pin") !== pin) throw orders.httpError(401, "Wrong kitchen PIN");
}
app.get("/api/kitchen/orders", wrap(req => {
  kitchenAuth(req);
  return store.get().orders.slice(-60).map(o => ({ ...orders.orderView(o), phone: o.customer.phone })).reverse();
}));
app.patch("/api/kitchen/orders/:id", wrap(req => { kitchenAuth(req); return orders.kitchenUpdate(req.params.id, req.body || {}); }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// ---------------------------------------------------------------- boot
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`\n🔥 Campus Bites running on http://localhost:${PORT}`);
  console.log(`   TinyFish: ${tinyfish.isConfigured() ? "API key loaded ✓" : "NO API KEY — set TINYFISH_API_KEY in .env"}`);
  if (!process.env.PUBLIC_BASE_URL) console.log("   PUBLIC_BASE_URL not set — vendor pages under /vendor-sites need a public URL for TinyFish to visit them.");
  const mins = Number(process.env.AUTO_REFRESH_MINUTES || 0);
  if (mins > 0 && tinyfish.isConfigured()) {
    setInterval(() => discovery.discover("all").catch(() => {}), mins * 60000);
    console.log(`   Auto-refreshing vendor menus every ${mins} min`);
  }
});
