import db from "./db.js";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL DEFAULT 'free',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT,
    token_hash TEXT NOT NULL,
    expires_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    hwid TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT
  )`
];

// Each index is created on its own: if old data contains duplicates, only
// that index fails and the rest of the migration still goes through.
const INDEXES = [
  ["users_telegram_id", "CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id ON users (telegram_id)"],
  ["tokens_token_hash", "CREATE INDEX IF NOT EXISTS tokens_token_hash ON tokens (token_hash)"],
  ["subscriptions_user", "CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id, status)"],
  ["devices_user_hwid", "CREATE UNIQUE INDEX IF NOT EXISTS devices_user_hwid ON devices (user_id, hwid)"]
];

export async function ensureSchema(client = db) {
  const report = { tables: [], columns: [], indexes: [] };

  for (const sql of TABLES) {
    await client.execute({ sql, args: [] });
    report.tables.push(sql.match(/EXISTS (\w+)/)[1]);
  }

  const info = await client.execute({
    sql: "PRAGMA table_info(tokens)",
    args: []
  });

  if (!info.rows.some(column => column.name === "token")) {
    await client.execute({
      sql: "ALTER TABLE tokens ADD COLUMN token TEXT",
      args: []
    });

    report.columns.push("tokens.token");
  }

  for (const [name, sql] of INDEXES) {
    try {
      await client.execute({ sql, args: [] });
      report.indexes.push({ name, ok: true });
    } catch (error) {
      report.indexes.push({
        name,
        ok: false,
        error: error.message
      });
    }
  }

  return report;
}
