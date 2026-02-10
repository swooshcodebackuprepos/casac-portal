const path = require("path");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
require("dotenv").config();

const dbPath = path.join(__dirname, "..", "portal.db");
const db = new Database(dbPath);

function runMigrations() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','student')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL DEFAULT '',
      youtube_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General',
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedContent() {
  const moduleCount = db.prepare(`SELECT COUNT(*) AS c FROM modules`).get().c;
  if (moduleCount > 0) return;

  const insertModule = db.prepare(
    `INSERT INTO modules (title, description, sort_order) VALUES (?, ?, ?)`
  );
  const insertLesson = db.prepare(
    `INSERT INTO lessons (module_id, title, content_md, youtube_url, sort_order) VALUES (?, ?, ?, ?, ?)`
  );

  const m1 = insertModule.run(
    "Module 4: Counseling Theories & Practice",
    "MI, Stages of Change, CBT, Harm Reduction, Boundaries",
    1
  ).lastInsertRowid;

  insertLesson.run(
    m1,
    "Week 5 Overview",
    `# Week 5 Overview

Welcome to Module 4.

Topics:
- Motivational Interviewing (MI)
- Stages of Change
- CBT basics
- Harm Reduction
- Therapeutic Boundaries

## Today’s goals
- Understand key concepts
- Practice OARS
- Apply stage-matched interventions`,
    "",
    1
  );

  insertLesson.run(
    m1,
    "Motivational Interviewing (MI) + OARS Practice",
    `# Motivational Interviewing (MI)

MI is collaborative and helps clients resolve ambivalence.

## OARS
- Open questions
- Affirmations
- Reflections
- Summaries`,
    "",
    2
  );
}

async function seedUsers() {
  const adminEmail = process.env.ADMIN_SEED_EMAIL || "admin@course.com";
  const adminPass = process.env.ADMIN_SEED_PASSWORD || "Admin123!";
  const studentEmail = process.env.STUDENT_SEED_EMAIL || "student@course.com";
  const studentPass = process.env.STUDENT_SEED_PASSWORD || "Student123!";

  const upsert = db.prepare(`
    INSERT INTO users (email, password_hash, role)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      password_hash=excluded.password_hash,
      role=excluded.role
  `);

  const adminHash = await bcrypt.hash(adminPass, 12);
  const studentHash = await bcrypt.hash(studentPass, 12);

  upsert.run(adminEmail.toLowerCase(), adminHash, "admin");
  upsert.run(studentEmail.toLowerCase(), studentHash, "student");
}

(async () => {
  runMigrations();
  seedContent();
  await seedUsers();
  console.log("Seed complete. Database ready at portal.db");
  process.exit(0);
})();
