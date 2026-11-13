const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const path = require("path");
const fs = require("fs");
const { csrfSync } = require("csrf-sync");
const dashboardRoutes = require("./routes/dashboard");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const billingRoutes = require("./routes/billing");
const auditRoutes = require("./routes/audit");
const reportsRoutes = require("./routes/reports");
const whatsappRoutes = require("./routes/whatsapp");
const { dbDir } = require("../../database/db");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && (!sessionSecret || sessionSecret.length < 32 || sessionSecret === "replace-with-a-long-random-secret")) {
  throw new Error("SESSION_SECRET must be a unique random value of at least 32 characters in production.");
}

fs.mkdirSync(dbDir, { recursive: true });
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));
app.use("/assets", express.static(path.join(__dirname, "public")));
app.use(session({
  name: "ffbilling.sid",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dbDir, table: "sessions" }),
  secret: sessionSecret || "development-only-change-this-secret-before-deploying",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const { generateToken, csrfSynchronisedProtection } = csrfSync();
app.use(csrfSynchronisedProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", application: "FF BILLING" });
});

app.use("/", authRoutes);
app.use("/", dashboardRoutes);
app.use("/admin/users", userRoutes);
app.use("/admin/audit", auditRoutes);
app.use("/reports", reportsRoutes);
app.use("/admin/whatsapp", whatsappRoutes);
app.use("/billing", billingRoutes);

app.use((req, res) => {
  res.status(404).send("Halaman tidak ditemukan");
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).send("Permintaan tidak valid atau token formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.");
  }
  console.error(err);
  res.status(500).send("Terjadi kesalahan pada server.");
});

module.exports = app;
