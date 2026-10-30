/**
 * discovery.js — Live Menu & Price Discovery with TinyFish.
 *
 * For every vendor in data/vendors.json, a TinyFish web agent opens the vendor's
 * website / online menu and extracts items, prices, availability and offers.
 * We normalise the result, diff it against the previous snapshot (menu changes,
 * price drops, new offers) and save it. Every other agent reads from this data.
 */
const { EventEmitter } = require("events");
const store = require("./store");
const tinyfish = require("./tinyfish");
const { loadVendorConfig, normalizeSnapshot, diffSnapshots } = require("./catalog");

const bus = new EventEmitter();          // live progress → SSE clients
bus.setMaxListeners(100);
const running = new Map();               // vendorId → Promise (one run per vendor at a time)

const MENU_GOAL = `You are looking at the online menu of a campus food vendor.
Extract EVERY food and drink item listed (check all sections, tabs or pages of the menu).
Return ONLY valid JSON, no commentary, exactly in this shape:
{
  "vendor_name": string,
  "items": [
    {
      "name": string,
      "price": number,            // current selling price in INR, digits only
      "original_price": number|null, // struck-through / old price if shown
      "category": string,         // the menu section it is listed under
      "description": string,
      "veg": boolean|null,        // from veg/non-veg marks if shown
      "available": boolean,       // false if marked sold out / unavailable
      "protein_g": number|null    // only if the page states protein
    }
  ],
  "offers": [ { "title": string, "details": string, "code": string|null } ],
  "notes": string                 // opening hours or anything notable, else ""
}
Do not invent items or prices that are not on the page.`;

function resolveUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) {
    throw new Error(
      `"${url}" is a local path. TinyFish runs in the cloud and cannot open localhost — ` +
      `set PUBLIC_BASE_URL in .env to your deployed/tunnel URL, or give the vendor a full https:// URL.`
    );
  }
  return base + (url.startsWith("/") ? url : `/${url}`);
}

function emit(evt) { bus.emit("event", { ...evt, ts: Date.now() }); }

async function discoverVendor(vendor) {
  if (running.has(vendor.id)) return running.get(vendor.id);
  const p = (async () => {
    const db = store.get();
    const prev = db.vendors[vendor.id];
    emit({ type: "vendor_start", vendorId: vendor.id, vendorName: vendor.name });
    const started = Date.now();
    try {
      const url = resolveUrl(vendor.url);
      const { runId, result } = await tinyfish.runAgent({
        url,
        goal: MENU_GOAL,
        onEvent: e => {
          if (e.type === "PROGRESS") emit({ type: "progress", vendorId: vendor.id, message: e.purpose || "Working…" });
          else if (e.type === "STREAMING_URL") emit({ type: "streaming_url", vendorId: vendor.id, url: e.streaming_url || e.url });
          else if (e.type === "STARTED") emit({ type: "progress", vendorId: vendor.id, message: `TinyFish agent started on ${url}` });
        },
      });
      const snap = normalizeSnapshot(vendor, result);
      if (!snap.items.length) throw new Error("TinyFish finished but returned no menu items");
      const changes = diffSnapshots(prev, snap);
      db.vendors[vendor.id] = {
        ...snap,
        fetchedAt: new Date().toISOString(),
        source: "tinyfish",
        lastRun: { status: "ok", at: new Date().toISOString(), runId, seconds: Math.round((Date.now() - started) / 1000) },
        changes: prev?.source === "tinyfish" || prev?.source === "seed" ? changes : [],
      };
      db.discoveryLog.unshift({ vendorId: vendor.id, at: new Date().toISOString(), status: "ok", items: snap.items.length, offers: snap.offers.length, changes: changes.length, runId });
      db.discoveryLog = db.discoveryLog.slice(0, 50);
      store.save();
      emit({ type: "vendor_done", vendorId: vendor.id, items: snap.items.length, offers: snap.offers.length, changes });
      return db.vendors[vendor.id];
    } catch (err) {
      const message = err.message || String(err);
      if (prev) prev.lastRun = { ...(prev.lastRun || {}), status: "error", at: new Date().toISOString(), message };
      else db.vendors[vendor.id] = { items: [], offers: [], changes: [], source: "none", fetchedAt: null, lastRun: { status: "error", at: new Date().toISOString(), message } };
      db.discoveryLog.unshift({ vendorId: vendor.id, at: new Date().toISOString(), status: "error", message });
      db.discoveryLog = db.discoveryLog.slice(0, 50);
      store.save();
      emit({ type: "vendor_error", vendorId: vendor.id, message });
      throw err;
    } finally {
      running.delete(vendor.id);
    }
  })();
  running.set(vendor.id, p);
  return p;
}

/** Refresh one vendor (id) or all vendors in parallel. Never throws. */
async function discover(vendorId) {
  const vendors = loadVendorConfig().filter(v => !vendorId || vendorId === "all" || v.id === vendorId);
  emit({ type: "run_start", vendors: vendors.map(v => v.id) });
  const results = await Promise.allSettled(vendors.map(discoverVendor));
  const ok = results.filter(r => r.status === "fulfilled").length;
  emit({ type: "run_done", ok, failed: results.length - ok });
  return { ok, failed: results.length - ok };
}

function isRunning() { return running.size > 0; }

module.exports = { discover, discoverVendor, bus, isRunning, resolveUrl, MENU_GOAL };
