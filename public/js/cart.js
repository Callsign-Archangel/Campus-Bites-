/**
 * cart.js — Cart state & UI updates
 * Items can come from any campus vendor. Prices, offers and delivery fees are
 * re-checked by the server (/api/quote) so the totals the student sees are real.
 */

const Cart = (() => {
  let items = U.store.get("cb_cart", {}); // { [itemId]: quantity }
  let quote = null;
  let quoteTimer = null;
  const listeners = [];

  function _clean() {
    for (const id of Object.keys(items)) if (!Catalog.item(id)) delete items[id];
  }

  function getCount() { return Object.values(items).reduce((sum, q) => sum + q, 0); }
  function getSubtotal() { return getItems().reduce((s, m) => s + m.price * items[m.id], 0); }
  function getItems() { return Object.keys(items).map(Catalog.item).filter(Boolean); }
  function getLines() { return Object.entries(items).map(([itemId, qty]) => ({ itemId, qty })); }
  function getQty(id) { return items[id] || 0; }
  function getQuote() { return quote; }

  function update(id, delta) {
    if (!Catalog.item(id)) return;
    items[id] = Math.max(0, (items[id] || 0) + delta);
    if (items[id] === 0) delete items[id];
    _changed();
  }

  /** Used by the AI agents: "Add all to cart" */
  function addLines(lines) {
    for (const l of lines) if (Catalog.item(l.itemId)) items[l.itemId] = (items[l.itemId] || 0) + (l.qty || 1);
    _changed();
  }

  function clear() { items = {}; _changed(); }
  function onChange(fn) { listeners.push(fn); }

  function _changed() {
    U.store.set("cb_cart", items);
    _refreshBadge();
    _refreshPanel();
    listeners.forEach(fn => fn());
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(refreshQuote, 250);
  }

  async function refreshQuote(mode = "delivery") {
    if (!getCount()) { quote = null; _refreshTotals(); return null; }
    try { quote = await U.api("/api/quote", { body: { lines: getLines(), mode } }); }
    catch { quote = null; }
    _refreshTotals();
    return quote;
  }

  // ---- private UI helpers ----

  function _refreshBadge() {
    document.getElementById("cart-count").textContent = getCount();
  }

  function _refreshPanel() {
    const list   = document.getElementById("cart-items-list");
    const footer = document.getElementById("cart-footer");
    const cartItems = getItems();

    if (!cartItems.length) {
      list.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty-icon">🛒</div>
          <p>Your cart is empty</p>
          <p style="font-size:13px;margin-top:6px;color:var(--muted)">Add something delicious — or ask the AI agent!</p>
        </div>`;
      footer.style.display = "none";
      return;
    }

    footer.style.display = "block";
    const vendorsInCart = new Set(cartItems.map(m => m.vendorId));

    list.innerHTML = cartItems.map(m => `
      <div class="cart-item">
        <span class="cart-item-emoji">${U.esc(m.emoji)}</span>
        <div class="cart-item-info">
          <div class="cart-item-name">${U.esc(m.name)}</div>
          ${vendorsInCart.size > 1 || m.vendorId !== "campus-bites" ? `<div class="cart-item-vendor">${U.esc(m.vendorName)}</div>` : ""}
          <div class="cart-item-price">₹${m.price} × ${items[m.id]}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" data-id="${U.esc(m.id)}" data-delta="-1" aria-label="Remove one">−</button>
          <span class="qty-num">${items[m.id]}</span>
          <button class="qty-btn" data-id="${U.esc(m.id)}" data-delta="1"  aria-label="Add one">+</button>
        </div>
      </div>
    `).join("");
    _refreshTotals();
  }

  function _refreshTotals() {
    const sub = getSubtotal();
    const disc = quote?.discount || 0;
    const fee = quote ? quote.fee : 20;
    document.getElementById("cart-subtotal").textContent = U.rupee(sub);
    const discRow = document.getElementById("cart-discount-row");
    if (discRow) {
      discRow.style.display = disc ? "flex" : "none";
      document.getElementById("cart-discount").textContent = `−${U.rupee(disc)}`;
      document.getElementById("cart-discount-label").textContent = quote?.vendors.filter(v => v.offer).map(v => v.offer.title).join(", ") || "Offers";
    }
    document.getElementById("cart-fee").textContent = U.rupee(fee);
    document.getElementById("cart-grand").textContent = U.rupee(sub - disc + fee);
  }

  function init() {
    _clean();
    _refreshBadge();
    _refreshPanel();
    refreshQuote();
  }

  return { init, update, addLines, clear, getCount, getSubtotal, getItems, getLines, getQty, getQuote, refreshQuote, onChange };
})();
