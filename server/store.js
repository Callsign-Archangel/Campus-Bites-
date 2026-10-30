/**
 * store.js — tiny JSON-file database (data/db.json).
 * Good enough for a hackathon; swap for MongoDB/Postgres later.
 */
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

const EMPTY = { orders: [], groupCarts: [], vendors: {}, discoveryLog: [] };

let db = null;
let saveTimer = null;

function load() {
  if (db) return db;
  try {
    db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_PATH, "utf8")) };
  } catch {
    db = JSON.parse(JSON.stringify(EMPTY));
  }
  return db;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_PATH);
  }, 150);
}

function get() { return load(); }

module.exports = { get, save };
