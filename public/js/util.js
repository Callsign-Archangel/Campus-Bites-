/**
 * util.js — small shared helpers (escaping, API calls, toasts, formatting, storage).
 */
const U = (() => {
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const rupee = n => `₹${Math.round(Number(n) || 0)}`;

  /** tiny safe markdown: **bold**, _italic_, line breaks */
  function md(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>")
      .replace(/\n/g, "<br>");
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: { ...(opts.headers || {}) } };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, type = "info", ms = 4500) {
    let wrap = document.getElementById("toasts");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "toasts"; wrap.setAttribute("aria-live", "polite"); document.body.appendChild(wrap); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = md(msg);
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
  }

  const fmtTime = iso => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  function timeAgo(iso) {
    if (!iso) return "never";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  return { esc, rupee, md, api, toast, fmtTime, timeAgo, store };
})();

/** Catalog — every orderable item from Campus Bites + TinyFish-discovered vendors. */
const Catalog = (() => {
  let data = { vendors: [], items: [], offers: [], locations: [] };
  let byId = new Map();
  async function load() {
    data = await U.api("/api/catalog");
    byId = new Map(data.items.map(i => [i.id, i]));
    return data;
  }
  return {
    load,
    get vendors() { return data.vendors; },
    get items() { return data.items; },
    get offers() { return data.offers; },
    get locations() { return data.locations; },
    item: id => byId.get(id),
    vendor: id => data.vendors.find(v => v.id === id),
  };
})();
