const express = require("express");
const helmet = require("helmet");
const path = require("path");
const dashboardRoutes = require("./routes/dashboard");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use("/assets", express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", application: "FIFA NETWORK" });
});

app.use("/", dashboardRoutes);

app.use((req, res) => {
  res.status(404).send("Halaman tidak ditemukan");
});

module.exports = app;
