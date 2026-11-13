"use strict";

const { randomUUID } = require("node:crypto");
const cron = require("node-cron");
const { db } = require("../../database/db");
const whatsapp = require("./client");
const { processReminders } = require("./reminders");

const SETTING_KEY = "whatsapp_reminders_enabled";
const LOCK_KEY = "whatsapp-reminders";
const SCHEDULE = "0 9 * * *";
const TIMEZONE = "Asia/Jakarta";
let scheduledTask = null;

function getAutomaticReminderSettings() {
  const setting = db.prepare("SELECT setting_value, updated_at FROM app_settings WHERE setting_key=?").get(SETTING_KEY);
  return {
    enabled: setting?.setting_value === "1",
    schedule: SCHEDULE,
    timezone: TIMEZONE,
    timeLabel: "Setiap hari pukul 09.00 WIB",
    updatedAt: setting?.updated_at || null
  };
}

function setAutomaticRemindersEnabled(enabled, userId = null) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("Status pengingat otomatis harus boolean.");
  }

  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value=excluded.setting_value,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
  `).run(SETTING_KEY, enabled ? "1" : "0", userId || null);

  return getAutomaticReminderSettings();
}

function acquireReminderLock(ownerToken, leaseMinutes = 15) {
  if (!ownerToken || typeof ownerToken !== "string") {
    throw new TypeError("Token pengunci proses wajib diisi.");
  }
  if (!Number.isInteger(leaseMinutes) || leaseMinutes < 1 || leaseMinutes > 60) {
    throw new RangeError("Masa pengunci harus 1 sampai 60 menit.");
  }

  const result = db.prepare(`
    INSERT INTO whatsapp_job_locks (lock_key, owner_token, expires_at)
    VALUES (?, ?, datetime('now', ?))
    ON CONFLICT(lock_key) DO UPDATE SET
      owner_token=excluded.owner_token,
      expires_at=excluded.expires_at
    WHERE whatsapp_job_locks.expires_at <= CURRENT_TIMESTAMP
  `).run(LOCK_KEY, ownerToken, "+" + leaseMinutes + " minutes");

  return result.changes === 1;
}

function releaseReminderLock(ownerToken) {
  return db.prepare("DELETE FROM whatsapp_job_locks WHERE lock_key=? AND owner_token=?")
    .run(LOCK_KEY, ownerToken).changes === 1;
}

async function runReminderJob({ automatic = false, limit = 20, delayMs = 5000 } = {}) {
  if (automatic && !getAutomaticReminderSettings().enabled) {
    return { checked: 0, sent: 0, failed: 0, skipped: 0, disabled: true };
  }

  if (automatic && whatsapp.snapshot().status !== "connected") {
    return { checked: 0, sent: 0, failed: 0, skipped: 0, skippedConnection: true };
  }

  const ownerToken = randomUUID();
  if (!acquireReminderLock(ownerToken)) {
    return { checked: 0, sent: 0, failed: 0, skipped: 0, busy: true };
  }

  try {
    // Re-check after acquiring the shared lock so an admin disable action
    // cannot race with a cron tick that has already started.
    if (automatic && !getAutomaticReminderSettings().enabled) {
      return { checked: 0, sent: 0, failed: 0, skipped: 0, disabled: true };
    }
    if (automatic && whatsapp.snapshot().status !== "connected") {
      return { checked: 0, sent: 0, failed: 0, skipped: 0, skippedConnection: true };
    }

    return {
      ...(await processReminders({ limit, delayMs })),
      automatic
    };
  } finally {
    releaseReminderLock(ownerToken);
  }
}

function startAutomaticReminderScheduler() {
  if (scheduledTask) return scheduledTask;

  scheduledTask = cron.schedule(SCHEDULE, async () => {
    try {
      const result = await runReminderJob({ automatic: true, limit: 20, delayMs: 5000 });
      if (result.disabled) return;
      if (result.skippedConnection) {
        console.warn("WhatsApp automatic reminders skipped: gateway is not connected.");
        return;
      }
      console.log("WhatsApp automatic reminders:", result);
    } catch (error) {
      console.error("WhatsApp automatic reminder job failed:", error);
    }
  }, { timezone: TIMEZONE });

  return scheduledTask;
}

module.exports = {
  getAutomaticReminderSettings,
  setAutomaticRemindersEnabled,
  acquireReminderLock,
  releaseReminderLock,
  runReminderJob,
  startAutomaticReminderScheduler
};
