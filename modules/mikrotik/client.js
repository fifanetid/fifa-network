"use strict";

const { MikrotikAPI } = require("@fibercom/routeros-api");
const { decryptSecret } = require("../security/secrets");

function firstRecord(value) {
  if (Array.isArray(value)) return value[0] || {};
  return value && typeof value === "object" ? value : {};
}

function safeText(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function mapActivePpp(value) {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return rows.slice(0, 500).map(row => ({
    name: safeText(row.name, 64),
    service: safeText(row.service, 32),
    callerId: safeText(row["caller-id"], 64),
    address: safeText(row.address, 45),
    uptime: safeText(row.uptime, 48),
    encoding: safeText(row.encoding, 32)
  })).filter(row => row.name);
}

async function inspectRouter(router, options = {}) {
  const Client = options.Client || MikrotikAPI;
  const api = new Client({
    host: router.host,
    port: Number(router.api_port),
    user: router.api_username,
    password: decryptSecret(router.api_password_encrypted),
    timeout: options.timeoutSeconds || 8,
    tls: Number(router.api_tls) === 1
      ? (router.api_tls_ca_encrypted
          ? {
              ca: Buffer.from(decryptSecret(router.api_tls_ca_encrypted), "utf8"),
              rejectUnauthorized: true
            }
          : true)
      : false,
    keepalive: false,
    debug: false
  });

  // Avoid an unhandled EventEmitter error event; command promises still
  // reject and are reported to the caller.
  if (typeof api.on === "function") {
    api.on("error", () => {});
    api.on("timeout", () => {});
  }

  try {
    await api.connect();

    // This integration deliberately issues PRINT commands only.
    const identityRaw = await api.write("/system/identity/print");
    const resourcesRaw = await api.write("/system/resource/print");
    const activePppRaw = await api.write("/ppp/active/print");

    const identity = firstRecord(identityRaw);
    const resources = firstRecord(resourcesRaw);
    const activePppRows = Array.isArray(activePppRaw)
      ? activePppRaw
      : activePppRaw && typeof activePppRaw === "object" ? [activePppRaw] : [];
    const activePpp = mapActivePpp(activePppRows);

    return {
      identity: safeText(identity.name || router.router_name, 80),
      version: safeText(resources.version, 80),
      uptime: safeText(resources.uptime, 80),
      cpuLoad: safeInteger(resources["cpu-load"]),
      cpuCount: safeInteger(resources["cpu-count"]),
      memoryFreeBytes: safeInteger(resources["free-memory"]),
      memoryTotalBytes: safeInteger(resources["total-memory"]),
      activePppCount: activePppRows.length,
      activePpp
    };
  } finally {
    if (api.connected && typeof api.close === "function") {
      await api.close();
    }
  }
}

module.exports = { inspectRouter, mapActivePpp };
