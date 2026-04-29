const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATIC_DIR = path.resolve(__dirname, "..");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1129";
const ADMIN_COOKIE = "nadi_admin";
const ADMIN_MAX_AGE = 60 * 60 * 24 * 7;

if (!process.env.ADMIN_PASSWORD) {
  console.warn(`[warn] ADMIN_PASSWORD not set — using default "${ADMIN_PASSWORD}"`);
}

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

function getOrCreateAdminSecret() {
  const row = getStmt.get("admin.secret");
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString("hex");
  putStmt.run("admin.secret", secret, new Date().toISOString());
  return secret;
}

const ADMIN_SECRET = getOrCreateAdminSecret();

function adminToken() {
  return crypto.createHmac("sha256", ADMIN_SECRET).update("admin").digest("base64url");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function isAdmin(req) {
  return parseCookies(req)[ADMIN_COOKIE] === adminToken();
}

const PROTECTED_PATHS = new Set([
  "/프로젝트_손익계산기.html",
  "/나디_손익계산_규칙집.md",
]);

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/admin/status", (req, res) => res.json({ admin: isAdmin(req) }));

app.post("/api/admin/login", (req, res) => {
  const password = req.body && req.body.password;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "invalid password" });
  }
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${adminToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ADMIN_MAX_AGE}`
  );
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  res.json({ ok: true });
});

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

app.use((req, res, next) => {
  let p = req.path;
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  if (PROTECTED_PATHS.has(p) && !isAdmin(req)) {
    return res.status(403).type("text/html; charset=utf-8").send(
      `<!doctype html><meta charset="utf-8"><title>403</title>` +
      `<div style="font-family:sans-serif;padding:40px;text-align:center">` +
      `<h2>접근 권한이 없습니다</h2>` +
      `<p>관리자 로그인이 필요합니다.</p>` +
      `<p><a href="/">메인으로</a></p></div>`
    );
  }
  next();
});

app.use(express.static(STATIC_DIR, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`nadi-calc listening on :${PORT}, data=${DATA_DIR}`);
});
