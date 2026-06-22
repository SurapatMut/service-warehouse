const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql + ' RETURNING *', params);
    return { lastID: res.rows[0]?.id, changes: res.rowCount };
  } catch {
    await client.query(sql, params);
    return { lastID: null, changes: 0 };
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`CREATE TABLE IF NOT EXISTS items (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    sku         TEXT,
    type        TEXT NOT NULL,
    category    TEXT,
    qty         INTEGER NOT NULL DEFAULT 0,
    unit        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS serials (
    id         SERIAL PRIMARY KEY,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    serial     TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'in_stock',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS usage_logs (
    id         SERIAL PRIMARY KEY,
    item_id    INTEGER NOT NULL,
    item_name  TEXT NOT NULL,
    item_type  TEXT NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 1,
    note       TEXT,
    used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS usage_serials (
    id       SERIAL PRIMARY KEY,
    log_id   INTEGER NOT NULL REFERENCES usage_logs(id) ON DELETE CASCADE,
    serial   TEXT NOT NULL
  )`);
  await query(`CREATE TABLE IF NOT EXISTS import_logs (
    id          SERIAL PRIMARY KEY,
    item_id     INTEGER NOT NULL,
    item_name   TEXT NOT NULL,
    item_type   TEXT NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 1,
    serial      TEXT,
    note        TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  console.log('✅  Database initialized');
}

module.exports = { query, get, run, initDb };
