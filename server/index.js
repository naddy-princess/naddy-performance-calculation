const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATIC_DIR = path.resolve(__dirname, "..");

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "nadi.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
const putStmt = db.prepare(`
  INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
`);
const delStmt = db.prepare("DELETE FROM kv WHERE key = ?");

const STATE_KEY = "tracker.state";
const DEFAULT_STATE = { projects: [], entries: [], users: [] };

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/state", (_req, res) => {
  const row = getStmt.get(STATE_KEY);
  if (!row) return res.json(DEFAULT_STATE);
  try {
    res.json(JSON.parse(row.value));
  } catch {
    res.json(DEFAULT_STATE);
  }
});

app.put("/api/state", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "body must be object" });
  }
  const clean = {
    projects: Array.isArray(body.projects) ? body.projects : [],
    entries: Array.isArray(body.entries) ? body.entries : [],
    users: Array.isArray(body.users) ? body.users : [],
  };
  putStmt.run(STATE_KEY, JSON.stringify(clean), new Date().toISOString());
  res.json({ ok: true });
});

app.delete("/api/state", (_req, res) => {
  delStmt.run(STATE_KEY);
  res.json({ ok: true });
});

app.use(express.static(STATIC_DIR, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`nadi-calc listening on :${PORT}, data=${DATA_DIR}`);
});
