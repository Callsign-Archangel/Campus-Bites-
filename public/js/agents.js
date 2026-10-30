/**
 * agents.js — "Bites AI": one chat for all Campus Bites agents.
 *   🍱 Food Assistant · 🏷️ Deal Finder · 👥 Group Order · 📦 Order Tracking
 * The server picks the agent automatically (or the student pins one).
 */
const AgentsPage = (() => {
  const AGENTS = {
    auto:      { label: "✨ Auto",           hint: "Ask anything — I'll pick the right agent." },
    assistant: { label: "🍱 Food Assistant", hint: "Budget + goal → best meals across every campus menu.",
                 examples: ["I have ₹100, suggest a filling lunch with high protein.", "Light veg snack under ₹60", "Dinner under ₹150, no paneer"] },
    deals:     { label: "🏷️ Deal Finder",    hint: "Compares every vendor's offers and finds the cheapest combo for your budget.",
                 examples: ["Find the best deals for ₹120", "Cheapest proper meal right now?", "Any discounts on chai and snacks?"] },
    group:     { label: "👥 Group Order",    hint: "Builds a shared cart for your group and lets everyone confirm.",
                 examples: ["Order lunch for five people under ₹500", "Dinner for 4 under ₹450, 2 veg", "3 friends, ₹100 each, high protein"] },
    track:     { label: "📦 Track Order",    hint: "Status, prep time, delivery status and delay alerts.",
                 examples: ["Where is my order?", "Is my food delayed?"] },
  };

  let agent = "auto";
  let mode = U.store.get("cb_mode", "pickup");
  let busy = false;
  let rendered = false;
  const payloads = new Map(); // button id → data for "add to cart" / "create shared cart"
  let seq = 0;

  function render(opts = {}) {
    const page = document.getElementById("page-agents");
    if (!rendered) {
      page.innerHTML = `
        <div class="agents-wrap">
          <div class="agents-head">
            <h1>Bites <span class="accent">AI</span></h1>
            <p>Agents that read every campus menu — live prices &amp; offers collected by <strong>TinyFish</strong> web agents — and do the comparing for you.</p>
          </div>
          <div class="agent-tabs" id="agent-tabs" role="tablist">
            ${Object.entries(AGENTS).map(([k, a]) => `<button class="agent-tab${k === agent ? " active" : ""}" data-agent="${k}" role="tab">${a.label}</button>`).join("")}
          </div>
          <div class="agent-hint" id="agent-hint"></div>
          <div class="chat-log" id="chat-log" aria-live="polite"></div>
          <div class="examples" id="examples"></div>
          <form class="chat-form" id="chat-form">
            <div class="mode-toggle" id="mode-toggle" title="Budgets include the delivery fee when Delivery is on">
              <button type="button" data-mode="pickup">🏃 Pickup</button>
              <button type="button" data-mode="delivery">🛵 Delivery</button>
            </div>
            <div class="chat-input-row">
              <input id="chat-input" placeholder="e.g. I have ₹100, suggest a filling lunch with high protein" autocomplete="off" maxlength="300" />
              <button class="send-btn" type="submit" aria-label="Send">➤</button>
            </div>
          </form>
        </div>`;
      _bind(page);
      _greet();
      rendered = true;
    }
    _syncControls();
    if (opts.ask) send(opts.ask);
    else setTimeout(() => document.getElementById("chat-input")?.focus(), 50);
  }

  function _bind(page) {
    page.querySelector("#agent-tabs").addEventListener("click", e => {
      const b = e.target.closest(".agent-tab"); if (!b) return;
      agent = b.dataset.agent; _syncControls();
    });
    page.querySelector("#mode-toggle").addEventListener("click", e => {
      const b = e.target.closest("[data-mode]"); if (!b) return;
      mode = b.dataset.mode; U.store.set("cb_mode", mode); _syncControls();
    });
    page.querySelector("#chat-form").addEventListener("submit", e => {
      e.preventDefault();
      const input = document.getElementById("chat-input");
      const msg = input.value.trim();
      if (msg) { input.value = ""; send(msg); }
    });
    page.addEventListener("click", _onAction);
  }

  function _syncControls() {
    document.querySelectorAll(".agent-tab").forEach(b => b.classList.toggle("active", b.dataset.agent === agent));
    document.querySelectorAll("#mode-toggle [data-mode]").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    document.getElementById("agent-hint").textContent = AGENTS[agent].hint;
    const ex = agent === "auto" ? Object.values(AGENTS).filter(a => a.examples).map(a => a.examples[0]) : AGENTS[agent].examples;
    document.getElementById("examples").innerHTML = ex.map(x => `<button class="example-chip" data-ask="${U.esc(x)}">${U.esc(x)}</button>`).join("");
  }

  function _greet() {
    _bubble("bot", "Hi! I'm **Bites AI**. Tell me your budget and what you're craving, ask for deals, plan food for your group, or ask where your order is. I search every campus menu — including vendor menus fetched live by TinyFish.");
  }

  function _bubble(who, html, isHtml = false) {
    const log = document.getElementById("chat-log");
    const el = document.createElement("div");
    el.className = `msg ${who}`;
    el.innerHTML = isHtml ? html : `<div class="msg-text">${U.md(html)}</div>`;
    log.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
    return el;
  }

  async function send(message) {
    if (busy) return;
    busy = true;
    _bubble("user", message);
    const thinking = _bubble("bot", `<div class="msg-text typing"><span></span><span></span><span></span></div>`, true);
    try {
      const res = await U.api("/api/agent/chat", {
        body: { message, agent, context: { mode, orderIds: U.store.get("cb_orders", []), phone: U.store.get("cb_customer", {}).phone } },
      });
      thinking.remove();
      const label = AGENTS[res.agent]?.label || (res.agent === "menu" ? "🐟 Live Menus" : res.agent);
      const chips = _parsedChips(res.parsed, res.agent);
      _bubble("bot", `
        <div class="msg-agent">${U.esc(label)}${chips}</div>
        <div class="msg-text">${U.md(res.reply)}</div>
        ${(res.cards || []).map(_card).join("")}`, true);
    } catch (e) {
      thinking.remove();
      _bubble("bot", `Sorry — ${e.message}`);
    } finally { busy = false; }
  }

  function _parsedChips(p, which) {
    if (!p || which === "track") return "";
    const bits = [];
    if (p.budget) bits.push(`₹${p.budget}`);
    if (p.people) bits.push(`${p.people} people`);
    if (p.vegOnly) bits.push("veg");
    (p.goals || []).filter(g => g !== "cheap" || which !== "deals").forEach(g => bits.push(g));
    if (p.meal) bits.push(p.meal);
    bits.push(p.mode);
    return bits.length ? `<span class="parsed">understood: ${bits.map(b => `<i>${U.esc(b)}</i>`).join("")}</span>` : "";
  }

  // ---------------- cards ----------------
  function _card(c) {
    switch (c.type) {
      case "combos": return `<div class="card-block"><div class="card-title">${U.esc(c.title)}</div><div class="combo-list">${c.combos.map(_combo).join("")}</div></div>`;
      case "offers": return _offers(c);
      case "pricedrops": return `<div class="card-block"><div class="card-title">${U.esc(c.title)}</div>${c.drops.map(d => `
          <div class="drop-row">📉 <strong>${U.esc(d.item)}</strong> at ${U.esc(d.vendorName)}: <s>₹${d.from}</s> → ₹${d.to}</div>`).join("")}</div>`;
      case "group": return _group(c);
      case "order": return Tracker.orderCardHTML(c.order);
      case "changes": return _changes(c);
      case "suggestions": return `<div class="examples inline">${c.items.map(x => `<button class="example-chip" data-ask="${U.esc(x)}">${U.esc(x)}</button>`).join("")}</div>`;
      default: return "";
    }
  }

  function _combo(c) {
    const id = `p${++seq}`;
    payloads.set(id, { type: "cart", lines: c.lines.map(l => ({ itemId: l.itemId, qty: l.qty })) });
    return `
      <div class="combo">
        <div class="combo-vendor">${U.esc(c.vendorName)} ${c.vendorSource === "tinyfish" ? `<span class="live-tag">🐟 live</span>` : ""}</div>
        <ul class="combo-lines">${c.lines.map(l => `<li><span>${U.esc(l.emoji)} ${l.qty > 1 ? `${l.qty}× ` : ""}${U.esc(l.name)}</span><span>₹${l.price * l.qty}</span></li>`).join("")}</ul>
        ${c.discount ? `<div class="combo-offer">🏷️ ${U.esc(c.offer.title)} <span>−₹${c.discount}</span></div>` : ""}
        ${c.fee ? `<div class="combo-fee">Delivery <span>₹${c.fee}</span></div>` : ""}
        <div class="combo-total"><span>${U.esc(c.why || "")}</span><strong>${U.rupee(c.total)}</strong></div>
        <button class="mini-btn" data-action="${id}">+ Add to cart</button>
      </div>`;
  }

  function _offers(c) {
    return `
      <div class="card-block">
        <div class="card-title">${U.esc(c.title)}</div>
        <div class="offer-table" role="table">
          ${c.offers.map(o => `
            <div class="offer-row" role="row">
              <div class="offer-main">
                <strong>${U.esc(o.title)}</strong>${o.code ? ` <code>${U.esc(o.code)}</code>` : ""}
                <div class="offer-sub">${U.esc(o.vendorName)}${o.source === "tinyfish" ? " · 🐟 found by TinyFish" : o.source === "seed" ? " · sample snapshot" : ""}${o.minOrder ? ` · min ₹${o.minOrder}` : ""}</div>
                ${o.bestUse ? `<div class="offer-use">Best use for ₹${c.budget}: ${U.esc(o.bestUse.lines.map(l => (l.qty > 1 ? l.qty + "× " : "") + l.name).join(" + "))} → ${U.rupee(o.bestUse.total)}</div>` : `<div class="offer-use muted">Can't be used within ₹${c.budget}</div>`}
              </div>
              <div class="offer-save ${o.bestSaving ? "" : "zero"}">${o.bestSaving ? `save ₹${o.bestSaving}` : "—"}</div>
            </div>`).join("")}
        </div>
      </div>`;
  }

  function _group(c) {
    const id = `g${++seq}`;
    payloads.set(id, { type: "group", body: { vendorId: c.vendorId, people: c.request.people, budget: c.request.budget, mode: c.request.mode, seats: c.seats.map(s => ({ lines: s.lines.map(l => ({ itemId: l.itemId, qty: l.qty })) })) } });
    const b = c.bill;
    return `
      <div class="card-block group-card">
        <div class="card-title">Shared cart · ${U.esc(c.vendorName)}</div>
        ${c.seats.map(s => `
          <div class="seat-row">
            <span class="seat-no">${s.seat}</span>
            <span class="seat-items">${s.lines.map(l => `${U.esc(l.emoji)} ${l.qty > 1 ? l.qty + "× " : ""}${U.esc(l.name)}`).join(" + ")}${s.veg ? ` <span class="veg-dot veg"></span>` : ""}</span>
            <span class="seat-price">₹${s.total}</span>
          </div>`).join("")}
        <div class="group-bill">
          <div><span>Items</span><span>${U.rupee(b.subtotal)}</span></div>
          ${b.discount ? `<div class="discount"><span>🏷️ ${U.esc(b.vendors[0].offer.title)}</span><span>−${U.rupee(b.discount)}</span></div>` : ""}
          ${b.fee ? `<div><span>Delivery</span><span>${U.rupee(b.fee)}</span></div>` : ""}
          <div class="total"><span>Total · ${U.rupee(b.total / c.request.people)}/head</span><span>${U.rupee(b.total)}</span></div>
        </div>
        ${c.alternatives.length ? `<div class="alts">Also compared: ${c.alternatives.map(a => `${U.esc(a.vendorName)} ${U.rupee(a.total)}`).join(" · ")}</div>` : ""}
        <button class="checkout-btn" data-action="${id}">👥 Create shared cart &amp; get link</button>
      </div>`;
  }

  function _changes(c) {
    const icon = { added: "🆕", removed: "❌", price_drop: "📉", price_up: "📈", sold_out: "⛔", back_in_stock: "✅", new_offer: "🏷️", offer_ended: "⌛" };
    return `
      <div class="card-block">
        <div class="card-title">Menu changes</div>
        ${c.changes.length ? c.changes.map(ch => `<div class="drop-row">${icon[ch.type] || "•"} ${U.esc(ch.vendorName)}: <strong>${U.esc(ch.item)}</strong> ${ch.from != null ? `₹${ch.from} → ₹${ch.to}` : U.esc(ch.type.replace(/_/g, " "))}</div>`).join("") : `<p class="muted-note">No changes recorded yet.</p>`}
        <button class="mini-btn" data-goto="live">Open Live Menus →</button>
      </div>`;
  }

  async function _onAction(e) {
    const ask = e.target.closest("[data-ask]");
    if (ask) return send(ask.dataset.ask);
    const go = e.target.closest("[data-goto]");
    if (go) return App.go(go.dataset.goto);
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const p = payloads.get(btn.dataset.action);
    if (!p) return;
    if (p.type === "cart") {
      Cart.addLines(p.lines);
      btn.textContent = "✓ Added";
      btn.disabled = true;
      U.toast("Added to cart — open 🛒 to checkout", "ok");
    } else if (p.type === "group") {
      btn.disabled = true; btn.textContent = "Creating…";
      try {
        const cart = await U.api("/api/group-carts", { body: { ...p.body, createdBy: U.store.get("cb_customer", {}).name } });
        App.go("group", { id: cart.id });
      } catch (err) { U.toast(err.message, "warn"); btn.disabled = false; btn.textContent = "👥 Create shared cart & get link"; }
    }
  }

  return { render, send };
})();
