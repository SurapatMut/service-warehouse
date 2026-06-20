const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH = path.join(__dirname, 'warehouse.db');
let _db = null;

function getDb() {
  if (!_db) _db = new sqlite3.Database(DB_PATH);
  return _db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function(err) {
      if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sku TEXT,
    type TEXT NOT NULL, category TEXT, qty INTEGER NOT NULL DEFAULT 0, unit TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS serials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL,
    serial TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_stock',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL, item_type TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1, note TEXT,
    used_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS usage_serials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id INTEGER NOT NULL, serial TEXT NOT NULL
  )`);
  console.log('✅  Database initialized at', DB_PATH);
  await run(`CREATE TABLE IF NOT EXISTS import_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL,
    item_name  TEXT    NOT NULL,
    item_type  TEXT    NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 1,
    serial     TEXT,
    note       TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
}

module.exports = { getDb, run, get, all, initDb };
