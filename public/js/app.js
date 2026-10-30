/**
 * app.js — Main controller
 * Hash routing (#menu, #agents, #live, #track, #group/<id>, #checkout, #success)
 * and cart panel open/close. Loaded last so all other modules are ready.
 */

const App = (() => {
  const PAGES = ["home", "agents", "live", "track", "group", "checkout", "success"];
  const ROUTE_TO_PAGE = { menu: "home", "": "home" };
  let pendingOpts = null;

  function _el(name) { return document.getElementById(`page-${name}`); }

  function showPage(name, opts = {}) {
    PAGES.forEach(p => _el(p).classList.toggle("active", p === name));
    document.querySelectorAll(".nav-tab").forEach(t => t.classList.toggle("active", t.dataset.route === (name === "home" ? "menu" : name)));
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (name === "checkout") CheckoutPage.render();
    if (name === "agents") AgentsPage.render(opts);
    if (name === "live") LivePage.render();
    if (name === "track") Tracker.render();
    if (name === "group") GroupPage.render(opts);
  }

  /** Navigate (updates the URL so back/forward and share links work). */
  function go(route, opts = {}) {
    const hash = route === "group" && opts.id ? `#group/${opts.id}` : `#${route}`;
    pendingOpts = opts;
    if (location.hash === hash) _route();
    else location.hash = hash;
  }

  function _route() {
    const [route, arg] = location.hash.replace(/^#/, "").split("/");
    const opts = pendingOpts || {};
    pendingOpts = null;
    if (route === "group" && arg) return showPage("group", { ...opts, id: arg });
    if (route === "checkout" && !Cart.getCount()) return go("menu");
    if (route === "success" && !_el("success").innerHTML.trim()) return go("track");
    const page = ROUTE_TO_PAGE[route] ?? (PAGES.includes(route) ? route : "home");
    showPage(page, opts);
  }

  function _initCart() {
    const overlay  = document.getElementById("cart-overlay");
    const panel    = document.getElementById("cart-panel");
    const openBtn  = document.getElementById("cart-toggle-btn");
    const closeBtn = document.getElementById("cart-close-btn");

    function open()  { overlay.classList.add("open");  panel.classList.add("open");  }
    function close() { overlay.classList.remove("open"); panel.classList.remove("open"); }

    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    document.getElementById("cart-items-list").addEventListener("click", e => {
      const btn = e.target.closest("[data-id][data-delta]");
      if (!btn) return;
      Cart.update(btn.dataset.id, Number(btn.dataset.delta));
    });

    document.getElementById("proceed-btn").addEventListener("click", () => {
      if (!Cart.getCount()) return;
      close();
      go("checkout");
    });
  }

  function _initNav() {
    document.getElementById("nav-tabs").addEventListener("click", e => {
      const t = e.target.closest(".nav-tab");
      if (!t) return;
      e.preventDefault();
      go(t.dataset.route);
    });
    document.querySelector(".logo").addEventListener("click", () => go("menu"));

    // hero "ask the agent" bar
    const form = document.getElementById("hero-ask");
    form.addEventListener("submit", e => {
      e.preventDefault();
      const q = document.getElementById("hero-ask-input").value.trim();
      go("agents", q ? { ask: q } : {});
    });
    document.getElementById("hero-chips").addEventListener("click", e => {
      const c = e.target.closest("[data-ask]");
      if (c) go("agents", { ask: c.dataset.ask });
    });
  }

  async function init() {
    try {
      await Catalog.load();
    } catch (e) {
      document.getElementById("menu-grid").innerHTML = `<p class="form-error" style="display:block">Couldn't reach the Campus Bites server (${U.esc(e.message)}). Start it with <code>npm start</code>.</p>`;
      return;
    }
    const liveCount = Catalog.vendors.filter(v => v.source === "tinyfish").length;
    document.getElementById("stat-items").textContent = `${Catalog.items.length}`;
    document.getElementById("stat-vendors").textContent = `${Catalog.vendors.length}`;
    document.getElementById("stat-live").textContent = liveCount ? `${liveCount} live` : "TinyFish";

    Cart.init();
    MenuPage.init();
    _initCart();
    _initNav();
    LivePage.connect();
    Tracker.startPolling();
    window.addEventListener("hashchange", _route);
    _route();
  }

  return { init, go, showPage };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
