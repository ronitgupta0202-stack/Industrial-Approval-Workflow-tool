/**
 * db.js - SQLite via sql.js (pure WebAssembly, no native build needed)
 * Persists to workflow.db on disk; loads it on startup if it exists.
 */
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, 'workflow.db');

let sqljs = null;
let db    = null;

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function lastInsertRowid() {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS applications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_name  TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL,
    current_status  TEXT NOT NULL DEFAULT 'SUBMITTED',
    stage_entered_at TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS status_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    changed_at      TEXT NOT NULL,
    changed_by_role TEXT
  );
`;

function tableColumns(table) {
  return query(`PRAGMA table_info(${table})`).map(c => c.name);
}

function ensureColumn(table, name, ddl) {
  const cols = tableColumns(table);
  if (!cols.includes(name)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    persist();
  }
}

function migrateSchema() {
  ensureColumn('applications', 'title', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('applications', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  db.run(`UPDATE applications SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''`);
  persist();
}

async function initDb() {
  if (db) return db;

  const initSqlJs = require('sql.js');
  sqljs = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new sqljs.Database(fileBuffer);
  } else {
    db = new sqljs.Database();
  }

  db.run(SCHEMA);
  migrateSchema();
  persist();
  return db;
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const id = lastInsertRowid();
  persist();
  return id;
}

module.exports = { initDb, query, queryOne, run, persist };
