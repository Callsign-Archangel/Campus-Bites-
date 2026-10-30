/**
 * checkout.js — Checkout & success page rendering.
 * Orders are now placed on our backend (POST /api/orders), which re-prices
 * the cart, applies offers and starts live order tracking.
 */

const CheckoutPage = (() => {
  let payMethod = "upi";
  let placing = false;

  function render() {
    const page = document.getElementById("page-checkout");
    const saved = U.store.get("cb_customer", {});
    const locations = Catalog.locations.length ? Catalog.locations : ["Hostel A", "Hostel B", "Hostel C", "Pick-up from Canteen"];

    page.innerHTML = `
      <div class="checkout-wrap">
        <button class="back-link" id="back-to-menu">← Back to Menu</button>
        <h1>Checkout</h1>

        <div class="form-section">
          <div class="form-section-title">📋 Your Details</div>
          <div class="form-row">
            <div class="form-group">
              <label for="f-name">Full Name</label>
              <input type="text" id="f-name" placeholder="Ravi Kumar" autocomplete="name" value="${U.esc(saved.name || "")}" />
            </div>
            <div class="form-group">
              <label for="f-phone">Phone Number</label>
              <input type="tel" id="f-phone" placeholder="9876543210" maxlength="10" autocomplete="tel" value="${U.esc(saved.phone || "")}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="f-roll">Roll Number</label>
              <input type="text" id="f-roll" placeholder="21CS001" value="${U.esc(saved.roll || "")}" />
            </div>
            <div class="form-group">
              <label for="f-hostel">Delivery Location</label>
              <select id="f-hostel">
                <option value="">Select hostel / block</option>
                ${locations.map(l => `<option${saved.location === l ? " selected" : ""}>${U.esc(l)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="f-note">Special Instructions (optional)</label>
            <textarea id="f-note" placeholder="Extra spicy? No onions? Less salt? Tell us!"></textarea>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-title">💳 Payment Method</div>
          <div class="pay-options" id="pay-options">
            ${_payOptHTML("upi",  "📱", "UPI",  "GPay · PhonePe · Paytm")}
            ${_payOptHTML("card", "💳", "Card", "Debit / Credit")}
            ${_payOptHTML("cod",  "💵", "Cash on Delivery", "Pay when delivered")}
          </div>
          <div id="pay-detail"></div>
        </div>

        <div class="form-section">
          <div class="form-section-title">🛒 Order Summary</div>
          <div id="summary-body"><p class="muted-note">Calculating best offers…</p></div>
        </div>

        <p class="form-error" id="checkout-error" role="alert"></p>
        <button class="place-order-btn" id="place-order-btn">✅ Place Order</button>
      </div>`;

    _bindEvents(page);
    _refreshSummary();
  }

  function _mode() {
    const loc = document.getElementById("f-hostel")?.value;
    return loc === "Pick-up from Canteen" ? "pickup" : "delivery";
  }

  async function _refreshSummary() {
    const q = await Cart.refreshQuote(_mode());
    const body = document.getElementById("summary-body");
    if (!body) return;
    if (!q) { body.innerHTML = `<p class="muted-note">Your cart is empty.</p>`; return; }
    body.innerHTML = q.vendors.map(v => `
      ${q.vendors.length > 1 ? `<div class="summary-vendor">${U.esc(v.vendorName)}</div>` : ""}
      ${v.lines.map(l => `
        <div class="summary-item"><span>${U.esc(l.emoji)} ${U.esc(l.name)} ×${l.qty}</span><span>₹${l.total}</span></div>`).join("")}
      ${v.discount ? `<div class="summary-item discount"><span>🏷️ ${U.esc(v.offer.title)}</span><span>−₹${v.discount}</span></div>` : ""}
      ${v.fee ? `<div class="summary-item" style="color:var(--muted);font-size:13px"><span>Delivery fee</span><span>₹${v.fee}</span></div>` : ""}
    `).join("") + `
      ${q.problems.length ? `<p class="form-error" style="display:block">${q.problems.map(U.esc).join("<br>")}</p>` : ""}
      <div class="summary-total"><span>Total</span><span>${U.rupee(q.total)}</span></div>
      ${q.vendors.length > 1 ? `<p class="muted-note">Items from ${q.vendors.length} vendors — each vendor prepares its part separately.</p>` : ""}`;
    document.getElementById("place-order-btn").textContent = `✅ Place Order — ${U.rupee(q.total)}`;
    _renderPayDetail(q.total);
  }

  function _payOptHTML(val, icon, label, sub) {
    return `
      <div class="pay-opt${payMethod === val ? " selected" : ""}" data-pay="${val}">
        <div class="pay-opt-icon">${icon}</div>
        <div class="pay-opt-label">${label}</div>
        <div class="pay-opt-sub">${sub}</div>
      </div>`;
  }

  function _renderPayDetail(total = Cart.getQuote()?.total || 0) {
    const el = document.getElementById("pay-detail");
    if (!el) return;
    if (payMethod === "upi") {
      el.innerHTML = `
        <div class="pay-detail">
          <p style="font-size:13px;color:var(--muted)">Pay to UPI ID:</p>
          <div class="upi-id">campusbites@ybl</div>
          <p style="font-size:12px;color:var(--muted)">Open GPay / PhonePe / Paytm and pay to the UPI ID above, or scan the QR at the counter. Enter the transaction ID below.</p>
          <div class="form-group" style="margin-top:14px">
            <label for="f-utr">UTR / Transaction ID</label>
            <input type="text" id="f-utr" placeholder="T2312345678" />
          </div>
        </div>`;
    } else if (payMethod === "card") {
      el.innerHTML = `
        <div class="pay-detail">
          <div class="form-group">
            <label for="f-card">Card Number</label>
            <input type="text" id="f-card" placeholder="•••• •••• •••• ••••" maxlength="19" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="f-expiry">Expiry</label>
              <input type="text" id="f-expiry" placeholder="MM / YY" maxlength="7" />
            </div>
            <div class="form-group">
              <label for="f-cvv">CVV</label>
              <input type="password" id="f-cvv" placeholder="•••" maxlength="3" />
            </div>
          </div>
          <p class="secure-note">🔒 Demo card form — connect Razorpay before going live.</p>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="pay-detail">
          <p style="font-size:14px;color:var(--muted)">
            💵 Pay <strong style="color:var(--text)">${U.rupee(total)}</strong> in cash when your order arrives. Exact change is appreciated!
          </p>
        </div>`;
    }
  }

  function _bindEvents(page) {
    page.querySelector("#back-to-menu").addEventListener("click", () => App.go("menu"));
    page.querySelector("#pay-options").addEventListener("click", e => {
      const opt = e.target.closest(".pay-opt");
      if (!opt) return;
      payMethod = opt.dataset.pay;
      page.querySelectorAll(".pay-opt").forEach(o => o.classList.toggle("selected", o.dataset.pay === payMethod));
      _renderPayDetail();
    });
    page.querySelector("#f-hostel").addEventListener("change", _refreshSummary);
    page.addEventListener("input", e => {
      if (e.target.id === "f-card") {
        const v = e.target.value.replace(/\D/g, "").slice(0, 16);
        e.target.value = v.replace(/(.{4})/g, "$1 ").trim();
      }
      if (e.target.id === "f-expiry") {
        const v = e.target.value.replace(/\D/g, "").slice(0, 4);
        e.target.value = v.length > 2 ? v.slice(0, 2) + " / " + v.slice(2) : v;
      }
    });
    page.querySelector("#place-order-btn").addEventListener("click", _placeOrder);
  }

  async function _placeOrder() {
    if (placing) return;
    const name   = document.getElementById("f-name")?.value.trim();
    const phone  = document.getElementById("f-phone")?.value.trim();
    const roll   = document.getElementById("f-roll")?.value.trim();
    const hostel = document.getElementById("f-hostel")?.value;
    const note   = document.getElementById("f-note")?.value.trim();

    if (!name)   return _invalid("f-name", "Please enter your name.");
    if (!/^\d{10}$/.test(phone || "")) return _invalid("f-phone", "Enter a valid 10-digit phone number.");
    if (!hostel) return _invalid("f-hostel", "Please select a delivery location.");
    if (payMethod === "upi" && !document.getElementById("f-utr")?.value.trim()) return _invalid("f-utr", "Please enter your UTR / Transaction ID.");

    const btn = document.getElementById("place-order-btn");
    placing = true; btn.disabled = true; btn.textContent = "Placing order…";
    try {
      const customer = { name, phone, roll, location: hostel };
      U.store.set("cb_customer", customer);
      const order = await U.api("/api/orders", { body: { customer, payMethod, note, lines: Cart.getLines() } });
      Tracker.remember(order.id, phone);
      Cart.clear();
      SuccessPage.render(order);
      App.go("success");
    } catch (err) {
      _invalid(null, err.message);
      btn.disabled = false;
      btn.textContent = "✅ Place Order";
    } finally { placing = false; }
  }

  function _invalid(fieldId, msg) {
    const errEl = document.getElementById("checkout-error");
    errEl.textContent = msg;
    errEl.style.display = "block";
    const el = fieldId && document.getElementById(fieldId);
    if (el) {
      el.style.borderColor = "var(--danger)";
      el.focus();
      setTimeout(() => { el.style.borderColor = ""; }, 2500);
    }
  }

  return { render };
})();


// ---- SUCCESS PAGE ----
const SuccessPage = (() => {
  let timer = null;

  function render(order) {
    const page = document.getElementById("page-success");
    page.innerHTML = `
      <div class="success-wrap">
        <span class="success-icon" aria-hidden="true">🎉</span>
        <h1>Order Placed!</h1>
        <p>Hey <strong>${U.esc(order.customer.name)}</strong>! Your order is confirmed and the kitchen is already on it. 🔥</p>
        <div class="order-id-box" aria-label="Order ID">#${U.esc(order.id)}</div>
        <div id="success-track">${Tracker.orderCardHTML(order)}</div>
        <div class="success-actions">
          <button class="back-home-btn" id="ask-agent-btn">🤖 Ask “Where is my order?”</button>
          <button class="back-home-btn" id="order-more-btn">← Order More Food</button>
        </div>
      </div>`;

    page.querySelector("#order-more-btn").addEventListener("click", () => App.go("menu"));
    page.querySelector("#ask-agent-btn").addEventListener("click", () => App.go("agents", { ask: `Where is my order ${order.id}?` }));

    clearInterval(timer);
    timer = setInterval(async () => {
      if (!page.classList.contains("active")) return clearInterval(timer);
      try {
        const o = await U.api(`/api/orders/${order.id}`);
        document.getElementById("success-track").innerHTML = Tracker.orderCardHTML(o);
      } catch { /* offline */ }
    }, 10000);
  }

  return { render };
})();
