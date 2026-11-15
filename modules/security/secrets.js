"use strict";

const crypto = require("node:crypto");

function loadEncryptionKey(value = process.env.APP_ENCRYPTION_KEY) {
  const raw = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("APP_ENCRYPTION_KEY harus diisi dengan 64 karakter hex acak (32 byte).");
  }
  return Buffer.from(raw, "hex");
}

function encryptSecret(plainText, keyValue) {
  const value = String(plainText ?? "");
  if (!value || value.length > 500) throw new Error("Rahasia kosong atau terlalu panjang.");
  const key = loadEncryptionKey(keyValue);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecret(envelope, keyValue) {
  const parts = String(envelope || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Format rahasia tersimpan tidak dikenal.");
  }
  const key = loadEncryptionKey(keyValue);
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const encrypted = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) {
    throw new Error("Data rahasia tersimpan tidak valid.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

module.exports = { encryptSecret, decryptSecret, loadEncryptionKey };
