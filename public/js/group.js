/**
 * group.js — shared group cart (#group/<id>).
 * Everyone opens the same link, names their seat, swaps their plate if they
 * want, and taps "I'm in". When all seats are confirmed, anyone can place it.
 */
const GroupPage = (() => {
  let cartId = null;
  let cart = null;
  let timer = null;

  async function render({ id } = {}) {
    cartId = id;
    const page = document.getElementById("page-group");
    page.innerHTML = `<div class="checkout-wrap"><p class="muted-note">Loading group cart…</p></div>`;
    await load();
    clearInterval(timer);
    timer = setInterval(() => {
      if (!page.classList.contains("active")) return clearInterval(timer);
      if (page.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")) return;
      load();
    }, 5000);
  }

  async function load() {
    try { cart = await U.api(`/api/group-carts/${encodeURIComponent(cartId)}`); draw(); }
    catch (e) { document.getElementById("page-group").innerHTML = `<div class="checkout-wrap"><h1>Group cart</h1><p class="form-error" style="display:block">${U.esc(e.message)}</p></div>`; }
  }

  function itemOptions(selectedId) {
    return cart.menu.map(m => `<option value="${U.esc(m.id)}"${m.id === selectedId ? " selected" : ""}>${U.esc(m.emoji)} ${U.esc(m.name)} — ₹${m.price}${m.veg ? "" : " (non-veg)"}</option>`).join("");
  }

  function draw() {
    const page = document.getElementById("page-group");
    const link = `${location.origin}${location.pathname}#group/${cart.id}`;
    const placed = cart.status === "placed";
    const confirmedCount = cart.seats.filter(s => s.confirmed).length;
    const saved = U.store.get("cb_customer", {});
    page.innerHTML = `
      <div class="checkout-wrap">
        <button class="back-link" data-go="agents">← Back to Bites AI</button>
        <h1>Group order · ${U.esc(cart.vendorName)}</h1>
        <div class="share-box">
          <input readonly value="${U.esc(link)}" id="share-link" aria-label="Share link" />
          <button class="mini-btn" id="copy-link">Copy link</button>
          ${navigator.share ? `<button class="mini-btn" id="share-link-btn">Share</button>` : ""}
        </div>
        <p class="muted-note">${confirmedCount}/${cart.seats.length} confirmed${cart.budget ? ` · budget ${U.rupee(cart.budget)}` : ""} · ${cart.mode === "delivery" ? "delivery" : "pickup"}</p>
        ${placed ? `<div class="placed-banner">✅ Placed as <strong>#${U.esc(cart.orderId)}</strong> — <a href="#track" data-go="track">track it</a></div>` : ""}

        <div class="seats">
          ${cart.seats.map(s => `
            <div class="seat-card ${s.confirmed ? "confirmed" : ""}" data-seat="${s.seat}">
              <div class="seat-head">
                <span class="seat-no">${s.seat}</span>
                <input class="seat-name" placeholder="Name" value="${U.esc(s.name)}" ${placed ? "disabled" : ""} aria-label="Name for seat ${s.seat}" />
                <span class="seat-price">₹${s.total}</span>
              </div>
              ${s.lines.map((l, i) => `
                <div class="seat-line">
                  <select data-line="${i}" ${placed ? "disabled" : ""} aria-label="Swap item">${itemOptions(l.itemId)}</select>
                  <span class="qty-tag">×${l.qty}</span>
                  ${!placed && s.lines.length > 1 ? `<button class="x-btn" data-remove="${i}" aria-label="Remove">×</button>` : ""}
                </div>`).join("")}
              ${!placed ? `
                <div class="seat-actions">
                  ${s.lines.length < 4 ? `<select class="add-line" aria-label="Add an item"><option value="">+ Add item…</option>${itemOptions("")}</select>` : ""}
                  <button class="confirm-btn ${s.confirmed ? "on" : ""}" data-confirm="${s.confirmed ? 0 : 1}">${s.confirmed ? "✓ I'm in" : "Tap to confirm"}</button>
                </div>` : ""}
            </div>`).join("")}
        </div>
        ${!placed ? `<button class="link-btn" id="add-seat">+ Add a person</button>` : ""}

        <div class="form-section">
          <div class="form-section-title">🧾 Shared bill</div>
          ${cart.bill.vendors.flatMap(v => v.lines).map(l => `<div class="summary-item"><span>${U.esc(l.emoji)} ${U.esc(l.name)} ×${l.qty}</span><span>₹${l.total}</span></div>`).join("")}
          ${cart.bill.discount ? `<div class="summary-item discount"><span>🏷️ ${U.esc(cart.bill.vendors[0].offer.title)}</span><span>−₹${cart.bill.discount}</span></div>` : ""}
          ${cart.bill.fee ? `<div class="summary-item" style="color:var(--muted);font-size:13px"><span>Delivery fee</span><span>₹${cart.bill.fee}</span></div>` : ""}
          <div class="summary-total"><span>Total · ${U.rupee(cart.bill.total / cart.seats.length)}/head</span><span>${U.rupee(cart.bill.total)}</span></div>
          ${cart.overBudget ? `<p class="form-error" style="display:block">Over budget by ${U.rupee(cart.bill.total - cart.budget)}.</p>` : ""}
        </div>

        ${!placed ? `
        <div class="form-section">
          <div class="form-section-title">📦 Place the group order</div>
          <div class="form-row">
            <div class="form-group"><label for="g-name">Your name</label><input id="g-name" value="${U.esc(saved.name || "")}" /></div>
            <div class="form-group"><label for="g-phone">Phone</label><input id="g-phone" maxlength="10" value="${U.esc(saved.phone || "")}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label for="g-loc">Location</label>
              <select id="g-loc">${(Catalog.locations || []).map(l => `<option${(cart.mode === "pickup" ? l === "Pick-up from Canteen" : l === saved.location) ? " selected" : ""}>${U.esc(l)}</option>`).join("")}</select></div>
            <div class="form-group"><label for="g-pay">Payment</label>
              <select id="g-pay"><option value="upi">UPI (split later)</option><option value="cod">Cash on delivery</option></select></div>
          </div>
          <p class="form-error" id="g-error"></p>
          <button class="place-order-btn" id="g-place" ${cart.allConfirmed ? "" : "disabled"}>${cart.allConfirmed ? `✅ Place group order — ${U.rupee(cart.bill.total)}` : `Waiting for ${cart.seats.length - confirmedCount} to confirm…`}</button>
        </div>` : ""}
      </div>`;
    bind(page);
  }

  async function patchSeat(seat, body) {
    try { cart = await U.api(`/api/group-carts/${cart.id}/seats/${seat}`, { method: "PATCH", body }); draw(); }
    catch (e) { U.toast(e.message, "warn"); }
  }

  function seatLines(seatNo) {
    return cart.seats.find(s => s.seat === seatNo).lines.map(l => ({ itemId: l.itemId, qty: l.qty }));
  }

  function bind(page) {
    page.querySelectorAll("[data-go]").forEach(el => el.addEventListener("click", e => { e.preventDefault(); App.go(el.dataset.go); }));
    page.querySelector("#copy-link")?.addEventListener("click", () => {
      const inp = page.querySelector("#share-link");
      (navigator.clipboard?.writeText(inp.value) || Promise.reject()).then(() => U.toast("Link copied — send it to your group!", "ok"))
        .catch(() => { inp.select(); U.toast("Select & copy the link above"); });
    });
    page.querySelector("#share-link-btn")?.addEventListener("click", () => navigator.share({ title: "Our Campus Bites order", url: page.querySelector("#share-link").value }).catch(() => {}));
    page.querySelector("#add-seat")?.addEventListener("click", async () => {
      try { cart = await U.api(`/api/group-carts/${cart.id}/seats`, { method: "POST" }); draw(); } catch (e) { U.toast(e.message, "warn"); }
    });

    page.querySelectorAll(".seat-card").forEach(card => {
      const seat = Number(card.dataset.seat);
      card.querySelector(".seat-name")?.addEventListener("change", e => patchSeat(seat, { name: e.target.value }));
      card.querySelectorAll("select[data-line]").forEach(sel => sel.addEventListener("change", () => {
        const lines = seatLines(seat); lines[Number(sel.dataset.line)].itemId = sel.value; patchSeat(seat, { lines });
      }));
      card.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
        const lines = seatLines(seat); lines.splice(Number(btn.dataset.remove), 1); patchSeat(seat, { lines });
      }));
      card.querySelector(".add-line")?.addEventListener("change", e => {
        if (!e.target.value) return;
        const lines = seatLines(seat); lines.push({ itemId: e.target.value, qty: 1 }); patchSeat(seat, { lines });
      });
      card.querySelector(".confirm-btn")?.addEventListener("click", e => {
        const name = card.querySelector(".seat-name").value;
        patchSeat(seat, { name, confirmed: e.currentTarget.dataset.confirm === "1" });
      });
    });

    page.querySelector("#g-place")?.addEventListener("click", async e => {
      const err = page.querySelector("#g-error");
      const customer = { name: page.querySelector("#g-name").value.trim(), phone: page.querySelector("#g-phone").value.trim(), location: page.querySelector("#g-loc").value };
      e.currentTarget.disabled = true;
      try {
        const res = await U.api(`/api/group-carts/${cart.id}/place`, { body: { customer, payMethod: page.querySelector("#g-pay").value } });
        U.store.set("cb_customer", { ...U.store.get("cb_customer", {}), ...customer });
        Tracker.remember(res.order.id, customer.phone);
        SuccessPage.render(res.order);
        App.go("success");
      } catch (ex) { err.textContent = ex.message; err.style.display = "block"; e.currentTarget.disabled = false; }
    });
  }

  return { render };
})();
