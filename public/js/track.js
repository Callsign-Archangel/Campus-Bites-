/**
 * track.js — Smart Order Tracking.
 * Reads our own backend order API, shows live status, prep ETA, delivery status,
 * and raises delay notifications (toast + browser notification) in the background.
 */
const Tracker = (() => {
  let lastSeen = U.store.get("cb_order_seen", {}); // { id: { status, delayMinutes } }
  let pollTimer = null;

  const myIds = () => U.store.get("cb_orders", []);
  const myPhone = () => U.store.get("cb_customer", {}).phone || "";

  function remember(id, phone) {
    const ids = [id, ...myIds().filter(x => x !== id)].slice(0, 15);
    U.store.set("cb_orders", ids);
    if (phone) U.store.set("cb_customer", { ...U.store.get("cb_customer", {}), phone });
    startPolling();
  }

  function orderCardHTML(o) {
    const done = ["delivered", "collected"].includes(o.status);
    const delayMsg = o.notifications.filter(n => n.type === "delay").map(n => n.message).pop();
    return `
      <div class="order-card ${o.delayed ? "is-delayed" : ""}">
        <div class="order-card-head">
          <div>
            <div class="order-card-id">#${U.esc(o.id)}</div>
            <div class="order-card-meta">${U.esc(o.bill.vendors.map(v => v.vendorName).join(" + "))} · ${o.mode === "delivery" ? "Delivery" : "Pickup"} · ${U.rupee(o.bill.total)}</div>
          </div>
          <span class="status-pill ${done ? "done" : o.delayed ? "late" : ""}">${U.esc(o.statusLabel)}</span>
        </div>
        ${o.delayed && !done ? `<div class="delay-banner">⚠️ ${U.esc(delayMsg || "Running late")}</div>` : ""}
        <div class="eta-row">
          <div><span class="eta-num">${done ? "✓" : o.prepMinutesLeft ? `${o.prepMinutesLeft} min` : "Done"}</span><span class="eta-label">${done ? "Completed" : `Prep left (of ${o.prepMinutes} min)`}</span></div>
          <div><span class="eta-num">${done ? U.fmtTime(o.etaDoneAt) : `${o.minutesLeft} min`}</span><span class="eta-label">${o.mode === "delivery" ? "Delivery ETA" : "Ready for pickup"} ${done ? "" : `· ${U.fmtTime(o.etaDoneAt)}`}</span></div>
        </div>
        <div class="track-steps compact">
          ${o.stages.map(s => `
            <div class="track-step">
              <div class="step-dot ${s.state}">${s.state === "done" ? "✓" : s.state === "active" ? "●" : ""}</div>
              <div class="step-info"><p>${U.esc(s.label)}</p><span>${s.state === "pending" ? "est. " : ""}${U.fmtTime(s.at)}</span></div>
            </div>`).join("")}
        </div>
        <div class="order-card-foot">🛵 ${U.esc(o.deliveryStatus)}</div>
        ${o.notifications.length ? `<details class="notif-log"><summary>Updates (${o.notifications.length})</summary>
          ${o.notifications.map(n => `<div class="notif ${n.type}">${U.fmtTime(n.at)} — ${U.esc(n.message)}</div>`).join("")}</details>` : ""}
      </div>`;
  }

  // ---------------- page ----------------
  function render() {
    const page = document.getElementById("page-track");
    page.innerHTML = `
      <div class="checkout-wrap">
        <h1>Track your order</h1>
        <form class="track-form" id="track-form">
          <input id="track-input" placeholder="Order ID (CB123456) or phone number" value="${U.esc(myPhone())}" autocomplete="off" />
          <button class="checkout-btn" type="submit">Track</button>
        </form>
        <div class="track-tools">
          <button class="link-btn" id="notif-btn" type="button">🔔 Enable delay alerts</button>
          <button class="link-btn" id="ask-track" type="button">🤖 Ask the tracking agent</button>
        </div>
        <div id="track-results"><p class="muted-note">Loading your recent orders…</p></div>
      </div>`;
    page.querySelector("#track-form").addEventListener("submit", e => { e.preventDefault(); lookup(page.querySelector("#track-input").value.trim()); });
    page.querySelector("#notif-btn").addEventListener("click", askNotify);
    page.querySelector("#ask-track").addEventListener("click", () => App.go("agents", { ask: "Where is my order?" }));
    _syncNotifBtn();
    lookup("");
  }

  async function lookup(q) {
    const box = document.getElementById("track-results");
    if (!box) return;
    const params = new URLSearchParams();
    const ids = myIds();
    if (/^cb\d{6}$/i.test(q)) params.set("ids", q.toUpperCase());
    else {
      if (ids.length) params.set("ids", ids.join(","));
      const phone = /^\d{10}$/.test(q) ? q : myPhone();
      if (phone) params.set("phone", phone);
    }
    if (![...params.keys()].length) { box.innerHTML = `<p class="muted-note">No orders on this device yet. Enter an order ID or phone number.</p>`; return; }
    try {
      const list = await U.api(`/api/orders?${params}`);
      if (/^\d{10}$/.test(q)) U.store.set("cb_customer", { ...U.store.get("cb_customer", {}), phone: q });
      box.innerHTML = list.length ? list.slice(0, 8).map(orderCardHTML).join("") : `<p class="muted-note">No orders found for “${U.esc(q || "this device")}”.</p>`;
    } catch (e) { box.innerHTML = `<p class="form-error" style="display:block">${U.esc(e.message)}</p>`; }
  }

  // ---------------- background polling & notifications ----------------
  function askNotify() {
    if (!("Notification" in window)) return U.toast("This browser doesn't support notifications — you'll still get in-app alerts.");
    Notification.requestPermission().then(_syncNotifBtn);
  }
  function _syncNotifBtn() {
    const b = document.getElementById("notif-btn");
    if (b && "Notification" in window && Notification.permission === "granted") { b.textContent = "🔔 Delay alerts on"; b.disabled = true; }
  }
  function notify(msg, type) {
    U.toast(msg, type, 7000);
    try {
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification("Campus Bites", { body: msg.replace(/\*\*/g, "") });
    } catch { /* ignore */ }
  }

  async function poll() {
    const ids = myIds();
    if (!ids.length) return;
    let list;
    try { list = await U.api(`/api/orders?ids=${ids.join(",")}`); } catch { return; }
    let active = 0;
    for (const o of list) {
      const prev = lastSeen[o.id];
      const finished = ["delivered", "collected", "cancelled"].includes(o.status);
      if (!finished) active++;
      if (prev) {
        if (o.delayMinutes > (prev.delayMinutes || 0)) notify(`⚠️ **#${o.id} delayed** — ${o.notifications.filter(n => n.type === "delay").pop()?.message || "running late"}`, "warn");
        else if (o.delayed && !prev.delayed) notify(`⚠️ **#${o.id}** is running a little late.`, "warn");
        if (o.status !== prev.status) notify(`${finished ? "✅" : "🍳"} **#${o.id}**: ${o.statusLabel}`, finished ? "ok" : "info");
      }
      lastSeen[o.id] = { status: o.status, delayMinutes: o.delayMinutes, delayed: o.delayed };
    }
    U.store.set("cb_order_seen", lastSeen);
    const badge = document.getElementById("track-badge");
    if (badge) { badge.textContent = active; badge.style.display = active ? "inline-flex" : "none"; }
    if (document.getElementById("page-track")?.classList.contains("active")) lookup("");
  }

  function startPolling() {
    clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, 15000);
  }

  return { remember, orderCardHTML, render, startPolling };
})();
