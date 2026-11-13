const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-wa-scheduler-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "scheduler.sqlite");

const { db } = require("../database/db");
const {
  getAutomaticReminderSettings,
  setAutomaticRemindersEnabled,
  acquireReminderLock,
  releaseReminderLock,
  runReminderJob
} = require("../modules/whatsapp/scheduler");

test("pengingat otomatis default nonaktif dan pengaturannya tersimpan", () => {
  assert.equal(getAutomaticReminderSettings().enabled, false);

  const enabled = setAutomaticRemindersEnabled(true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.timezone, "Asia/Jakarta");
  assert.equal(enabled.schedule, "0 9 * * *");

  assert.equal(setAutomaticRemindersEnabled(false).enabled, false);
  assert.equal(getAutomaticReminderSettings().enabled, false);
});

test("pengunci database mencegah dua proses pengingat berjalan bersamaan", () => {
  assert.equal(acquireReminderLock("worker-a"), true);
  assert.equal(acquireReminderLock("worker-b"), false);
  assert.equal(releaseReminderLock("worker-b"), false);
  assert.equal(releaseReminderLock("worker-a"), true);
  assert.equal(acquireReminderLock("worker-b"), true);
  assert.equal(releaseReminderLock("worker-b"), true);
});

test("jadwal otomatis tidak mengirim saat dinonaktifkan", async () => {
  setAutomaticRemindersEnabled(false);
  const result = await runReminderJob({ automatic: true, delayMs: 0 });
  assert.equal(result.disabled, true);
  assert.equal(result.sent, 0);
});

test("jadwal otomatis melewati proses saat WhatsApp belum terhubung", async () => {
  setAutomaticRemindersEnabled(true);
  const result = await runReminderJob({ automatic: true, delayMs: 0 });
  assert.equal(result.skippedConnection, true);
  assert.equal(result.sent, 0);
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
