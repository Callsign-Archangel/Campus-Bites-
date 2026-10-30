/** npm run discover [vendorId] — run TinyFish menu discovery from the terminal. */
require("dotenv").config();
const discovery = require("./discovery");
const { ensureSeeded } = require("./catalog");

ensureSeeded();
discovery.bus.on("event", e => {
  if (e.type === "progress") console.log(`  [${e.vendorId}] ${e.message}`);
  if (e.type === "streaming_url") console.log(`  [${e.vendorId}] watch live: ${e.url}`);
  if (e.type === "vendor_done") console.log(`✓ ${e.vendorId}: ${e.items} items, ${e.offers} offers, ${e.changes.length} changes`);
  if (e.type === "vendor_error") console.log(`✗ ${e.vendorId}: ${e.message}`);
});
discovery.discover(process.argv[2] || "all").then(r => {
  console.log(`Done — ${r.ok} ok, ${r.failed} failed`);
  setTimeout(() => process.exit(r.failed ? 1 : 0), 300);
});
