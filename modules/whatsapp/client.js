"use strict";

const fs = require("node:fs");
const path = require("node:path");

const authDir = path.resolve(process.env.WHATSAPP_AUTH_DIR || "./data/whatsapp-auth");
const state = {
  status: "disconnected",
  qrDataUrl: null,
  phone: null,
  lastError: null,
  socket: null,
  connecting: null,
  reconnectTimer: null,
  intentionalClose: false
};

function snapshot() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    phone: state.phone,
    lastError: state.lastError,
    linked: fs.existsSync(path.join(authDir, "creds.json"))
  };
}

async function connect() {
  if (state.status === "connected") return snapshot();
  if (state.connecting) return state.connecting;

  state.intentionalClose = false;
  state.status = "connecting";
  state.lastError = null;
  state.connecting = (async () => {
    try {
      fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(authDir, 0o700); } catch {}
      const baileys = await import("@whiskeysockets/baileys");
      const makeWASocket = baileys.default;
      const { state: authState, saveCreds } = await baileys.useMultiFileAuthState(authDir);
      const sock = makeWASocket({
        auth: authState,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        browser: ["FF BILLING", "Chrome", "1.0.0"]
      });
      state.socket = sock;
      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", async (update) => {
        if (update.qr) {
          try {
            const QRCode = require("qrcode");
            state.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 280, margin: 2 });
            state.status = "qr";
          } catch (error) {
            state.lastError = "Gagal membuat QR: " + error.message;
          }
        }
        if (update.connection === "open") {
          state.status = "connected";
          state.qrDataUrl = null;
          state.lastError = null;
          state.phone = sock.user?.id?.split(":")[0] || null;
        }
        if (update.connection === "close") {
          state.socket = null;
          state.phone = null;
          state.qrDataUrl = null;
          const code = update.lastDisconnect?.error?.output?.statusCode;
          const loggedOut = code === baileys.DisconnectReason.loggedOut;
          state.status = loggedOut ? "logged_out" : "disconnected";
          state.lastError = loggedOut ? "Perangkat tertaut keluar. Hubungkan ulang dengan QR." : "Koneksi terputus.";
          if (!loggedOut && !state.intentionalClose) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = setTimeout(() => {
              state.connecting = null;
              connect().catch((error) => { state.lastError = error.message; });
            }, 5000);
          }
        }
      });
      return snapshot();
    } catch (error) {
      state.status = "error";
      state.lastError = error.message;
      state.socket = null;
      throw error;
    } finally {
      state.connecting = null;
    }
  })();
  return state.connecting;
}

async function disconnect() {
  state.intentionalClose = true;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (state.socket) {
    try { state.socket.end(undefined); } catch {}
    state.socket = null;
  }
  state.status = "disconnected";
  state.qrDataUrl = null;
  state.phone = null;
  return snapshot();
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/[^0-9]/g, "");
  if (phone.startsWith("0")) phone = "62" + phone.slice(1);
  else if (phone.startsWith("8")) phone = "62" + phone;
  if (!/^62[0-9]{8,13}$/.test(phone)) throw new Error("Nomor harus nomor Indonesia yang valid, contoh 0812xxxxxxxx atau 62812xxxxxxxx.");
  return phone;
}

async function sendText(phoneInput, message) {
  if (state.status !== "connected" || !state.socket) throw new Error("WhatsApp belum terhubung.");
  const phone = normalizePhone(phoneInput);
  const text = String(message || "").trim();
  if (!text || text.length > 1500) throw new Error("Pesan kosong atau terlalu panjang.");
  const jid = phone + "@s.whatsapp.net";
  const result = await state.socket.onWhatsApp(jid);
  if (!result?.[0]?.exists) throw new Error("Nomor WhatsApp tidak ditemukan.");
  return state.socket.sendMessage(jid, { text });
}

function hasSavedSession() {
  return fs.existsSync(path.join(authDir, "creds.json"));
}

module.exports = { connect, disconnect, sendText, snapshot, normalizePhone, hasSavedSession };
