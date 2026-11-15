"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const EXAMPLE_PLACEHOLDER = "replace-with-64-hex-characters";

function isValidEncryptionKey(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function readFileKey(envPath) {
  if (!fs.existsSync(envPath)) return "";
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  return String(parsed.APP_ENCRYPTION_KEY || "").trim();
}

function adoptKey(value, env) {
  if (!isValidEncryptionKey(value)) return false;
  env.APP_ENCRYPTION_KEY = value;
  return true;
}

function writeEnvKey(envPath, key) {
  const directory = path.dirname(envPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  let source = "";
  try {
    source = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = source ? source.split(/\r?\n/) : [];
  const keyLine = "APP_ENCRYPTION_KEY=" + key;
  const assignment = /^\s*(?:export\s+)?APP_ENCRYPTION_KEY\s*=/;
  let inserted = false;
  const output = [];

  for (const line of lines) {
    if (assignment.test(line)) {
      if (!inserted) {
        output.push(keyLine);
        inserted = true;
      }
      continue;
    }
    output.push(line);
  }

  if (!inserted) {
    while (output.length && output[output.length - 1] === "") output.pop();
    if (output.length) output.push("");
    output.push(keyLine);
  }

  const next = output.join("\n") + "\n";
  const temporaryPath = envPath + ".tmp-" + process.pid + "-" + crypto.randomBytes(5).toString("hex");
  let wroteTemporary = false;

  try {
    fs.writeFileSync(temporaryPath, next, { encoding: "utf8", mode: 0o600, flag: "wx" });
    wroteTemporary = true;
    fs.chmodSync(temporaryPath, 0o600);
    try {
      fs.renameSync(temporaryPath, envPath);
      wroteTemporary = false;
    } catch (error) {
      // Windows may not replace an existing destination with renameSync.
      if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
      fs.writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
      fs.chmodSync(envPath, 0o600);
    }
  } finally {
    if (wroteTemporary) {
      try { fs.unlinkSync(temporaryPath); } catch {}
    }
  }

  try { fs.chmodSync(envPath, 0o600); } catch {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureAppEncryptionKey(options = {}) {
  const envPath = path.resolve(options.envPath || path.join(process.cwd(), ".env"));
  const env = options.env || process.env;
  const waitMs = Number.isInteger(options.waitMs) ? options.waitMs : 10000;
  const pollMs = Number.isInteger(options.pollMs) ? options.pollMs : 50;
  const configured = String(env.APP_ENCRYPTION_KEY || "").trim();

  if (isValidEncryptionKey(configured)) {
    try { fs.chmodSync(envPath, 0o600); } catch {}
    return { generated: false, source: "environment" };
  }
  if (configured && configured !== EXAMPLE_PLACEHOLDER) {
    throw new Error("APP_ENCRYPTION_KEY sudah diatur tetapi formatnya tidak valid. Isi dengan 64 karakter hex atau kosongkan nilai contoh agar dibuat otomatis.");
  }

  const fileKey = readFileKey(envPath);
  if (isValidEncryptionKey(fileKey)) {
    adoptKey(fileKey, env);
    try { fs.chmodSync(envPath, 0o600); } catch {}
    return { generated: false, source: "file" };
  }
  if (fileKey && fileKey !== EXAMPLE_PLACEHOLDER) {
    throw new Error("APP_ENCRYPTION_KEY di .env tidak valid. Jangan menimpa kunci yang mungkin dipakai untuk mengenkripsi data router.");
  }

  const lockPath = envPath + ".lock";
  const deadline = Date.now() + waitMs;
  let lockFd;

  while (lockFd === undefined) {
    try {
      lockFd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeSync(lockFd, String(process.pid));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      // Another FF BILLING process may be generating the key. Adopt its
      // completed value rather than generating a different key.
      const latestKey = readFileKey(envPath);
      if (isValidEncryptionKey(latestKey)) {
        adoptKey(latestKey, env);
        return { generated: false, source: "file" };
      }
      if (Date.now() >= deadline) {
        throw new Error("Proses lain sedang menyiapkan .env. Jalankan FF BILLING kembali setelah proses tersebut selesai.");
      }
      await sleep(pollMs);
    }
  }

  try {
    // Re-check after acquiring the lock to close the startup race.
    const latestKey = readFileKey(envPath);
    if (isValidEncryptionKey(latestKey)) {
      adoptKey(latestKey, env);
      try { fs.chmodSync(envPath, 0o600); } catch {}
      return { generated: false, source: "file" };
    }
    if (latestKey && latestKey !== EXAMPLE_PLACEHOLDER) {
      throw new Error("APP_ENCRYPTION_KEY di .env tidak valid. Periksa file .env sebelum menjalankan aplikasi.");
    }

    const key = crypto.randomBytes(32).toString("hex");
    writeEnvKey(envPath, key);
    env.APP_ENCRYPTION_KEY = key;
    return { generated: true, source: "file" };
  } finally {
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

module.exports = { ensureAppEncryptionKey, isValidEncryptionKey };
