# 🔥 Campus Bites — AI food ordering for campus, powered by TinyFish

Order from **every food vendor on campus** in one app. TinyFish web agents visit each vendor's website, read the live menu, prices and offers, and our AI agents use that data to plan meals, find deals, build group orders and track your order.

| Feature | Where | How TinyFish is used |
|---|---|---|
| **1. AI Food Ordering Assistant** — "I have ₹100, suggest a filling lunch with high protein" | Bites AI tab, hero search box | Searches every menu TinyFish collected and compares thousands of meal combinations |
| **2. Smart Order Tracking Agent** — "Where is my order?" | Bites AI → Track, Track tab, success page | Uses **our own backend order API** (status, prep ETA, delivery status, delay alerts) |
| **3. Deal Finder Agent** | Bites AI → Deal Finder | Compares offers TinyFish scraped from vendor sites and finds the cheapest combo for your budget |
| **4. Group Food Ordering Agent** — "Order lunch for five people under ₹500" | Bites AI → Group Order → shared cart link | Picks the best vendor and plates from TinyFish menus; the group confirms through a shared link |
| **5. Live Menu & Price Discovery** | Live Menus tab | TinyFish `run-sse` agents extract items, current prices, offers, sold-out items and menu changes |

---

## Quick start

```bash
npm install
cp .env.example .env          # then put your TINYFISH_API_KEY in .env
npm start                     # http://localhost:3000
```

The app works straight away using **sample menu snapshots**, so you can try every agent before your first TinyFish run. Open **Live Menus → Refresh all menus with TinyFish** to fetch real data. Each vendor card then shows a **🐟 Live** badge with when it was fetched, and menu items get a 🐟 Live tag.

### ⚠️ Important: TinyFish needs a public URL
TinyFish runs a real browser **in the cloud**, so it **cannot open `localhost`**. The three demo vendor sites live in `public/vendor-sites/`. To let TinyFish reach them, do one of these:

- **Deploy** (Render/Railway): set `PUBLIC_BASE_URL=https://your-app.onrender.com`
- **Tunnel**: run `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, then set `PUBLIC_BASE_URL` to the tunnel URL
- **Use real vendor pages**: in Live Menus → *Add a vendor website*, paste any `https://` menu page (a Google Site, an online menu, a Zomato/Swiggy page, …)

You can also run discovery from the terminal: `npm run discover` (or `npm run discover chai-corner`).

---

## How the TinyFish integration works

`server/tinyfish.js` calls the TinyFish Web Agent API:

```
POST https://agent.tinyfish.ai/v1/automation/run-sse
X-API-Key: $TINYFISH_API_KEY
{ "url": "<vendor menu page>", "goal": "<extract every item, price, offer… return JSON>" }
```

It streams `STARTED → STREAMING_URL → PROGRESS… → COMPLETE` events. `server/discovery.js` then:

1. sends each `PROGRESS` step to the browser over SSE (`/api/discover/stream`), so you can watch the agent work, along with a **"Watch the TinyFish browser live"** link;
2. normalises the result into items with categories, veg/non-veg, availability and estimated protein/kcal, and parses offer text into structured discounts (percent / flat / buy-1-get-1 / combo);
3. **diffs** it against the previous snapshot to record added and removed items, price drops and rises, sold-out items, and new or ended offers;
4. saves it to `data/db.json`. The menu, Deal Finder, Food Assistant and Group agents all read from this data.

If `AUTO_REFRESH_MINUTES` is set, menus refresh on a schedule.

## How the agents work

- **Understanding the request** (`server/agents/parse.js`): pulls out budget (₹100, 100 rs, "₹100 each"), number of people (five, 5 people, group of 4), veg-only or "2 veg", goals (protein, filling, light, cheap), meal type, pickup or delivery, exclusions ("no paneer"), and order ID or phone. The UI shows what it understood as chips.
- **Planner** (`server/agents/planner.js`): lists every combination of up to 3 items from each vendor, applies that vendor's best offer, adds the delivery fee when relevant, keeps only combos within budget, and ranks them by your goal (protein, calories, fullness). It picks the best per vendor so you get a choice.
- **Group planner**: gives each person the cheapest proper plate, respecting veg seats and variety. It then spends the leftover budget on the upgrades with the best value per rupee, and does this for every vendor before picking the best one. Bigger group orders often unlock "above ₹X" offers.
- **Order tracking** (`server/orders.js`): orders live on **our own backend**. Status moves through placed → confirmed → preparing → ready → out for delivery → delivered. Prep ETA comes from the slowest item, the kitchen queue and the order size; delivery time depends on the hostel. When the kitchen adds a delay on the **Kitchen dashboard** (`/kitchen.html`), the student gets a delay notification: an in-app toast, plus a browser notification if alerts are enabled.

The language understanding is rule-based on purpose: it's instant, free and predictable for a demo. You could add an LLM later for free-form chat.

## Demo script (≈3 minutes)

1. **Live Menus** → *Refresh all menus with TinyFish* → watch the agent steps stream in → the cards switch to 🐟 Live.
2. Edit a price in `public/vendor-sites/chai-corner.html`, refresh again → **Changes on last refresh** shows 📉/📈.
3. Home → type *"I have ₹100, suggest a filling lunch with high protein"* → **Add to cart**.
4. Bites AI → *"Find the best deals for ₹120"* → the offer comparison table and the cheapest combo.
5. *"Order lunch for five people under ₹500"* → **Create shared cart** → open the link in a second browser, swap a plate, everyone confirms → place the order.
6. Checkout a normal order → open `/kitchen.html` → **+5 min delay** → the student sees a ⚠️ delay alert; ask *"Where is my order?"*.

Tip: set `DEMO_SPEED=4` so the order clock runs 4× faster during a live demo.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/catalog` | All vendors, items and offers |
| POST | `/api/quote` | Price a cart, applying the best offers |
| POST | `/api/agent/chat` | `{ message, agent?: auto\|assistant\|deals\|group\|track, context: { mode, orderIds, phone } }` |
| GET/POST/DELETE | `/api/vendors` | List / add / remove vendor websites |
| POST | `/api/discover?vendor=all` | Start TinyFish discovery |
| GET | `/api/discover/stream` | SSE stream of live discovery progress |
| POST | `/api/orders` | Place an order |
| GET | `/api/orders/:id`, `/api/orders?ids=&phone=` | Order tracking |
| POST/GET/PATCH | `/api/group-carts…` | Shared group carts |
| GET/PATCH | `/api/kitchen/orders…` | Kitchen dashboard (optional `KITCHEN_PIN`) |

## Project structure

```
server/
  index.js        Express app + routes
  tinyfish.js     TinyFish SSE client
  discovery.js    Live menu discovery + change detection
  catalog.js      Canteen menu + TinyFish vendor menus → one catalog
  offers.js       Offer text → structured discount, discount maths
  nutrition.js    Category / protein / kcal estimates for scraped items
  orders.js       Billing, order API, order lifecycle & delays
  agents/         parse.js · planner.js · chat.js (all agents + group carts)
public/
  index.html, kitchen.html, css/, js/
  vendor-sites/   3 demo vendor menu pages for TinyFish to visit
data/
  vendors.json          vendor list (editable, or via the UI)
  seed-snapshots.json   sample menus used before the first TinyFish run
```

Protein and calorie numbers are estimates (marked "~"), unless the vendor's page lists them.
