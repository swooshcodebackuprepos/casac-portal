const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

require("dotenv").config();

// Match server.js exactly
const DATA_DIR = process.env.DATA_DIR || __dirname;
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "portal.db");

console.log(`Using DATA_DIR=${DATA_DIR}`);
console.log(`DB=${DB_PATH}`);

const db = new Database(DB_PATH);

// --- schema ---
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student'
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  youtube_url TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
);
`);

// --- seed users (only if missing) ---
const adminEmail = "admin@course.com";
const studentEmail = "student@course.com";

const adminExists = db.prepare(`SELECT id FROM users WHERE email=?`).get(adminEmail);
const studentExists = db.prepare(`SELECT id FROM users WHERE email=?`).get(studentEmail);

if (!adminExists || !studentExists) {
  const adminHash = bcrypt.hashSync("Admin123!", 10);
  const studentHash = bcrypt.hashSync("Student123!", 10);

  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (email, password_hash, role) VALUES (?, ?, ?)`);
  insertUser.run(adminEmail, adminHash, "admin");
  insertUser.run(studentEmail, studentHash, "student");
}

// --- seed content (optional minimal) ---
const moduleCount = db.prepare(`SELECT COUNT(*) as c FROM modules`).get().c;
if (moduleCount === 0) {
  const insModule = db.prepare(`INSERT INTO modules (title, description, sort_order) VALUES (?, ?, ?)`);
  const insLesson = db.prepare(
    `INSERT INTO lessons (module_id, title, youtube_url, sort_order, content_md) VALUES (?, ?, ?, ?, ?)`
  );

  const m1 = insModule.run("Module 1", "Welcome", 1).lastInsertRowid;
  insLesson.run(m1, "Week 1 Overview", "", 1, "Welcome to the course.");
}

db.close();
console.log("Seed complete. Database ready.");
