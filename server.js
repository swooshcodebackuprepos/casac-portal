const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const { marked } = require("marked");
require("dotenv").config();

const { requireAuth, requireAdmin } = require("./middleware/auth");

// Render provides PORT. Local falls back to 3000.
const PORT = Number(process.env.PORT || 3000);

// Use Render Disk path when provided
const DATA_DIR = process.env.DATA_DIR
  ? String(process.env.DATA_DIR)
  : __dirname;

// Ensure DATA_DIR exists (Render disk mount will exist, but safe to ensure)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {}

// DB paths must be writable
const dbPath = path.join(DATA_DIR, "portal.db");
const sessionsPath = path.join(DATA_DIR, "sessions.db");

// If DB doesn't exist yet (first boot on a new disk), initialize it
if (!fs.existsSync(dbPath)) {
  try {
    require("./db/init");
  } catch (e) {
    console.error("DB init failed:", e);
  }
}

const db = new Database(dbPath);

const app = express();

// When behind Render proxy (HTTPS), this makes secure cookies work correctly
app.set("trust proxy", 1);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "frame-src": [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com"
        ],
        "script-src": ["'self'", "'unsafe-inline'", "https://www.youtube.com"],
        "img-src": ["'self'", "data:"],
        "style-src": ["'self'", "'unsafe-inline'"]
      }
    }
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new SQLiteStore({
      db: path.basename(sessionsPath),
      dir: path.dirname(sessionsPath)
    }),
    secret: process.env.SESSION_SECRET || "replace_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // secure cookies on Render
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function parseYouTube(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    if (host === "youtu.be") return u.pathname.slice(1);
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
    }
  } catch {}
  return null;
}

function safeHtmlFromMarkdown(md) {
  return marked.parse(md || "");
}

/* ------------------ Routes ------------------ */

app.get("/", requireAuth, (req, res) => {
  const modules = db
    .prepare(
      `SELECT id, title, description, sort_order
       FROM modules
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.render("index", { modules });
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db
    .prepare(`SELECT id, email, password_hash, role FROM users WHERE email=?`)
    .get(email);

  if (!user) return res.status(401).render("login", { error: "Invalid email or password." });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).render("login", { error: "Invalid email or password." });

  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect("/");
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/syllabus", requireAuth, (req, res) => {
  const syllabusPath = path.join(__dirname, "data", "syllabus.json");
  let syllabus = { title: "Syllabus", items: [] };
  try {
    syllabus = JSON.parse(fs.readFileSync(syllabusPath, "utf8"));
  } catch {}
  res.render("syllabus", { syllabus });
});

app.get("/qas", requireAuth, (req, res) => {
  const qasPath = path.join(__dirname, "data", "qas.json");
  let qas = { title: "Q&A", sections: [] };
  try {
    qas = JSON.parse(fs.readFileSync(qasPath, "utf8"));
  } catch {}
  res.render("qas", { qas });
});

app.get("/modules", requireAuth, (req, res) => {
  const modules = db
    .prepare(
      `SELECT id, title, description, sort_order
       FROM modules
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.render("modules", { modules });
});

app.get("/modules/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const module = db.prepare(`SELECT id, title, description FROM modules WHERE id=?`).get(id);
  if (!module) return res.status(404).send("Module not found");

  const lessons = db
    .prepare(
      `SELECT id, title, youtube_url, sort_order
       FROM lessons
       WHERE module_id=?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(id);

  res.render("module", { module, lessons });
});

app.get("/lessons/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);

  const lesson = db
    .prepare(
      `SELECT l.id, l.title, l.content_md, l.youtube_url,
              m.title as module_title, m.id as module_id
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       WHERE l.id=?`
    )
    .get(id);

  if (!lesson) return res.status(404).send("Lesson not found");

  const videoId = parseYouTube(lesson.youtube_url);
  const contentHtml = safeHtmlFromMarkdown(lesson.content_md);

  res.render("lesson", { lesson, videoId, contentHtml });
});

/* ------------------ Admin ------------------ */

app.get("/admin", requireAdmin, (req, res) => {
  const modules = db
    .prepare(
      `SELECT id, title, description, sort_order
       FROM modules
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.render("admin", { modules });
});

app.get("/admin/modules/new", requireAdmin, (req, res) => {
  res.render("admin-module", {
    mode: "new",
    module: { title: "", description: "", sort_order: 0 },
    error: null
  });
});

app.post("/admin/modules/new", requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const sort_order = Number(req.body.sort_order || 0);

  if (!title) {
    return res.render("admin-module", {
      mode: "new",
      module: { title, description, sort_order },
      error: "Title is required."
    });
  }

  db.prepare(`INSERT INTO modules (title, description, sort_order) VALUES (?, ?, ?)`)
    .run(title, description, sort_order);

  res.redirect("/admin");
});

