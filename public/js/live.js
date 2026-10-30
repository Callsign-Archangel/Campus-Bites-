/**
 * live.js — Live Menu & Price Discovery (TinyFish).
 * Starts TinyFish web agents that visit each vendor's website, and streams
 * their progress here. Results (items, prices, offers, menu changes) feed
 * the menu and every AI agent.
 */
const LivePage = (() => {
  let es = null;
  let status = null;
  const progress = {}; // vendorId → { lines: [], state, liveUrl }

  async function render() {
    const page = document.getElementById("page-live");
    page.innerHTML = `<div class="live-wrap"><p class="muted-note">Loading vendors…</p></div>`;
    let data;
    try {
      [status, data] = await Promise.all([U.api("/api/status"), U.api("/api/vendors")]);
    } catch (e) { page.innerHTML = `<div class="live-wrap"><p class="form-error" style="display:block">${U.esc(e.message)}</p></div>`; return; }
    draw(data);
    connect();
  }

  function draw({ vendors, log }) {
    const page = document.getElementById("page-live");
    const tf = status.tinyfish;
    page.innerHTML = `
      <div class="live-wrap">
        <div class="agents-head">
          <h1>Live <span class="accent">Menus</span></h1>
          <p><strong>TinyFish</strong> web agents visit each campus vendor's website, read the menu like a person would, and bring back items, current prices, special offers and what changed since last time.</p>
        </div>

        <div class="tf-status ${tf.configured ? "ok" : "warn"}">
          ${tf.configured
            ? `🐟 TinyFish connected${tf.publicBaseUrl ? ` · vendor pages served from <code>${U.esc(tf.publicBaseUrl)}</code>` : ` · <strong>PUBLIC_BASE_URL not set</strong> — vendors with local paths can't be reached by TinyFish (it runs in the cloud).`}`
            : `⚠️ <strong>TINYFISH_API_KEY</strong> isn't set on the server. Menus below are sample snapshots. Add the key to <code>.env</code> and restart to fetch live.`}
        </div>

        <div class="live-actions">
          <button class="checkout-btn" id="refresh-all" ${tf.configured ? "" : "disabled"}>🐟 Refresh all menus with TinyFish</button>
        </div>

        <div class="vendor-grid">
          ${vendors.map(vendorCard).join("") || `<p class="muted-note">No vendors yet — add one below.</p>`}
        </div>

        <details class="form-section add-vendor">
          <summary class="form-section-title">➕ Add a vendor website</summary>
          <form id="add-vendor-form">
            <div class="form-row">
              <div class="form-group"><label for="v-name">Vendor name</label><input id="v-name" required placeholder="Night Canteen" /></div>
              <div class="form-group"><label for="v-url">Menu URL</label><input id="v-url" required placeholder="https://… (online menu, Zomato/Swiggy page, Google Sites…)" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label for="v-loc">Location on campus</label><input id="v-loc" placeholder="Hostel C basement" /></div>
              <div class="form-group"><label for="v-fee">Delivery fee (₹)</label><input id="v-fee" type="number" value="20" min="0" max="100" /></div>
            </div>
            <button class="mini-btn" type="submit">Add vendor</button>
          </form>
        </details>

        ${log.length ? `
        <details class="form-section">
          <summary class="form-section-title">📜 Discovery log</summary>
          ${log.map(l => `<div class="log-row ${l.status}">${U.esc(U.timeAgo(l.at))} · ${U.esc(l.vendorId)} · ${l.status === "ok" ? `${l.items} items, ${l.offers} offers, ${l.changes} changes` : U.esc(l.message)}</div>`).join("")}
        </details>` : ""}
      </div>`;
    bind(page);
  }

  function sourceBadge(v) {
    if (v.lastRun?.status === "error" && v.source !== "tinyfish") return `<span class="src err">Last run failed</span>`;
    if (v.source === "tinyfish") return `<span class="src live">🐟 Live · ${U.esc(U.timeAgo(v.fetchedAt))}</span>`;
    if (v.source === "seed") return `<span class="src seed">Sample snapshot</span>`;
    return `<span class="src">Not fetched yet</span>`;
  }

  function vendorCard(v) {
    const p = progress[v.id];
    const items = Catalog.items.filter(i => i.vendorId === v.id);
    const offers = Catalog.offers.filter(o => o.vendorId === v.id);
    const icon = { added: "🆕", removed: "❌", price_drop: "📉", price_up: "📈", sold_out: "⛔", back_in_stock: "✅", new_offer: "🏷️", offer_ended: "⌛" };
    return `
      <div class="vendor-card" data-vendor="${U.esc(v.id)}">
        <div class="vendor-card-head">
          <div>
            <div class="vendor-name">${U.esc(v.name)}</div>
            <div class="vendor-meta">${U.esc(v.location || "")}${v.url ? ` · <a href="${U.esc(v.url)}" target="_blank" rel="noopener">menu page ↗</a>` : ""}</div>
          </div>
          ${sourceBadge(v)}
        </div>
        ${v.lastRun?.status === "error" ? `<div class="run-error">⚠️ ${U.esc(v.lastRun.message)}</div>` : ""}
        <div class="vendor-stats">
          <span><strong>${items.length}</strong> items</span>
          <span><strong>${items.filter(i => !i.available).length}</strong> sold out</span>
          <span><strong>${offers.length}</strong> offers</span>
        </div>
        ${offers.length ? `<div class="vendor-offers">${offers.map(o => `<span class="offer-chip">🏷️ ${U.esc(o.title)}</span>`).join("")}</div>` : ""}
        ${v.changes?.length ? `<div class="vendor-changes"><div class="mini-title">Changes on last refresh</div>
          ${v.changes.slice(0, 6).map(ch => `<div>${icon[ch.type] || "•"} ${U.esc(ch.item)} ${ch.from != null ? `₹${ch.from} → ₹${ch.to}` : `<span class="muted">${U.esc(ch.type.replace(/_/g, " "))}</span>`}</div>`).join("")}</div>` : ""}
        <details class="vendor-menu"><summary>View extracted menu</summary>
          <table>${items.map(i => `<tr class="${i.available ? "" : "muted"}"><td>${U.esc(i.emoji)} ${U.esc(i.name)}${i.available ? "" : " (sold out)"}</td><td>${U.esc(i.vendorCat || i.cat)}</td><td>${i.originalPrice ? `<s>₹${i.originalPrice}</s> ` : ""}₹${i.price}</td></tr>`).join("")}</table>
        </details>
        <div class="progress-log" id="log-${U.esc(v.id)}" ${p ? "" : "hidden"}>
          ${p ? p.lines.map(l => `<div>${U.esc(l)}</div>`).join("") : ""}
          ${p?.liveUrl ? `<a href="${U.esc(p.liveUrl)}" target="_blank" rel="noopener">▶ Watch the TinyFish browser live</a>` : ""}
        </div>
        <div class="vendor-actions">
          <button class="mini-btn" data-refresh="${U.esc(v.id)}" ${status.tinyfish.configured ? "" : "disabled"}>${p?.state === "running" ? "Running…" : "🐟 Refresh"}</button>
          <button class="link-btn danger" data-remove="${U.esc(v.id)}">Remove</button>
        </div>
      </div>`;
  }

  function bind(page) {
    page.querySelector("#refresh-all")?.addEventListener("click", () => start("all"));
    page.querySelectorAll("[data-refresh]").forEach(b => b.addEventListener("click", () => start(b.dataset.refresh)));
    page.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
      if (!window.confirm || !confirm("Remove this vendor and its menu?")) return;
      await U.api(`/api/vendors/${b.dataset.remove}`, { method: "DELETE" });
      await reload();
    }));
    page.querySelector("#add-vendor-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const v = await U.api("/api/vendors", { body: {
          name: page.querySelector("#v-name").value, url: page.querySelector("#v-url").value,
          location: page.querySelector("#v-loc").value, deliveryFee: page.querySelector("#v-fee").value } });
        U.toast(`Added **${v.name}**${status.tinyfish.configured ? " — fetching its menu with TinyFish…" : ""}`, "ok");
        await reload();
        if (status.tinyfish.configured) start(v.id);
      } catch (err) { U.toast(err.message, "warn"); }
    });
  }

  async function start(vendor) {
    try {
      await U.api(`/api/discover?vendor=${encodeURIComponent(vendor)}`, { method: "POST" });
      U.toast(vendor === "all" ? "🐟 TinyFish agents dispatched to every vendor" : "🐟 TinyFish agent dispatched");
    } catch (e) { U.toast(e.message, "warn"); }
  }

  function connect() {
    if (es) return;
    es = new EventSource("/api/discover/stream");
    es.onmessage = async m => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      const id = e.vendorId;
      if (e.type === "vendor_start") progress[id] = { lines: ["Dispatching TinyFish agent…"], state: "running" };
      else if (e.type === "progress" && progress[id]) progress[id].lines.push(e.message);
      else if (e.type === "streaming_url" && progress[id]) progress[id].liveUrl = e.url;
      else if (e.type === "vendor_done") {
        if (progress[id]) { progress[id].state = "done"; progress[id].lines.push(`✓ ${e.items} items, ${e.offers} offers, ${e.changes.length} changes`); }
        U.toast(`🐟 **${id}** menu updated: ${e.items} items, ${e.changes.length} change${e.changes.length === 1 ? "" : "s"}`, "ok");
        await Catalog.load(); MenuPage.refresh();
      } else if (e.type === "vendor_error") {
        if (progress[id]) { progress[id].state = "error"; progress[id].lines.push(`✗ ${e.message}`); }
        U.toast(`TinyFish couldn't refresh **${id}**: ${e.message}`, "warn", 8000);
      } else return;
      if (!document.getElementById("page-live").classList.contains("active")) return;
      if (["vendor_done", "vendor_error"].includes(e.type)) return reload();
      const box = document.getElementById(`log-${id}`);
      if (box && progress[id]) {
        box.hidden = false;
        box.innerHTML = progress[id].lines.slice(-8).map(l => `<div>${U.esc(l)}</div>`).join("") +
          (progress[id].liveUrl ? `<a href="${U.esc(progress[id].liveUrl)}" target="_blank" rel="noopener">▶ Watch the TinyFish browser live</a>` : "");
        const btn = document.querySelector(`[data-refresh="${CSS.escape(id)}"]`);
        if (btn) btn.textContent = "Running…";
      }
    };
  }

  async function reload() {
    await Catalog.load();
    MenuPage.refresh();
    if (document.getElementById("page-live").classList.contains("active")) {
      draw(await U.api("/api/vendors"));
    }
  }

  return { render, connect };
})();
