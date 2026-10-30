/**
 * menu.js — Menu rendering & filtering
 *
 * Search and filters ONLY update #menu-grid and #result-count, so the search
 * input never loses focus. Items come from Campus Bites plus every vendor menu
 * discovered live by TinyFish.
 */

const MenuPage = (() => {
  let selectedCat = "All";
  let selectedVendor = "all";
  let searchQuery = "";

  function init() {
    _buildVendors();
    _buildCategories();
    _renderGrid();
    _bindSearch();
    _bindGridCartEvents();
    Cart.onChange(_renderGrid);
  }

  /** Called after the catalog is reloaded (e.g. TinyFish refreshed a menu). */
  function refresh() {
    _buildVendors();
    _buildCategories();
    _renderGrid();
  }

  function _categories() {
    const order = ["Meals", "Bowls", "Burgers", "Pizza", "Snacks", "Drinks", "Desserts"];
    const present = new Set(Catalog.items.filter(_vendorMatch).map(i => i.cat));
    return ["All", ...order.filter(c => present.has(c))];
  }

  const _vendorMatch = m => selectedVendor === "all" || m.vendorId === selectedVendor;

  function _buildVendors() {
    const container = document.getElementById("vendor-buttons");
    const vendors = Catalog.vendors.filter(v => v.itemCount > 0);
    container.innerHTML = [`<button class="vendor-btn${selectedVendor === "all" ? " active" : ""}" data-vendor="all">All vendors</button>`]
      .concat(vendors.map(v => `
        <button class="vendor-btn${selectedVendor === v.id ? " active" : ""}" data-vendor="${U.esc(v.id)}">
          ${U.esc(v.name)}${v.source === "tinyfish" ? ` <span class="tf-dot" title="Menu fetched live by TinyFish ${U.esc(U.timeAgo(v.fetchedAt))}"></span>` : ""}
        </button>`)).join("");
    container.onclick = e => {
      const btn = e.target.closest(".vendor-btn");
      if (!btn) return;
      selectedVendor = btn.dataset.vendor;
      container.querySelectorAll(".vendor-btn").forEach(b => b.classList.toggle("active", b.dataset.vendor === selectedVendor));
      if (!_categories().includes(selectedCat)) selectedCat = "All";
      _buildCategories();
      _renderGrid();
    };
  }

  function _buildCategories() {
    const container = document.getElementById("cat-buttons");
    container.innerHTML = _categories().map(cat => `
      <button class="cat-btn${cat === selectedCat ? " active" : ""}" data-cat="${cat}" role="tab" aria-selected="${cat === selectedCat}">${cat}</button>
    `).join("");
    container.onclick = e => {
      const btn = e.target.closest(".cat-btn");
      if (!btn) return;
      selectedCat = btn.dataset.cat;
      container.querySelectorAll(".cat-btn").forEach(b => {
        const isActive = b.dataset.cat === selectedCat;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-selected", isActive);
      });
      _renderGrid();
    };
  }

  function _bindSearch() {
    const input    = document.getElementById("search-input");
    const clearBtn = document.getElementById("search-clear");
    input.addEventListener("input", () => {
      searchQuery = input.value.trim().toLowerCase();
      clearBtn.style.display = searchQuery ? "flex" : "none";
      _renderGrid();
    });
    clearBtn.addEventListener("click", () => {
      input.value = ""; searchQuery = "";
      clearBtn.style.display = "none";
      input.focus();
      _renderGrid();
    });
  }

  function _renderGrid() {
    const filtered = Catalog.items.filter(m => {
      const matchCat  = selectedCat === "All" || m.cat === selectedCat;
      const matchText = !searchQuery ||
        m.name.toLowerCase().includes(searchQuery) ||
        m.desc.toLowerCase().includes(searchQuery) ||
        m.cat.toLowerCase().includes(searchQuery) ||
        m.vendorName.toLowerCase().includes(searchQuery);
      return matchCat && matchText && _vendorMatch(m);
    }).sort((a, b) => Number(b.available) - Number(a.available));

    const grid     = document.getElementById("menu-grid");
    const noResult = document.getElementById("no-results");
    const countEl  = document.getElementById("result-count");

    if (!filtered.length) {
      grid.innerHTML = "";
      noResult.style.display = "block";
      countEl.textContent = "";
      return;
    }
    noResult.style.display = "none";
    countEl.textContent = `${filtered.length} item${filtered.length !== 1 ? "s" : ""}`;
    grid.innerHTML = filtered.map(_cardHTML).join("");
  }

  function _cardHTML(m) {
    const qty = Cart.getQty(m.id);
    const id = U.esc(m.id);
    const controls = !m.available
      ? `<span class="soldout-tag">Sold out</span>`
      : qty > 0
        ? `<div class="qty-ctrl">
             <button class="qty-btn" data-id="${id}" data-delta="-1" aria-label="Remove one ${U.esc(m.name)}">−</button>
             <span class="qty-num">${qty}</span>
             <button class="qty-btn" data-id="${id}" data-delta="1" aria-label="Add another ${U.esc(m.name)}">+</button>
           </div>`
        : `<button class="add-btn" data-id="${id}" data-delta="1" aria-label="Add ${U.esc(m.name)} to cart">+ Add</button>`;

    return `
      <article class="menu-card${m.available ? "" : " unavailable"}">
        <div class="menu-card-img" aria-hidden="true">${U.esc(m.emoji)}
          ${m.source === "tinyfish" ? `<span class="src-badge" title="Price & availability fetched from the vendor's website by TinyFish">🐟 Live</span>` : ""}
        </div>
        <div class="menu-card-body">
          <div class="veg-row">
            <span class="veg-dot ${m.veg ? "veg" : "nonveg"}" aria-hidden="true"></span>
            <span class="veg-label">${m.veg ? "Veg" : "Non-Veg"}</span>
            <span class="vendor-label">· ${U.esc(m.vendorName)}</span>
          </div>
          <div class="item-name">${U.esc(m.name)}</div>
          <div class="item-desc">${U.esc(m.desc)}</div>
          <div class="item-macros">${m.proteinStated ? "" : "~"}${m.protein} g protein · ~${m.kcal} kcal</div>
          <div class="item-footer">
            <span class="item-price">${m.originalPrice ? `<s>₹${m.originalPrice}</s> ` : ""}₹${m.price}</span>
            ${controls}
          </div>
        </div>
      </article>`;
  }

  function _bindGridCartEvents() {
    document.getElementById("menu-grid").addEventListener("click", e => {
      const btn = e.target.closest("[data-id][data-delta]");
      if (!btn) return;
      Cart.update(btn.dataset.id, Number(btn.dataset.delta)); // Cart.onChange re-renders the grid
    });
  }

  return { init, refresh };
})();
