const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const configuredPath = process.env.BILLING_DB_PATH || "./data/billing.sqlite";
const dbPath = path.resolve(configuredPath);
const dbDir = path.dirname(dbPath);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const migrationsDir = path.join(__dirname, "migrations");
const applied = new Set(db.prepare("SELECT filename FROM schema_migrations").all().map((row) => row.filename));
for (const filename of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
  if (applied.has(filename)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
  const apply = db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(filename);
  });
  apply();
}

module.exports = { db, dbDir, dbPath };