app.get("/admin/modules/:id/edit", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const module = db.prepare(`SELECT id, title, description, sort_order FROM modules WHERE id=?`).get(id);
  if (!module) return res.status(404).send("Module not found");
  res.render("admin-module", { mode: "edit", module, error: null });
});

app.post("/admin/modules/:id/edit", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const sort_order = Number(req.body.sort_order || 0);

  if (!title) {
    return res.render("admin-module", {
      mode: "edit",
      module: { id, title, description, sort_order },
      error: "Title is required."
    });
  }

  db.prepare(`UPDATE modules SET title=?, description=?, sort_order=? WHERE id=?`)
    .run(title, description, sort_order, id);

  res.redirect("/admin");
});

app.post("/admin/modules/:id/delete", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM modules WHERE id=?`).run(id);
  res.redirect("/admin");
});

app.get("/admin/modules/:moduleId/lessons/new", requireAdmin, (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const module = db.prepare(`SELECT id, title FROM modules WHERE id=?`).get(moduleId);
  if (!module) return res.status(404).send("Module not found");

  res.render("admin-lesson", {
    mode: "new",
    module,
    lesson: { title: "", youtube_url: "", sort_order: 0, content_md: "" },
    error: null
  });
});

app.post("/admin/modules/:moduleId/lessons/new", requireAdmin, (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const module = db.prepare(`SELECT id, title FROM modules WHERE id=?`).get(moduleId);
  if (!module) return res.status(404).send("Module not found");

  const title = String(req.body.title || "").trim();
  const youtube_url = String(req.body.youtube_url || "").trim();
  const sort_order = Number(req.body.sort_order || 0);
  const content_md = String(req.body.content_md || "").trim();

  if (!title) {
    return res.render("admin-lesson", {
      mode: "new",
      module,
      lesson: { title, youtube_url, sort_order, content_md },
      error: "Title is required."
    });
  }

  db.prepare(`INSERT INTO lessons (module_id, title, youtube_url, sort_order, content_md) VALUES (?, ?, ?, ?, ?)`)
    .run(moduleId, title, youtube_url, sort_order, content_md);

  res.redirect("/admin");
});

app.get("/admin/lessons/:id/edit", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const lesson = db.prepare(`SELECT * FROM lessons WHERE id=?`).get(id);
  if (!lesson) return res.status(404).send("Lesson not found");

  const module = db.prepare(`SELECT id, title FROM modules WHERE id=?`).get(lesson.module_id);
  res.render("admin-lesson", { mode: "edit", module, lesson, error: null });
});

app.post("/admin/lessons/:id/edit", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const lesson = db.prepare(`SELECT * FROM lessons WHERE id=?`).get(id);
  if (!lesson) return res.status(404).send("Lesson not found");

  const module = db.prepare(`SELECT id, title FROM modules WHERE id=?`).get(lesson.module_id);

  const title = String(req.body.title || "").trim();
  const youtube_url = String(req.body.youtube_url || "").trim();
  const sort_order = Number(req.body.sort_order || 0);
  const content_md = String(req.body.content_md || "").trim();

  if (!title) {
    return res.render("admin-lesson", {
      mode: "edit",
      module,
      lesson: { ...lesson, title, youtube_url, sort_order, content_md },
      error: "Title is required."
    });
  }

  db.prepare(`UPDATE lessons SET title=?, youtube_url=?, sort_order=?, content_md=? WHERE id=?`)
    .run(title, youtube_url, sort_order, content_md, id);

  res.redirect("/admin");
});

app.post("/admin/lessons/:id/delete", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const lesson = db.prepare(`SELECT module_id FROM lessons WHERE id=?`).get(id);
  if (!lesson) return res.redirect("/admin");
  db.prepare(`DELETE FROM lessons WHERE id=?`).run(id);
  res.redirect("/admin");
});

/* ------------------ Start ------------------ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CASAC Portal listening on 0.0.0.0:${PORT}`);
  console.log(`Using DATA_DIR=${DATA_DIR}`);
  console.log(`DB=${dbPath}`);
  console.log(`SESSIONS=${sessionsPath}`);
});
